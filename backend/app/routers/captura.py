"""A porta da landing: captura anônima de lead.

⚠️ **Esta rota não tem autenticação, por desenho** — é a landing pública
chamando, e qualquer credencial que chegasse ao navegador estaria publicada. É
por isso que ela mora sob `/publico`, dentro do limite de 30/min por IP do
middleware do lote 0 (menos `/publico/validar-email`, isento — ver
`app/main.py`).

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
from pydantic import BaseModel, Field, field_validator

from app.captura.campos import higienizar
from app.captura.email import validar_dominio
from app.database import sessao
from app.routers.publico import _aplicar_tag_do_slug

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/publico", tags=["captura"])

EMAIL_TAMANHO_MAXIMO = 320
SESSION_ID_TAMANHO_MAXIMO = 100

# ⚠️ Constante, não literal inline, só para o teste da rodada 1 de correção
# conseguir forçar uma falha DE BANCO real dentro da transação (trocando o
# nome da function por um que não existe) e provar que o SAVEPOINT de
# `_resolver_identidade` recupera a transação de verdade — não apenas engole
# uma exceção Python que nunca chegou a abortar nada.
_SQL_RESOLVE_IDENTIDADE = (
    "SELECT resolve_or_create_identity($1, $2, $3, $4, $5::uuid, $6, $7)"
)


class CapturaIn(BaseModel):
    # ⚠️ Sem `max_length` no e-mail de propósito: o teto de 320 é checado em
    # `capturar()`, para responder 400 como qualquer outro e-mail inválido —
    # o `max_length` do Pydantic respondia 422 com `detail` em lista, um
    # segundo contrato de erro que a origem não tinha.
    email: str = Field(min_length=3)
    page_slug: str = Field(min_length=1, max_length=200)
    session_id: str | None = None
    fields: dict = Field(default_factory=dict)

    @field_validator("session_id", mode="before")
    @classmethod
    def _descartar_session_id_invalido(cls, valor):
        """Como a origem (`sessionId.length <= 100 ? sessionId : null`): o
        campo de rastreio ruim some e a captura segue. Recusar a requisição
        inteira perderia o lead por causa dele."""
        if not isinstance(valor, str) or not valor or len(valor) > SESSION_ID_TAMANHO_MAXIMO:
            return None
        return valor


class EmailIn(BaseModel):
    email: str = Field(min_length=1, max_length=320)


@router.post("/validar-email")
async def validar_email(dados: EmailIn):
    """Conferência inline do formulário, antes do envio.

    Devolve 200 sempre — inclusive quando inválido. Um 4xx aqui viraria erro no
    console do navegador a cada tecla digerida por quem preenche.

    ⚠️ Isenta do balde de 30/min de `/publico` (ver `isentos` em
    `app/main.py`): ela não escreve nada e tem cache de domínio por 1h em
    `app.captura.email`, mas é chamada a cada pausa de digitação — dividir o
    balde com `/publico/captura` faria a conferência gastar o orçamento do
    envio de verdade, e o formulário levaria 429 na hora de enviar.
    """
    valido, motivo = await validar_dominio(dados.email)
    return {"valido": valido, "motivo": motivo}


@router.post("/captura")
async def capturar(dados: CapturaIn):
    email = dados.email.strip().lower()
    if len(email) > EMAIL_TAMANHO_MAXIMO:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "E-mail inválido.")

    valido, motivo = await validar_dominio(email)
    if not valido:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, motivo or "E-mail inválido.")

    campos = higienizar(dados.fields)

    async with sessao(role="service_role") as conn:
        # ⚠️ `status = 'active'` — a Tarefa 4 (a casca `GET /p/{slug}`) só vai
        # servir página nesse estado. Sem o mesmo filtro aqui, esta rota
        # aceita conversão de página pausada/rascunho que a landing nem
        # consegue mostrar: duas rotas irmãs discordando sobre o que é "uma
        # página no ar" é o padrão que já mordeu este subprojeto.
        pagina = await conn.fetchrow(
            "SELECT slug, config FROM pages WHERE slug = $1 AND status = 'active'",
            dados.page_slug)
        if pagina is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Página não encontrada.")

        # ⚠️ `lower(email)`, não `email = $1`. `leads_email_unique` é única na
        # coluna CRUA, sem `lower()` — uma linha antiga gravada como
        # `Carla@Empresa.com` não seria achada por uma captura de
        # `carla@empresa.com`, nasceria um segundo contato vazio, e o score, a
        # tag e a conversão iriam para ele em vez do contato real.
        # `_resolver_lead`, em `publico.py`, já casa assim — os dois caminhos
        # de escrita deste sistema têm que concordar.
        existente = await conn.fetchrow(
            "SELECT id::text AS id, session_id, deleted_at, deleted_by, dnia_id::text "
            "AS dnia_id FROM leads WHERE lower(email) = $1", email)

        if existente is None:
            lead_id = await _inserir(conn, email, dados.session_id, campos)
            if lead_id is None:
                # ⚠️ `ON CONFLICT (email) DO NOTHING` não gravou: outra
                # requisição para o MESMO e-mail venceu a corrida entre o
                # SELECT acima e este INSERT — o caso canônico é duplo clique
                # em Enviar. Sem isto, o segundo INSERT bateria direto em
                # `leads_email_unique` e devolveria 500 para um lead real.
                # Reconsulta e segue pelo mesmo caminho de quem já achou o
                # contato.
                existente = await conn.fetchrow(
                    "SELECT id::text AS id, session_id, deleted_at, deleted_by, "
                    "dnia_id::text AS dnia_id FROM leads WHERE lower(email) = $1",
                    email)
                lead_id = existente["id"]
                await _atualizar(conn, existente, dados.session_id, campos)
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


async def _inserir(conn, email: str, session_id: str | None, campos: dict) -> str | None:
    """⚠️ `tipo` é NOT NULL sem default em `leads`; o padrão da origem é 'lead'.

    As colunas saem das chaves de `campos`, que vêm da lista branca — nunca do
    corpo do request. Chave desconhecida o `higienizar` já descartou.

    ⚠️ `ON CONFLICT (email) DO NOTHING RETURNING id::text`: devolve `None`
    quando o e-mail já existe — duplo clique em Enviar chega aqui como dois
    requests concorrentes que passaram os dois pelo SELECT do chamador sem se
    verem. Quem chama trata o `None` reconsultando e seguindo pela
    atualização.
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
        f"INSERT INTO leads ({', '.join(colunas)}) VALUES ({marcas}) "
        f"ON CONFLICT (email) DO NOTHING RETURNING id::text",
        *valores)


