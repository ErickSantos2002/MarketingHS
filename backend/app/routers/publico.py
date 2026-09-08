"""A porta pública: endpoints que sistemas EXTERNOS chamam, autenticados por
chave de API.

Ficam sob `/publico` porque é esse prefixo que o limite de taxa do lote 0 cobre.
"""

import base64
import hmac
import json
import logging
import re

import asyncpg

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.chave_api import ChaveApi, chave_api
from app.database import sessao
from app.routers.automacoes import (
    RegraIn, RegraPatch, atualizar_regra, inserir_regra,
)
from app.email.montagem import assinar_token, normalizar_email
from app.integracoes import ler_segredo

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


# ── Segmentos ────────────────────────────────────────────────────────────────
# Porta a `segments-api`. A forma da resposta segue a da origem (`data` +
# `pagination`, `contacts_count`, `contacts`) porque quem consome é sistema de
# terceiro: mudar o formato aqui quebraria integração que não passa por nós.

class SegmentoPublicoIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    type: str = Field(default="dynamic", pattern="^(static|dynamic)$")
    description: str | None = None
    rules: list[dict] = Field(default_factory=list)
    logic: str = Field(default="and", pattern="^(and|or)$")
    contact_ids: list[str] | None = None


class ContatosPublicoIn(BaseModel):
    contact_ids: list[str] = Field(min_length=1, max_length=10000)


# Uma amostra, não a base inteira: a origem devolvia 20 contatos na ficha do
# segmento e isso é o que o consumidor externo espera.
AMOSTRA_CONTATOS = 20


@router.get("/segmentos")
async def listar_segmentos(
    tipo: str | None = Query(None, alias="type", pattern="^(static|dynamic)$"),
    pagina: int = Query(1, alias="page", ge=1),
    limite: int = Query(20, alias="limit", ge=1, le=100),
    _: ChaveApi = Depends(chave_api("read")),
):
    """Lista paginada, com a contagem de contatos de cada segmento.

    ⚠️ A contagem sai da MESMA consulta, como no endpoint do admin. A origem
    percorria os segmentos e disparava uma RPC ou uma contagem por segmento —
    numa página de 100, cento e uma idas ao banco.
    """
    # O filtro vai por parâmetro em vez de entrar na string: `$1 IS NULL OR
    # type = $1` deixa as duas consultas com a mesma forma e sem SQL montado
    # por concatenação.
    async with sessao(role="service_role") as conn:
        total = await conn.fetchval(
            "SELECT count(*) FROM segments WHERE $1::text IS NULL OR type = $1",
            tipo)
        linhas = await conn.fetch(
            """SELECT s.id::text, s.name, s.description, s.type, s.rules,
                      s.logic, s.created_at::text, s.updated_at::text,
                      c.total AS contacts_count
                 FROM segments s
                 LEFT JOIN LATERAL (
                     SELECT CASE
                         WHEN s.type = 'dynamic'
                           THEN (SELECT count(*) FROM evaluate_segment_rules(s.id))
                         ELSE (SELECT count(*) FROM segment_contacts sc
                                WHERE sc.segment_id = s.id)
                     END AS total
                 ) c ON true
                WHERE $1::text IS NULL OR s.type = $1
                ORDER BY s.created_at DESC
                LIMIT $2 OFFSET $3""",
            tipo, limite, (pagina - 1) * limite)
    return {
        "data": [dict(l) for l in linhas],
        "pagination": {
            "page": pagina, "limit": limite, "total": total,
            "pages": (total + limite - 1) // limite,
        },
    }


@router.get("/segmentos/{segmento_id}")
async def segmento(segmento_id: str, _: ChaveApi = Depends(chave_api("read"))):
    """Um segmento e uma amostra dos contatos dele.

    ⚠️ `deleted_at IS NULL`, igual ao endpoint do admin: contato na lixeira não
    pertence mais a segmento nenhum, e quem consome esta rota costuma usar a
    resposta para disparar mensagem.
    """
    async with sessao(role="service_role") as conn:
        seg = await conn.fetchrow(
            """SELECT id::text, name, description, type, rules, logic,
                      created_at::text, updated_at::text
                 FROM segments WHERE id = $1::uuid""", segmento_id)
        if seg is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Segmento não encontrado")

        if seg["type"] == "dynamic":
            contatos = await conn.fetch(
                """SELECT l.id::text, l.nome, l.email, l.whatsapp, l.etiqueta, l.status
                     FROM evaluate_segment_rules($1::uuid) r
                     JOIN leads l ON l.id = r.lead_id
                    WHERE l.deleted_at IS NULL
                    ORDER BY l.created_at DESC LIMIT $2""",
                segmento_id, AMOSTRA_CONTATOS)
        else:
            contatos = await conn.fetch(
                """SELECT l.id::text, l.nome, l.email, l.whatsapp, l.etiqueta, l.status
                     FROM segment_contacts sc
                     JOIN leads l ON l.id = sc.lead_id
                    WHERE sc.segment_id = $1::uuid AND l.deleted_at IS NULL
                    ORDER BY l.created_at DESC LIMIT $2""",
                segmento_id, AMOSTRA_CONTATOS)

    return {**dict(seg), "contacts": [dict(c) for c in contatos]}


