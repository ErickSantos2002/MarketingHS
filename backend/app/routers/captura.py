"""A porta da landing: captura anônima de lead.

⚠️ **Esta rota não tem autenticação, por desenho** — é a landing pública
chamando, e qualquer credencial que chegasse ao navegador estaria publicada. É
por isso que ela mora sob `/publico`, dentro do limite de 30/min por IP do
middleware do lote 0.

⚠️ **E é por isso que ela não devolve NADA sobre o lead.** A function
`lead-capture` que ela substitui devolvia o registro projetado (id, etiqueta,
dnia_id e booleanos de completude) para chamador não privilegiado — mas ela
exigia a chave publicável do Supabase. Sem nenhuma credencial, até a projeção é
demais: `isNew` sozinho já é um oráculo de enumeração, que responde "este
e-mail está na base?" para quem perguntar. A resposta daqui é `{ok, redirect_url}`
e mais nada.

⚠️ A conversão é registrada AQUI, no servidor. O `leadConversion.ts`, apagado
no lote 7, fazia isso do navegador; `POST /publico/conversao` exige chave de
API. Fechar o laço aqui é o único caminho que não expõe credencial.
"""

import logging

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.captura.campos import higienizar
from app.captura.email import validar_dominio
from app.database import sessao
from app.routers.publico import _aplicar_tag_do_slug

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/publico", tags=["captura"])


class CapturaIn(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    page_slug: str = Field(min_length=1, max_length=200)
    session_id: str | None = Field(default=None, min_length=1, max_length=100)
    fields: dict = Field(default_factory=dict)


class EmailIn(BaseModel):
    email: str = Field(min_length=1, max_length=320)


@router.post("/validar-email")
async def validar_email(dados: EmailIn):
    """Conferência inline do formulário, antes do envio.

    Devolve 200 sempre — inclusive quando inválido. Um 4xx aqui viraria erro no
    console do navegador a cada tecla digerida por quem preenche.
    """
    valido, motivo = await validar_dominio(dados.email)
    return {"valido": valido, "motivo": motivo}


@router.post("/captura")
async def capturar(dados: CapturaIn):
    email = dados.email.strip().lower()

    valido, motivo = await validar_dominio(email)
    if not valido:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, motivo or "E-mail inválido.")

    campos = higienizar(dados.fields)

    async with sessao(role="service_role") as conn:
        pagina = await conn.fetchrow(
            "SELECT slug, config FROM pages WHERE slug = $1", dados.page_slug)
        if pagina is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Página não encontrada.")

        existente = await conn.fetchrow(
            "SELECT id::text AS id, session_id, deleted_at, deleted_by, dnia_id::text "
            "AS dnia_id FROM leads WHERE email = $1", email)

        if existente is None:
            lead_id = await _inserir(conn, email, dados.session_id, campos)
        else:
            lead_id = existente["id"]
            await _atualizar(conn, existente, dados.session_id, campos)

        await _resolver_identidade(conn, lead_id, email, campos)

        await conn.execute(
            """INSERT INTO lead_conversions
                   (lead_id, tipo, converted_at, page_slug, session_id,
                    utm_source, utm_medium, utm_campaign, utm_term, utm_content,
                    source, ab_test, ab_var, ab_vid)
               VALUES ($1::uuid, $2, now(), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)""",
            lead_id, campos.get("tipo") or "lead", dados.page_slug,
            dados.session_id, campos.get("utm_source"), campos.get("utm_medium"),
            campos.get("utm_campaign"), campos.get("utm_term"),
            campos.get("utm_content"), campos.get("source"),
            campos.get("ab_test"), campos.get("ab_var"), campos.get("ab_vid"))

        await _aplicar_tag_do_slug(conn, lead_id, dados.page_slug)

        config = pagina["config"] or {}

    return {"ok": True, "redirect_url": config.get("redirect_url") or None}


