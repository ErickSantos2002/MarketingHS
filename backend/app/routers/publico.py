"""A porta pública: endpoints que sistemas EXTERNOS chamam, autenticados por
chave de API.

Ficam sob `/publico` porque é esse prefixo que o limite de taxa do lote 0 cobre.
"""

import base64
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.chave_api import ChaveApi, chave_api
from app.database import sessao

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/publico", tags=["publico"])

# Os valores que o trigger `validate_contact_event_source_app` aceita. A lista
# vive nos dois lugares porque o banco precisa dela para validar e a API para
# recusar cedo, com mensagem melhor que uma exceção de trigger.
SOURCE_APPS = ("marketinghs", "dnmarketing", "nexus", "mentoria", "website")


class IdentidadeIn(BaseModel):
    phone: str | None = None
    email: str | None = None
    nome: str | None = None
    source_app: str | None = None
    local_id: str | None = None
    stage: str | None = None
    utm_source: str | None = None
    contact_fields: dict | None = None


class EventoIn(BaseModel):
    source_app: str = Field(pattern="^(marketinghs|dnmarketing|nexus|mentoria|website)$")
    event_type: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    phone: str | None = None
    email: str | None = None
    dnia_id: str | None = None
    nome: str | None = None
    metadata: dict | None = None
    occurred_at: str | None = None


async def _achar_identidade(conn, phone, email, dnia_id):
    """Busca por dnia_id, telefone normalizado ou e-mail — nessa ordem.

    A ordem é a da origem e não é arbitrária: o dnia_id é exato, o telefone
    normalizado é quase exato, e o e-mail é o mais frágil (a mesma pessoa pode
    ter vários).
    """
    if dnia_id:
        return await conn.fetchrow(
            "SELECT * FROM ecosystem_identities WHERE dnia_id = $1::uuid", dnia_id)
    if phone:
        normalizado = await conn.fetchval("SELECT normalize_phone_br($1)", phone)
        return await conn.fetchrow(
            "SELECT * FROM ecosystem_identities WHERE phone = $1", normalizado or phone)
    if email:
        return await conn.fetchrow(
            "SELECT * FROM ecosystem_identities WHERE lower(email) = lower($1)", email.strip())
    return None