@router.post("/segmentos", status_code=status.HTTP_201_CREATED)
async def criar_segmento(dados: SegmentoPublicoIn,
                         _: ChaveApi = Depends(chave_api("write"))):
    """Cria o segmento e, se estático, os membros — na mesma transação.

    ⚠️ A origem inseria os membros DEPOIS, fora de qualquer transação e sem
    esperar o resultado: falhar ali deixava um segmento pela metade e devolvia
    201 assim mesmo.
    """
    try:
        async with sessao(role="service_role") as conn:
            novo = await conn.fetchrow(
                """INSERT INTO segments (name, description, type, rules, logic)
                   VALUES ($1, $2, $3, $4::jsonb, $5)
                   RETURNING id::text, name, description, type, rules, logic,
                             created_at::text, updated_at::text""",
                dados.name.strip(), dados.description, dados.type,
                dados.rules, dados.logic)
            if dados.type == "static" and dados.contact_ids:
                await conn.execute(
                    """INSERT INTO segment_contacts (segment_id, lead_id)
                       SELECT $1::uuid, unnest($2::uuid[]) ON CONFLICT DO NOTHING""",
                    novo["id"], dados.contact_ids)
    except asyncpg.exceptions.ForeignKeyViolationError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Um ou mais contatos informados não existem")
    return {"success": True, "segment": dict(novo)}


@router.post("/segmentos/{segmento_id}/contatos")
async def adicionar_contatos_publico(
    segmento_id: str, dados: ContatosPublicoIn,
    _: ChaveApi = Depends(chave_api("write")),
):
    """Adiciona contatos a um segmento estático."""
    try:
        async with sessao(role="service_role") as conn:
            tipo = await conn.fetchval(
                "SELECT type FROM segments WHERE id = $1::uuid", segmento_id)
            if tipo is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Segmento não encontrado")
            if tipo != "static":
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    "Só é possível adicionar contatos a segmentos estáticos")
            await conn.execute(
                """INSERT INTO segment_contacts (segment_id, lead_id)
                   SELECT $1::uuid, unnest($2::uuid[]) ON CONFLICT DO NOTHING""",
                segmento_id, dados.contact_ids)
    except asyncpg.exceptions.ForeignKeyViolationError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Um ou mais contatos informados não existem")
    return {"success": True, "segment_id": segmento_id,
            "contacts_added": len(dados.contact_ids)}


# ── Descadastro ──────────────────────────────────────────────────────────────
# Porte de `email-unsubscribe`. A outra ponta do HMAC que o worker assina.

class DescadastroIn(BaseModel):
    lid: str
    e: str
    t: str


def _b64url_decodifica(s: str) -> str:
    """Inverso do encoder do worker: decodifica os BYTES utf-8.

    ⚠️ Decodificar como Latin-1 (o que `atob` sozinho faz) daria mojibake em
    endereço com acento — e o MAC, calculado sobre a string errada, não
    bateria. O original corrigiu isso e o porte precisa manter.
    """
    resto = len(s) % 4
    completo = s + ("=" * (4 - resto) if resto else "")
    return base64.urlsafe_b64decode(completo).decode("utf-8")


async def _conferir_token(lid: str, e: str, t: str) -> str:
    """Devolve o e-mail normalizado, ou levanta 400/401.

    ⚠️ O segredo vem de `integracoes.ler_segredo` — a MESMA função que o worker
    usa para assinar. Ler de fontes diferentes faria todo descadastro dar 401,
    e o defeito só apareceria quando um contato reclamasse.
    """
    if not lid or not e or not t:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Requisição incompleta.")
    try:
        email = normalizar_email(_b64url_decodifica(e))
    except Exception:  # noqa: BLE001
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Requisição inválida.")
    if not email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Requisição inválida.")

    segredo = await ler_segredo("UNSUBSCRIBE_SECRET")
    if not segredo:
        logger.error("descadastro: UNSUBSCRIBE_SECRET ausente")
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR,
                            "Servidor mal configurado.")

    # A MESMA função que o worker usa para assinar — ver o aviso em
    # `assinar_token`. Reimplementar o MAC aqui seria criar a segunda
    # implementação que um dia diverge.
    esperado = assinar_token(lid, email, segredo)
    # compare_digest, nunca `==`: comparação de string sai no primeiro byte
    # diferente, e isso é medível. ⚠️ Os dois lados como str — misturar str e
    # bytes levanta TypeError, pegadinha que já mordeu no GestorHS.
    if not hmac.compare_digest(str(t), str(esperado)):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token inválido.")
    return email


