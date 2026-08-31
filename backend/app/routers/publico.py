"""A porta pública: endpoints que sistemas EXTERNOS chamam, autenticados por
chave de API.

Ficam sob `/publico` porque é esse prefixo que o limite de taxa do lote 0 cobre.
"""

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