@router.get("/identidade")
async def buscar_identidade(
    phone: str | None = Query(None),
    email: str | None = Query(None),
    dnia_id: str | None = Query(None),
    _: ChaveApi = Depends(chave_api("read")),
):
    """Devolve a identidade e, se houver, o contato ligado a ela."""
    if not any((phone, email, dnia_id)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Informe phone, email ou dnia_id.")
    async with sessao(role="service_role") as conn:
        identidade = await _achar_identidade(conn, phone, email, dnia_id)
        if identidade is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Identidade não encontrada.")
        contato = None
        if identidade["dndash_lead_id"]:
            contato = await conn.fetchrow(
                """SELECT nome, email, whatsapp, cargo, faturamento, funcionarios,
                          etiqueta, status, utm_source, utm_campaign, source,
                          created_at::text
                     FROM leads WHERE id = $1""", identidade["dndash_lead_id"])
    return {"identidade": {k: str(v) if k.endswith("_id") and v else v
                           for k, v in dict(identidade).items()},
            "contato": dict(contato) if contato else None}


@router.post("/identidade")
async def gravar_identidade(dados: IdentidadeIn, _: ChaveApi = Depends(chave_api("write"))):
    """Cria ou atualiza a identidade, e cria o contato se ela ainda não tiver um.

    ⚠️ O enriquecimento é NÃO DESTRUTIVO: só preenche campo vazio, nunca
    sobrescreve. É a mesma regra da importação do lote 1A, e pelo mesmo motivo —
    um sistema externo mandando um campo em branco não está pedindo para apagar.
    """
    if not any((dados.phone, dados.email)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Informe phone ou email.")

    campos = dados.contact_fields or {}
    async with sessao(role="service_role") as conn:
        resultado = await conn.fetchval(
            """SELECT resolve_or_create_identity(
                   p_phone => $1, p_email => $2, p_nome => $3, p_source_app => $4,
                   p_local_id => $5::uuid, p_stage => $6, p_utm_source => $7)""",
            dados.phone, dados.email, dados.nome,
            dados.source_app or "marketinghs", dados.local_id,
            dados.stage, dados.utm_source)

        if not resultado or not resultado.get("dnia_id"):
            raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR,
                                "Não foi possível resolver a identidade.")

        dnia_id = resultado["dnia_id"]
        identidade = await conn.fetchrow(
            "SELECT * FROM ecosystem_identities WHERE dnia_id = $1::uuid", dnia_id)

        lead_id = identidade["dndash_lead_id"]
        criou = False
        if lead_id is None:
            lead_id = await conn.fetchval(
                """INSERT INTO leads (tipo, nome, email, whatsapp, phone_normalized,
                                      dnia_id, status, source)
                   VALUES ($1, $2, $3, $4, $5, $6::uuid, 'Lead', $7)
                   RETURNING id""",
                dados.source_app or "externo", dados.nome, dados.email, dados.phone,
                resultado.get("phone_normalized"), dnia_id, dados.source_app)
            await conn.execute(
                "UPDATE ecosystem_identities SET dndash_lead_id = $2 WHERE dnia_id = $1::uuid",
                dnia_id, lead_id)
            criou = True

        # Enriquecimento não destrutivo: COALESCE mantém o que já existe.
        permitidos = ("nome", "cargo", "empresa", "faturamento", "funcionarios", "desafios")
        a_gravar = {k: v for k, v in campos.items() if k in permitidos and v}
        if a_gravar:
            atribuicoes = ", ".join(
                f"{c} = COALESCE(nullif({c}, ''), ${i + 2})" for i, c in enumerate(a_gravar))
            await conn.execute(
                f"UPDATE leads SET {atribuicoes} WHERE id = $1", lead_id, *a_gravar.values())

    return {"dnia_id": str(dnia_id), "lead_id": str(lead_id), "criou_contato": criou}


@router.post("/evento-de-contato")
async def receber_evento(dados: EventoIn, _: ChaveApi = Depends(chave_api("write"))):
    """Recebe um evento de outro sistema do ecossistema.

    ⚠️ `source_app` é validado contra a MESMA lista que o trigger do banco
    aceita. A function de origem aceitava 'website' na validação dela, mas o
    trigger não — e a inserção estourava com exceção de banco. A migration 006
    acertou a lista do banco; aqui o pattern do pydantic recusa cedo, com
    mensagem melhor.
    """
    if not any((dados.phone, dados.email, dados.dnia_id)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Informe phone, email ou dnia_id.")

    # O estágio avança conforme o evento — regra da origem, preservada.
    estagio = ("client" if dados.event_type == "deal_won"
               else "opportunity" if dados.event_type == "opportunity_created"
               else None)

    async with sessao(role="service_role") as conn:
        resultado = await conn.fetchval(
            """SELECT resolve_or_create_identity(
                   p_phone => $1, p_email => $2, p_nome => $3,
                   p_source_app => $4, p_stage => $5)""",
            dados.phone, dados.email, dados.nome, dados.source_app, estagio)
        dnia_id = (resultado or {}).get("dnia_id") or dados.dnia_id
        if not dnia_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                "Não foi possível identificar o contato.")

        lead_id = await conn.fetchval(
            "SELECT dndash_lead_id FROM ecosystem_identities WHERE dnia_id = $1::uuid", dnia_id)

        evento_id = await conn.fetchval(
            """INSERT INTO contact_events (dnia_id, lead_id, source_app, event_type,
                                           title, description, metadata, occurred_at)
               VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb,
                       COALESCE($8::timestamptz, now()))
               RETURNING id""",
            dnia_id, lead_id, dados.source_app, dados.event_type, dados.title,
            dados.description, dados.metadata or {}, dados.occurred_at)

    return {"evento_id": str(evento_id), "dnia_id": str(dnia_id),
            "lead_id": str(lead_id) if lead_id else None}


# ============================================================================
# Leitura pública de contatos
# ============================================================================

# Os tipos de evento que contam como mudança de status. Copiado de
# contacts-list — não invente a lista; ela é a mesma que o lote 1C passou a
# alimentar quando o status muda pelo painel.
TIPOS_MUDANCA_STATUS = (
    "deal_moved", "lead_qualified", "meeting_scheduled",
    "scheduling_widget_booked", "deal_won", "deal_lost", "onboarding_started",
)

# ⚠️ Interpolado como literal, e isso é seguro porque TIPOS_MUDANCA_STATUS é
# uma constante deste módulo — nunca entrada de usuário. Passá-lo como parâmetro
# obrigaria a consulta de CONTAGEM a receber um argumento que ela não usa, e foi
# exatamente esse desencontro que quebrou a primeira versão.
_TIPOS_SQL = "(" + ",".join(f"'{t}'" for t in TIPOS_MUDANCA_STATUS) + ")"

_ULTIMA_MUDANCA = f"""(SELECT MAX(ce.occurred_at) FROM contact_events ce
                        WHERE ce.lead_id = l.id
                          AND ce.event_type IN {_TIPOS_SQL})"""


def _codificar_cursor(created_at: str, id_: str) -> str:
    return base64.b64encode(json.dumps({"c": created_at, "id": id_}).encode()).decode()


def _decodificar_cursor(bruto: str) -> tuple[str, str]:
    try:
        d = json.loads(base64.b64decode(bruto))
        return d["c"], d["id"]
    except Exception:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cursor inválido.")


@router.get("/contatos")
async def listar_contatos_publico(
    q: str | None = Query(None),
    etiqueta: str | None = Query(None),
    status_: str | None = Query(None, alias="status"),
    stage: str | None = Query(None),
    created_after: str | None = Query(None),
    created_before: str | None = Query(None),
    updated_after: str | None = Query(None),
    updated_before: str | None = Query(None),
    status_changed_after: str | None = Query(None),
    cursor: str | None = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=500),
    _: ChaveApi = Depends(chave_api("read")),
):
    """Listagem para consumidor externo, com os dois modos de paginação.

    ⚠️ A function de origem montava SQL cru por CONCATENAÇÃO e o executava via
    `execute_readonly_query`, uma RPC SECURITY DEFINER. A spec decidiu não
    portar isso: era dívida, não ativo. Aqui tudo é parâmetro do asyncpg, o que
    elimina a classe inteira de problema — e de quebra o `tz` malicioso, que a
    origem validava à mão, deixa de ser um vetor.

    Dois modos, como a origem: deslocamento (page/limit, com total) ou cursor
    por (created_at, id). O cursor não devolve total — é o preço de não contar.
    """
    condicoes, params = ["l.deleted_at IS NULL"], []

    def add(sql: str, valor):
        params.append(valor)
        condicoes.append(sql.replace("$?", f"${len(params)}"))

    if q:
        # Um parâmetro só, usado três vezes — por isso não passa pelo `add`,
        # que numera um por chamada.
        params.append(q)
        i = len(params)
        condicoes.append(
            f"(l.nome ILIKE '%'||${i}||'%' OR l.email ILIKE '%'||${i}||'%' "
            f"OR l.whatsapp ILIKE '%'||${i}||'%')")
    if etiqueta:
        add("l.etiqueta = $?", etiqueta)
    if status_:
        add("l.status = $?", status_)
    if stage:
        add("ei.stage = $?", stage)
    for coluna, valor in (("l.created_at >= $?", created_after),
                          ("l.created_at <= $?", created_before),
                          ("l.updated_at >= $?", updated_after),
                          ("l.updated_at <= $?", updated_before)):
        if valor:
            add(coluna.replace("$?", "$?::timestamptz"), valor)

    ultima_mudanca = _ULTIMA_MUDANCA

    if status_changed_after:
        params.append(status_changed_after)
        condicoes.append(f"{ultima_mudanca} >= ${len(params)}::timestamptz")

    if cursor:
        c, cid = _decodificar_cursor(cursor)
        params.extend([c, cid])
        condicoes.append(f"(l.created_at, l.id) < (${len(params)-1}::timestamptz, ${len(params)}::uuid)")

    onde = " AND ".join(condicoes)
    campos = f"""l.id::text, l.nome, l.email, l.whatsapp, l.cargo, l.faturamento,
                 l.etiqueta, l.status, l.utm_source, l.utm_campaign,
                 l.source AS page_slug, l.created_at::text, l.updated_at::text,
                 l.dnia_id::text, l.phone_normalized, ei.stage,
                 ei.nexus_contact_id::text, ei.mentoria_client_id::text,
                 ei.first_touch_source, {ultima_mudanca}::text AS status_changed_at"""
    base = f"""FROM leads l
               LEFT JOIN ecosystem_identities ei ON l.dnia_id = ei.dnia_id
               WHERE {onde}"""

    async with sessao(role="service_role") as conn:
        if cursor:
            linhas = await conn.fetch(
                f"SELECT {campos} {base} ORDER BY l.created_at DESC, l.id DESC LIMIT {limit + 1}",
                *params)
            tem_mais = len(linhas) > limit
            linhas = linhas[:limit]
            proximo = (_codificar_cursor(linhas[-1]["created_at"], linhas[-1]["id"])
                       if tem_mais and linhas else None)
            return {"data": [dict(l) for l in linhas],
                    "pagination": {"limit": limit, "next_cursor": proximo, "has_more": tem_mais}}

        total = await conn.fetchval(f"SELECT count(*) {base}", *params)
        linhas = await conn.fetch(
            f"SELECT {campos} {base} ORDER BY l.created_at DESC, l.id DESC "
            f"LIMIT {limit} OFFSET {(page - 1) * limit}", *params)
    return {"data": [dict(l) for l in linhas],
            "pagination": {"page": page, "limit": limit, "total": total,
                           "pages": -(-total // limit) if total else 0}}


@router.get("/contato")
async def detalhe_contato_publico(
    phone: str | None = Query(None),
    email: str | None = Query(None),
    dnia_id: str | None = Query(None),
    _: ChaveApi = Depends(chave_api("read")),
):
    """Visão 360° por identidade, para consumidor externo.

    ⚠️ NÃO é o mesmo endpoint da ficha do lote 1B. Aquele é por `lead_id` e
    serve à tela; este parte da IDENTIDADE e responde a outra pergunta — "quem é
    esta pessoa no ecossistema inteiro". Chaves diferentes, formatos diferentes,
    consumidores diferentes.
    """
    if not any((phone, email, dnia_id)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Informe phone, email ou dnia_id.")

    async with sessao(role="service_role") as conn:
        identidade = await _achar_identidade(conn, phone, email, dnia_id)
        if identidade is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Contato não encontrado.")

        lead_id = identidade["dndash_lead_id"]
        lead = tags = notas = conversoes = envios = segmentos = None
        if lead_id:
            lead = await conn.fetchrow("SELECT * FROM leads WHERE id = $1", lead_id)
            tags = await conn.fetch(
                """SELECT t.id::text, t.name, t.color FROM lead_tags lt
                     JOIN tags t ON t.id = lt.tag_id WHERE lt.lead_id = $1""", lead_id)
            notas = await conn.fetch(
                """SELECT id::text, content, created_at::text FROM lead_notes
                    WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 10""", lead_id)
            conversoes = await conn.fetch(
                """SELECT id::text, page_slug, converted_at::text, tipo,
                          utm_source, utm_campaign
                     FROM lead_conversions WHERE lead_id = $1
                    ORDER BY converted_at DESC""", lead_id)
            envios = await conn.fetch(
                """SELECT cs.id::text, cs.status, cs.sent_at::text, cs.opened_at::text,
                          cs.clicked_at::text, c.name AS campaign_name
                     FROM campaign_sends cs LEFT JOIN campaigns c ON c.id = cs.campaign_id
                    WHERE cs.lead_id = $1 ORDER BY cs.sent_at DESC NULLS LAST LIMIT 20""",
                lead_id)
            segmentos = await conn.fetch(
                """SELECT s.id::text, s.name, s.type FROM segment_contacts sc
                     JOIN segments s ON s.id = sc.segment_id WHERE sc.lead_id = $1""", lead_id)

        eventos = await conn.fetch(
            """SELECT id::text, source_app, event_type, title, description,
                      metadata, occurred_at::text
                 FROM contact_events
                WHERE dnia_id = $1::uuid OR ($2::uuid IS NOT NULL AND lead_id = $2::uuid)
                ORDER BY occurred_at DESC LIMIT 50""",
            identidade["dnia_id"], lead_id)

    def linhas(x):
        return [dict(i) for i in (x or [])]

    return {
        "identity": {k: (str(v) if v is not None and k.endswith("_id") else v)
                     for k, v in dict(identidade).items()},
        "lead": dict(lead) if lead else None,
        "tags": linhas(tags), "notes": linhas(notas),
        "events": linhas(eventos), "conversions": linhas(conversoes),
        "campaigns": linhas(envios), "segments": linhas(segmentos),
        "ecosystem": {
            "marketinghs": lead_id is not None,
            "nexus": identidade["nexus_contact_id"] is not None,
            "mentoria": identidade["mentoria_client_id"] is not None,
        },
    }