@router.get("/descadastro")
async def descadastro_conferir(lid: str = Query(...), e: str = Query(...),
                               t: str = Query(...)):
    """SÓ valida o token e devolve o e-mail, para a página montar a confirmação.

    ⚠️ NENHUMA escrita acontece aqui. A RFC 8058 exige que o link clicável do
    corpo do e-mail — pré-carregado por muitos clientes — não tenha efeito
    colateral. Se o GET descadastrasse, o contato sairia da lista sem ter
    clicado em nada, só porque o cliente de e-mail buscou o link.
    """
    email = await _conferir_token(lid, e, t)
    return {"ok": True, "email": email}


@router.post("/descadastro")
async def descadastro_efetivar(dados: DescadastroIn):
    """Descadastra de fato. É o que o botão nativo do Gmail/Yahoo chama."""
    email = await _conferir_token(dados.lid, dados.e, dados.t)

    # 1. A supressão é o ÚNICO efeito que precisa dar certo. Se falhar,
    #    respondemos 500 para que o provedor re-tente o POST one-click — a lista
    #    de descadastro é a fonte da verdade de compliance, e um 200 com a
    #    gravação falhada perderia o pedido em silêncio.
    async with sessao(role="service_role") as conn:
        await conn.execute(
            """INSERT INTO email_suppressions (email, reason, source, lead_id)
               VALUES ($1, 'unsubscribe', 'descadastro', $2::uuid)
               ON CONFLICT (email) DO NOTHING""",
            email, dados.lid)

    # 2. Marcar o último envio como 'unsubscribed' — best-effort, nunca derruba
    #    a resposta: a supressão acima já impede envios futuros.
    try:
        async with sessao(role="service_role") as conn:
            # ⚠️ NULLS LAST é obrigatório: existem linhas 'pending' com sent_at
            # nulo, e NULL vem PRIMEIRO num ORDER BY DESC — sem isso o
            # descadastro marcaria uma campanha ainda na fila.
            #
            # ⚠️ Os status terminais são preservados. Sobrescrever um 'bounced'
            # ou 'suppressed' por 'unsubscribed' apagaria o motivo real e
            # sugeriria, falsamente, que o e-mail chegou a sair.
            await conn.execute(
                """UPDATE campaign_sends SET status = 'unsubscribed'
                    WHERE id = (
                        SELECT id FROM campaign_sends
                         WHERE lead_id = $1::uuid AND channel = 'email'
                           AND status NOT IN ('pending','bounced','complained',
                                              'failed','unsubscribed','suppressed')
                         ORDER BY sent_at DESC NULLS LAST
                         LIMIT 1)""",
                dados.lid)
    except Exception:  # noqa: BLE001
        logger.exception("descadastro: falha ao marcar o último envio")

    # 3. Evento na timeline — best-effort pelo mesmo motivo.
    try:
        async with sessao(role="service_role") as conn:
            await conn.execute(
                """INSERT INTO contact_events
                       (dnia_id, lead_id, source_app, event_type, title,
                        metadata, occurred_at)
                   SELECT l.dnia_id, l.id, 'marketinghs', 'email_unsubscribed',
                          'Descadastrou-se de e-mails',
                          jsonb_build_object('email', $2::text), now()
                     FROM leads l WHERE l.id = $1::uuid""",
                dados.lid, email)
    except Exception:  # noqa: BLE001
        logger.exception("descadastro: falha ao registrar o evento")

    return {"ok": True, "email": email}


# ── Campanhas e templates (a metade pública) ─────────────────────────────────
# O 3A portou a metade do admin e descobriu, pelo portão, que `campaigns-api` e
# `templates-api` também aceitam chave de API — servem integrador externo. Esta
# é a outra metade.
#
# ⚠️ A origem montava a agregação de estatísticas interpolando o id em SQL cru e
# executando por `execute_readonly_query`, uma RPC SECURITY DEFINER. A spec
# decidiu não portar isso ("era dívida, não ativo"). Aqui tudo é parâmetro, e a
# agregação é a MESMA do admin — uma verdade só.

class CampanhaPublicaIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    channel: str = Field(default="email", pattern="^(email|whatsapp)$")
    subject: str | None = None
    body: str | None = None
    segment_ids: list[str] = Field(default_factory=list)
    excluded_segment_ids: list[str] = Field(default_factory=list)