async def _atualizar(conn, existente, session_id: str | None, campos: dict) -> None:
    """Atualiza o que veio, adota o `session_id` se ainda não havia, e REATIVA
    contato excluído — reconverter é sinal de que a pessoa voltou.

    ⚠️ A exclusão aqui é lógica (`deleted_at`), e o índice `leads_email_unique`
    não olha `deleted_at`: sem reativar, a segunda conversão da mesma pessoa
    bateria no índice e a captura falharia.

    ⚠️ `status` e `tipo` NÃO entram nas atribuições, embora estejam na lista
    branca de `higienizar`. Os dois são estado de CRM, não campo de
    formulário: no `_inserir` (contato NOVO) tudo bem — é assim que um lead
    nasce com `tipo='lead'`/`'participante'`/etc. Mas num contato JÁ
    EXISTENTE, gravar os dois deixaria qualquer pessoa que soubesse o e-mail
    mover o estágio de CRM de um contato real só reconvertendo pela landing.
    A assimetria entre os dois caminhos é DELIBERADA — não "harmonize" isto
    achando que é uma inconsistência a consertar.
    """
    atribuicoes = {chave: valor for chave, valor in campos.items()
                   if chave not in ("status", "tipo")}
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
        #
        # ⚠️ `dnia_id` vai no evento, como na origem: é por ele que o evento
        # entra no cruzamento de `idx_contact_events_universal_id` e no merge
        # de identidade. A primeira versão desta rota o esqueceu — corte
        # silencioso achado no portão.
        deleted_by = existente["deleted_by"]
        await conn.execute(
            """INSERT INTO contact_events
                   (lead_id, dnia_id, source_app, event_type, title, metadata)
               VALUES ($1::uuid, $3::uuid, 'marketinghs', 'contact_reactivated',
                       'Contato reativado por nova conversão', $2)""",
            existente["id"],
            {"previous_deleted_at": str(existente["deleted_at"]),
             "previous_deleted_by": str(deleted_by) if deleted_by else None,
             "reason": "captura_reconversao"},
            existente["dnia_id"])


async def _resolver_identidade(conn, lead_id: str, email: str, campos: dict) -> None:
    """Chama `resolve_or_create_identity` e escreve de volta o que ela resolveu.

    ⚠️ A function devolve `jsonb` (tipo escalar), não um conjunto de colunas —
    conferido em produção em 08/09/2026 com `\\df+` e uma chamada real. `SELECT
    * FROM resolve_or_create_identity(...)` dá uma linha com UMA coluna, de
    nome igual ao da function, carregando o dict inteiro — não colunas
    `dnia_id` / `phone_normalized` soltas. Por isso a chamada abaixo vai na
    lista de SELECT, não no FROM, e `fetchval` devolve o dict já decodificado
    pelo mesmo codec jsonb que `app.database._preparar_conexao` registra.

    ⚠️ **Não levanta — mas o `try/except` sozinho NÃO bastava.** `sessao()`
    entrega a conexão já dentro de `conn.transaction()`; `capturar()` inteiro
    é UMA transação só. Se `resolve_or_create_identity` levantar erro DE
    BANCO (ex.: `ecosystem_identities_phone_key UNIQUE (phone)` — dois leads
    reais com o mesmo telefone de escritório, caso comum na base da HS), o
    Postgres aborta o bloco de transação inteiro; um `except` comum engole a
    exceção Python mas não desfaz o aborto, e a instrução seguinte (o INSERT
    em `lead_conversions`) morre com `InFailedSQLTransactionError` sem
    tratamento — a captura vira 500 e o lead real é recusado, exatamente o
    que a regra "nenhum caminho de falha nosso pode recusar um lead real"
    proíbe. O `async with conn.transaction():` aninhado aqui dentro faz o
    asyncpg emitir um `SAVEPOINT` de verdade (confirmado lendo
    `asyncpg.transaction.Transaction.start`); o `except` então faz
    `ROLLBACK TO SAVEPOINT`, não aborta o resto da transação, e o INSERT
    seguinte roda normalmente. Identidade é enriquecimento: falhar nela não
    pode custar a conversão nem a tag.
    """
    try:
        async with conn.transaction():
            resultado = await conn.fetchval(
                _SQL_RESOLVE_IDENTIDADE,
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