async def _inserir(conn, email: str, session_id: str | None, campos: dict) -> str:
    """⚠️ `tipo` é NOT NULL sem default em `leads`; o padrão da origem é 'lead'.

    As colunas saem das chaves de `campos`, que vêm da lista branca — nunca do
    corpo do request. Chave desconhecida o `higienizar` já descartou.
    """
    colunas = ["email", "session_id", "tipo"]
    valores = [email, session_id, campos.get("tipo") or "lead"]
    for chave, valor in campos.items():
        if chave == "tipo":
            continue
        colunas.append(chave)
        valores.append(valor)
    marcas = ", ".join(f"${i}" for i in range(1, len(valores) + 1))
    return await conn.fetchval(
        f"INSERT INTO leads ({', '.join(colunas)}) VALUES ({marcas}) RETURNING id::text",
        *valores)


async def _atualizar(conn, existente, session_id: str | None, campos: dict) -> None:
    """Atualiza o que veio, adota o `session_id` se ainda não havia, e REATIVA
    contato excluído — reconverter é sinal de que a pessoa voltou.

    ⚠️ A exclusão aqui é lógica (`deleted_at`), e o índice `leads_email_unique`
    não olha `deleted_at`: sem reativar, a segunda conversão da mesma pessoa
    bateria no índice e a captura falharia.
    """
    atribuicoes = dict(campos)
    if session_id and not existente["session_id"]:
        atribuicoes["session_id"] = session_id

    estava_excluido = existente["deleted_at"] is not None
    if estava_excluido:
        atribuicoes["deleted_at"] = None
        atribuicoes["deleted_by"] = None

    if atribuicoes:
        nomes = list(atribuicoes)
        sets = ", ".join(f"{nome} = ${i}" for i, nome in enumerate(nomes, start=2))
        await conn.execute(
            f"UPDATE leads SET {sets} WHERE id = $1::uuid",
            existente["id"], *[atribuicoes[n] for n in nomes])

    if estava_excluido:
        # ⚠️ `deleted_by` é `uuid` na tabela — asyncpg devolve um `uuid.UUID`,
        # e o codec jsonb desta conexão serializa com `json.dumps`, que não
        # sabe converter `UUID` sozinho. Sem o `str()`, a reativação levanta
        # `TypeError` e a captura toda falha por causa de um campo de
        # auditoria. `str(None)` nunca acontece aqui porque só entra neste
        # bloco quando `deleted_at` não é nulo.
        deleted_by = existente["deleted_by"]
        await conn.execute(
            """INSERT INTO contact_events
                   (lead_id, source_app, event_type, title, metadata)
               VALUES ($1::uuid, 'marketinghs', 'contact_reactivated',
                       'Contato reativado por nova conversão', $2)""",
            existente["id"],
            {"previous_deleted_at": str(existente["deleted_at"]),
             "previous_deleted_by": str(deleted_by) if deleted_by else None,
             "reason": "captura_reconversao"})


async def _resolver_identidade(conn, lead_id: str, email: str, campos: dict) -> None:
    """Chama `resolve_or_create_identity` e escreve de volta o que ela resolveu.

    ⚠️ A function devolve `jsonb` (tipo escalar), não um conjunto de colunas —
    conferido em produção em 08/09/2026 com `\\df+` e uma chamada real. `SELECT
    * FROM resolve_or_create_identity(...)` dá uma linha com UMA coluna, de
    nome igual ao da function, carregando o dict inteiro — não colunas
    `dnia_id` / `phone_normalized` soltas. Por isso a chamada abaixo vai na
    lista de SELECT, não no FROM, e `fetchval` devolve o dict já decodificado
    pelo mesmo codec jsonb que `app.database._preparar_conexao` registra.

    ⚠️ Não levanta: identidade é enriquecimento, e derrubar a captura por causa
    dela seria recusar um lead real por falha nossa.
    """
    try:
        resultado = await conn.fetchval(
            "SELECT resolve_or_create_identity($1, $2, $3, $4, $5::uuid, $6, $7)",
            campos.get("whatsapp"), email, campos.get("nome"),
            "marketinghs", lead_id, campos.get("utm_source") or campos.get("source"),
            "lead")
        if not resultado or not resultado.get("dnia_id"):
            return
        await conn.execute(
            """UPDATE leads
                  SET dnia_id = $2::uuid,
                      phone_normalized = COALESCE($3, phone_normalized)
                WHERE id = $1::uuid""",
            lead_id, str(resultado["dnia_id"]), resultado.get("phone_normalized"))
    except Exception as exc:  # noqa: BLE001 — ver o docstring
        logger.error("captura: identidade não resolvida para %s: %s", lead_id, exc)