@router.get("/campanhas")
async def listar_campanhas_publico(
    estado: str | None = Query(None, alias="status"),
    canal: str | None = Query(None, alias="channel"),
    pagina: int = Query(1, alias="page", ge=1),
    limite: int = Query(20, alias="limit", ge=1, le=100),
    _: ChaveApi = Depends(chave_api("read")),
):
    """Lista paginada, com nomes de segmento e estatísticas ao vivo."""
    from app.routers.campanhas import (
        COLUNAS, ESTATISTICAS_AO_VIVO, NOMES_DOS_SEGMENTOS, _campanha,
    )
    async with sessao(role="service_role") as conn:
        total = await conn.fetchval(
            """SELECT count(*) FROM campaigns
                WHERE ($1::text IS NULL OR status = $1)
                  AND ($2::text IS NULL OR channel = $2)""",
            estado, canal)
        linhas = await conn.fetch(
            f"""SELECT {COLUNAS}, s.nomes AS segment_names, v.numeros AS stats_ao_vivo
                  FROM campaigns c {NOMES_DOS_SEGMENTOS} {ESTATISTICAS_AO_VIVO}
                 WHERE ($1::text IS NULL OR c.status = $1)
                   AND ($2::text IS NULL OR c.channel = $2)
                 ORDER BY c.created_at DESC
                 LIMIT $3 OFFSET $4""",
            estado, canal, limite, (pagina - 1) * limite)
    return {
        "data": [_campanha(l) for l in linhas],
        "pagination": {"page": pagina, "limit": limite, "total": total,
                       "pages": (total + limite - 1) // limite},
    }


@router.get("/campanhas/{campanha_id}")
async def campanha_publico(campanha_id: str,
                           _: ChaveApi = Depends(chave_api("read"))):
    """A campanha e uma amostra dos envios."""
    from app.routers.campanhas import (
        COLUNAS, ESTATISTICAS_AO_VIVO, NOMES_DOS_SEGMENTOS, _campanha,
    )
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            f"""SELECT {COLUNAS}, s.nomes AS segment_names, v.numeros AS stats_ao_vivo
                  FROM campaigns c {NOMES_DOS_SEGMENTOS} {ESTATISTICAS_AO_VIVO}
                 WHERE c.id = $1::uuid""",
            campanha_id)
        if linha is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Campanha não encontrada")
        envios = await conn.fetch(
            """SELECT cs.id::text, cs.lead_id::text, cs.dnia_id::text, cs.channel,
                      cs.status, cs.sent_at::text, cs.opened_at::text,
                      cs.clicked_at::text, cs.error
                 FROM campaign_sends cs
                WHERE cs.campaign_id = $1::uuid
                ORDER BY cs.sent_at DESC NULLS LAST
                LIMIT 20""",
            campanha_id)
    return {**_campanha(linha), "sends": [dict(e) for e in envios]}


@router.post("/campanhas", status_code=status.HTTP_201_CREATED)
async def criar_campanha_publico(dados: CampanhaPublicaIn,
                                 _: ChaveApi = Depends(chave_api("write"))):
    """⚠️ Nasce sempre em `draft`, como no admin. O status não vem do corpo:
    permitir `sending` deixaria um integrador externo disparar sem passar pelo
    enfileirador, e o worker pegaria uma campanha que ninguém mandou enviar."""
    async with sessao(role="service_role") as conn:
        novo = await conn.fetchval(
            """INSERT INTO campaigns (name, channel, status, subject, body,
                                      segment_ids, excluded_segment_ids)
               VALUES ($1, $2, 'draft', $3, $4, $5::uuid[], $6::uuid[])
               RETURNING id""",
            dados.name.strip(), dados.channel, dados.subject, dados.body,
            dados.segment_ids, dados.excluded_segment_ids)
    return {"success": True, "campaign": {"id": str(novo)}}


@router.post("/campanhas/{campanha_id}/enviar")
async def enviar_campanha_publico(campanha_id: str,
                                  _: ChaveApi = Depends(chave_api("write"))):
    """O `?action=send` da `campaigns-api`.

    ⚠️ Reusa o MESMO enfileirador da rota do admin e do agendador. Um terceiro
    caminho de envio seria a terceira implementação da mesma coisa.
    """
    from app.routers.envio import enfileirar
    return await enfileirar(campanha_id)


class TemplatePublicoIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    category: str | None = None
    design: dict | None = None
    html: str | None = None


COLUNAS_TEMPLATE = ("id::text, name, description, category, design, html, "
                    "created_at::text, updated_at::text")


@router.get("/templates")
async def listar_templates_publico(
    categoria: str | None = Query(None, alias="category"),
    pagina: int = Query(1, alias="page", ge=1),
    limite: int = Query(20, alias="limit", ge=1, le=100),
    _: ChaveApi = Depends(chave_api("read")),
):
    async with sessao(role="service_role") as conn:
        total = await conn.fetchval(
            "SELECT count(*) FROM email_templates "
            "WHERE $1::text IS NULL OR category = $1", categoria)
        linhas = await conn.fetch(
            f"""SELECT {COLUNAS_TEMPLATE} FROM email_templates
                 WHERE $1::text IS NULL OR category = $1
                 ORDER BY updated_at DESC, id DESC
                 LIMIT $2 OFFSET $3""",
            categoria, limite, (pagina - 1) * limite)
    return {
        "data": [dict(l) for l in linhas],
        "pagination": {"page": pagina, "limit": limite, "total": total,
                       "pages": (total + limite - 1) // limite},
    }


@router.get("/templates/{template_id}")
async def template_publico(template_id: str,
                           _: ChaveApi = Depends(chave_api("read"))):
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            f"SELECT {COLUNAS_TEMPLATE} FROM email_templates WHERE id = $1::uuid",
            template_id)
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Template não encontrado")
    return dict(linha)


@router.post("/templates", status_code=status.HTTP_201_CREATED)
async def criar_template_publico(dados: TemplatePublicoIn,
                                 _: ChaveApi = Depends(chave_api("write"))):
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            f"""INSERT INTO email_templates (name, description, category, design, html)
                VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING {COLUNAS_TEMPLATE}""",
            dados.name.strip(), dados.description, dados.category,
            dados.design, dados.html)
    return {"success": True, "template": dict(linha)}


# ---------------------------------------------------------------------------
# Automações — a metade pública. Substitui a `automations-api`.
#
# ⚠️ A tela não é o portão inteiro: `automations-api` aceitava CHAVE DE API com
# escopo read/write, não só o admin. Portar a tela de Automações não a torna
# órfã — integrador externo continua do outro lado, e a URL está ensinada na
# tela de Documentação da API e no `dnmarketing-api.yaml`. Mesma armadilha de
# `campaigns-api` e `templates-api` no lote 3A.
#
# ⚠️ O que estas rotas fazem é CADASTRO. Nenhuma regra dispara: as três ações
# possíveis são o Nexus, que é o lote 5.
# ---------------------------------------------------------------------------

def _regra_publica(l) -> dict:
    """A forma que a `automations-api` devolvia, incluindo as duas strings
    derivadas (`condition` e `action`) que a documentação pública promete."""
    d = dict(l)
    d["conditions"] = d.get("conditions") or []
    meta = d.get("action_metadata") or {}
    d["action_metadata"] = meta
    d["condition"] = (f"{d['condition_type']} {d['condition_operator']} "
                      f"{d['condition_value']}")
    estagio = meta.get("stage_name") if isinstance(meta, dict) else None
    d["action"] = f"{d['action_type']}{' em ' + estagio if estagio else ''}"
    return d


@router.get("/automacoes")
async def listar_automacoes_publico(_: ChaveApi = Depends(chave_api("read"))):
    from app.routers.automacoes import COLUNAS as COLUNAS_REGRA
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            f"""SELECT {COLUNAS_REGRA} FROM automation_rules
                 ORDER BY priority DESC, created_at""")
    return {"data": [_regra_publica(l) for l in linhas]}


@router.post("/automacoes", status_code=status.HTTP_201_CREATED)
async def criar_automacao_publico(dados: RegraIn,
                                  _: ChaveApi = Depends(chave_api("write"))):
    """⚠️ O INSERT é o mesmo da rota de admin, e a validação do vocabulário é do
    trigger `validate_automation_rule_fields` — a mensagem dele volta como 400."""
    return {"success": True, "rule": {"id": await inserir_regra(dados)}}


@router.patch("/automacoes/{regra_id}")
async def editar_automacao_publico(regra_id: str, dados: RegraPatch,
                                   _: ChaveApi = Depends(chave_api("write"))):
    """A documentação pública ensina o PATCH como o jeito de ativar e desativar
    uma regra. É a rota que mais é chamada de fora; não pode sumir."""
    await atualizar_regra(regra_id, dados)
    return {"success": True, "rule": {"id": regra_id}}


# ---------------------------------------------------------------------------
# Conversões — o que era register-/update-/unregister-conversion
# ---------------------------------------------------------------------------

# Herdado de `apply-lead-tag`, e fica. O slug chega pelo corpo do request; sem
# guarda, `tags.name` vira campo de texto livre escrito de fora.
TAG_VALIDA = re.compile(r"^[a-z0-9][a-z0-9._\-/]*$")
TAG_MAX = 60


class ConversaoIn(BaseModel):
    """O corpo de `POST /publico/conversao`.

    ⚠️ `ab_test`/`ab_var`/`ab_vid` não existiam na function `register-conversion`
    — quem gravava as três colunas era `frontend/src/lib/leadConversion.ts`, que
    este lote apaga. Elas entram aqui para que apagar o cliente não leve junto
    a atribuição de teste A/B: as colunas existem em `lead_conversions` e a
    landing do próximo lote vai precisar delas. É exatamente o corte silencioso
    que o portão do lote 6 deixou passar três vezes.
    """
    lead_id: str | None = None
    dnia_id: str | None = None
    email: str | None = None
    phone: str | None = None
    tipo: str = Field(min_length=1, max_length=80)
    page_slug: str = Field(min_length=1, max_length=200)
    session_id: str | None = None
    converted_at: str | None = None
    utm_source: str | None = None
    utm_medium: str | None = None
    utm_campaign: str | None = None
    utm_term: str | None = None
    utm_content: str | None = None
    source: str | None = None
    ab_test: str | None = None
    ab_var: str | None = None
    ab_vid: str | None = None
    apply_tag: bool = True


async def _resolver_lead(conn, dados: ConversaoIn) -> str | None:
    """As quatro estratégias do `register-conversion`, na ordem da origem.

    A ordem não é arbitrária e não pode ser trocada: `dnia_id` é exato; o
    e-mail é o mais frágil (a mesma pessoa pode ter várias linhas — daí o
    `ORDER BY created_at DESC`, que faz vencer a mais recente); o telefone
    tenta o normalizado antes do cru; e a quarta é a rede de segurança para
    lead criado por `/publico/identidade` antes de qualquer normalização.

    Devolve `None` quando não acha — quem chama transforma em 404. Não invente
    lead: criar contato aqui faria a rota de conversão virar rota de captura.
    """
    if dados.lead_id:
        return dados.lead_id

    email = dados.email.strip().lower() if dados.email else None
    telefone_cru = str(dados.phone).strip() if dados.phone else None
    telefone = None
    if telefone_cru:
        telefone = await conn.fetchval(
            "SELECT normalize_phone_br($1)", telefone_cru)

    if dados.dnia_id:
        achado = await conn.fetchval(
            "SELECT id::text FROM leads WHERE dnia_id = $1::uuid LIMIT 1",
            dados.dnia_id)
        if achado:
            return achado

    if email:
        achado = await conn.fetchval(
            """SELECT id::text FROM leads WHERE lower(email) = $1
                ORDER BY created_at DESC LIMIT 1""", email)
        if achado:
            return achado

    if telefone:
        achado = await conn.fetchval(
            """SELECT id::text FROM leads WHERE phone_normalized = $1
                ORDER BY created_at DESC LIMIT 1""", telefone)
        if achado:
            return achado

    if telefone_cru:
        achado = await conn.fetchval(
            """SELECT id::text FROM leads WHERE whatsapp = $1
                ORDER BY created_at DESC LIMIT 1""", telefone_cru)
        if achado:
            return achado

    if email or telefone:
        # ⚠️ E-mail tem precedência sobre telefone, como na origem: quando os
        # dois vêm, procura só por e-mail. Trocar isso muda qual lead recebe a
        # conversão em base com telefone repetido.
        linha = await conn.fetchrow(
            """SELECT dnia_id::text AS dnia_id,
                      dndash_lead_id::text AS lead_id
                 FROM ecosystem_identities
                WHERE ($1::text IS NOT NULL AND lower(email) = $1)
                   OR ($1::text IS NULL AND $2::text IS NOT NULL AND phone = $2)
                LIMIT 1""", email, telefone)
        if linha:
            if linha["lead_id"]:
                return linha["lead_id"]
            if linha["dnia_id"]:
                return await conn.fetchval(
                    """SELECT id::text FROM leads WHERE dnia_id = $1::uuid
                        ORDER BY created_at DESC LIMIT 1""", linha["dnia_id"])
    return None


async def _aplicar_tag_do_slug(conn, lead_id: str, page_slug: str) -> str | None:
    """A tag derivada do slug, aplicada na MESMA transação da conversão.

    Era a function `apply-lead-tag`, chamada por HTTP e fire-and-forget: se
    falhasse, ninguém ficava sabendo e a conversão ficava sem tag. Aqui, ou as
    duas coisas acontecem, ou nenhuma.

    Devolve a tag aplicada, ou `None` quando o slug não passa na guarda — e
    não levanta: tag é efeito secundário da conversão, e recusar a conversão
    inteira por causa de um slug estranho seria pior que não etiquetar.
    """
    tag = page_slug.lstrip("/").strip().lower()
    if not tag or len(tag) > TAG_MAX or not TAG_VALIDA.match(tag):
        return None
    tag_id = await conn.fetchval(
        """INSERT INTO tags (name) VALUES ($1)
           ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
        RETURNING id""", tag)
    await conn.execute(
        """INSERT INTO lead_tags (lead_id, tag_id) VALUES ($1::uuid, $2)
           ON CONFLICT (lead_id, tag_id) DO NOTHING""", lead_id, tag_id)
    return tag


async def _recalcular_datas(conn, lead_ids: list[str]) -> None:
    """Recalcula `leads.last_conversion_date` do zero para os leads dados.

    ⚠️ Isto NÃO é redundante com o gatilho. `trg_update_last_conversion_date`
    é AFTER INSERT e usa `greatest()`: ele só sobe a data. Depois de apagar ou
    de mover uma conversão para trás, é preciso recalcular, senão a data fica
    apontando para uma conversão que não existe mais — sem erro, sem aviso.

    Uma instrução para o conjunto todo, e não o laço por lead da function
    original: o `unregister-conversion` fazia duas consultas por lead afetado.
    """
    if not lead_ids:
        return
    await conn.execute(
        """UPDATE leads l
              SET last_conversion_date = (SELECT max(c.converted_at)
                                            FROM lead_conversions c
                                           WHERE c.lead_id = l.id)
            WHERE l.id = ANY($1::uuid[])""", lead_ids)


@router.post("/conversao", status_code=status.HTTP_201_CREATED)
async def registrar_conversao(dados: ConversaoIn,
                              _: ChaveApi = Depends(chave_api("write"))):
    """Registra uma conversão. Era a function `register-conversion`.

    ⚠️ `role="service_role"`: o chamador é máquina, autenticada por chave de
    API — não há `user_id` para pôr em `auth.uid()`, então a RLS de
    `lead_conversions` não tem como expressar esta autorização. Quem autoriza
    é o escopo `write` da chave, aqui na rota. É o mesmo desenho das outras
    rotas de `/publico`.

    ⚠️ `last_conversion_date` NÃO é escrito aqui. O gatilho
    `trg_update_last_conversion_date` já grava, e com `greatest()`. A function
    original escrevia por cima, sem `greatest()` — o que fazia uma conversão
    registrada com `converted_at` no passado BAIXAR a data do lead. Deixar o
    gatilho ser o dono do campo conserta isso de graça.
    """
    if not (dados.lead_id or dados.dnia_id or dados.email or dados.phone):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Informe 'lead_id', 'dnia_id', 'email' ou 'phone' para identificar o lead.")

    async with sessao(role="service_role") as conn:
        lead_id = await _resolver_lead(conn, dados)
        if lead_id is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Lead não encontrado.")

        conversao = await conn.fetchrow(
            """INSERT INTO lead_conversions
                   (lead_id, tipo, converted_at, page_slug, session_id,
                    utm_source, utm_medium, utm_campaign, utm_term, utm_content,
                    source, ab_test, ab_var, ab_vid)
               VALUES ($1::uuid, $2, COALESCE($3::text::timestamptz, now()), $4, $5,
                       $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING id::text, lead_id::text, tipo, converted_at::text,
                      page_slug, session_id, source,
                      utm_source, utm_medium, utm_campaign, utm_term, utm_content,
                      ab_test, ab_var, ab_vid""",
            lead_id, dados.tipo, dados.converted_at, dados.page_slug,
            dados.session_id, dados.utm_source, dados.utm_medium,
            dados.utm_campaign, dados.utm_term, dados.utm_content,
            dados.source, dados.ab_test, dados.ab_var, dados.ab_vid)

        # As mesmas colunas que a function carimbava no lead — e só quando o
        # valor veio. `COALESCE` guarda o que já estava lá.
        await conn.execute(
            """UPDATE leads SET
                   source       = COALESCE($2, source),
                   tipo         = COALESCE($3, tipo),
                   utm_source   = COALESCE($4, utm_source),
                   utm_medium   = COALESCE($5, utm_medium),
                   utm_campaign = COALESCE($6, utm_campaign),
                   utm_term     = COALESCE($7, utm_term),
                   utm_content  = COALESCE($8, utm_content)
                 WHERE id = $1::uuid""",
            lead_id, dados.source or None, dados.tipo or None,
            dados.utm_source or None, dados.utm_medium or None,
            dados.utm_campaign or None, dados.utm_term or None,
            dados.utm_content or None)

        tag = None
        if dados.apply_tag:
            tag = await _aplicar_tag_do_slug(conn, lead_id, dados.page_slug)

    return {"success": True, "lead_id": lead_id,
            "conversion": dict(conversao), "tag": tag}


class ConversaoPatch(BaseModel):
    session_id: str = Field(min_length=1, max_length=200)
    converted_at: str = Field(min_length=1)


class ConversaoDelete(BaseModel):
    session_id: str = Field(min_length=1, max_length=200)


# ⚠️ `source_app` do evento de auditoria: 'marketinghs', não o 'dnmarketing'
# que as functions escreviam. Os dois passam no gatilho
# `validate_contact_event_source_app`. Escolhido 'marketinghs' porque é este
# sistema que escreve agora, e porque não há linha anterior para ficar
# incoerente: `lead_conversions` está vazia, logo nunca houve evento
# 'conversion_updated' nem 'conversion_unregistered'.
APP_DA_CONVERSAO = "marketinghs"


@router.patch("/conversao")
# ⚠️ Alias de compatibilidade: `update-conversion`, a function de origem,
# aceitava PATCH OU POST na MESMA url — e é o que a documentação publicada em
# `ApiDocumentation.tsx` promete a quem integra ("Aceita PATCH ou POST"). O
# alias não pode viver em `POST /conversao`: esse caminho já é
# `registrar_conversao` (a criação), e o FastAPI/Starlette não escolhe entre
# duas rotas pelo corpo — quando duas rotas competem pelo MESMO (método,
# caminho), só a registrada primeiro no arquivo é alcançável; a segunda vira
# código morto (medido com `TestClient`: um POST de atualização mandado para
# `/conversao` sempre caiu no handler de criação e voltou 422 por falta de
# `tipo`/`page_slug`). Por isso o alias mora em `/conversao/atualizar`, um
# caminho que não colide com nada.
@router.post("/conversao/atualizar")
async def atualizar_conversao(dados: ConversaoPatch,
                              _: ChaveApi = Depends(chave_api("write"))):
    """Move a data de todas as conversões de uma sessão. Era `update-conversion`."""
    async with sessao(role="service_role") as conn:
        antes = await conn.fetch(
            """SELECT id::text, lead_id::text, converted_at::text
                 FROM lead_conversions WHERE session_id = $1""",
            dados.session_id)
        if not antes:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND,
                "Nenhuma conversão para o session_id informado.")

        try:
            atualizadas = await conn.fetch(
                """UPDATE lead_conversions SET converted_at = $2::text::timestamptz
                    WHERE session_id = $1
                RETURNING id::text, lead_id::text, converted_at::text,
                          tipo, page_slug, session_id""",
                dados.session_id, dados.converted_at)
        except (asyncpg.DataError, ValueError):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "'converted_at' precisa ser um timestamp ISO 8601 válido.")

        leads = sorted({l["lead_id"] for l in antes if l["lead_id"]})
        await _recalcular_datas(conn, leads)

        for lead_id in leads:
            await conn.execute(
                """INSERT INTO contact_events
                       (lead_id, source_app, event_type, title, metadata)
                   VALUES ($1::uuid, $2, 'conversion_updated', $3, $4)""",
                lead_id, APP_DA_CONVERSAO,
                f"Conversão atualizada (session_id: {dados.session_id})",
                {"session_id": dados.session_id,
                 "new_converted_at": dados.converted_at,
                 "previous": [{"id": l["id"], "converted_at": l["converted_at"]}
                              for l in antes if l["lead_id"] == lead_id]})

    return {"success": True, "affected": len(antes),
            "updated": [dict(l) for l in atualizadas]}


@router.delete("/conversao")
# ⚠️ Mesmo motivo do alias de `atualizar_conversao` acima: `POST /conversao`
# já é a criação, então o alias de `unregister-conversion` ("Aceita DELETE ou
# POST") mora em `/conversao/remover` — caminho que não compete com nada.
@router.post("/conversao/remover")
async def remover_conversao(
    dados: ConversaoDelete | None = None,
    session_id: str | None = Query(None),
    _: ChaveApi = Depends(chave_api("write")),
):
    """Apaga as conversões de uma sessão. Era `unregister-conversion`.

    ⚠️ O recálculo depois do DELETE é obrigatório e é o motivo de esta rota
    existir em vez de um DELETE cru: o gatilho da tabela só sobe a data.

    ⚠️ `session_id` aceita corpo OU query string — é o que a documentação
    publicada promete ("body ou query param") e o que a function original
    fazia (`body.session_id || url.searchParams.get('session_id')`). Quando
    os dois vierem, o CORPO VENCE, na mesma ordem da origem. O corpo é
    OPCIONAL por isso: a origem tolerava corpo ausente (`content-length`
    vazio), e `DELETE /conversao?session_id=xxx` sem corpo nenhum precisa
    continuar funcionando.
    """
    sid = (dados.session_id if dados else None) or session_id
    if not sid:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Informe 'session_id'.")

    async with sessao(role="service_role") as conn:
        antes = await conn.fetch(
            """SELECT id::text, lead_id::text, converted_at::text,
                      tipo, page_slug, session_id
                 FROM lead_conversions WHERE session_id = $1""",
            sid)
        if not antes:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND,
                "Nenhuma conversão para o session_id informado.")

        await conn.execute(
            "DELETE FROM lead_conversions WHERE session_id = $1", sid)

        leads = sorted({l["lead_id"] for l in antes if l["lead_id"]})
        await _recalcular_datas(conn, leads)

        for lead_id in leads:
            removidas = [dict(l) for l in antes if l["lead_id"] == lead_id]
            await conn.execute(
                """INSERT INTO contact_events
                       (lead_id, source_app, event_type, title, metadata)
                   VALUES ($1::uuid, $2, 'conversion_unregistered', $3, $4)""",
                lead_id, APP_DA_CONVERSAO,
                f"Conversão removida (session_id: {sid})",
                {"session_id": sid,
                 "removed_count": len(removidas), "removed": removidas})

    return {"success": True, "affected": len(antes),
            "deleted": [dict(l) for l in antes]}
