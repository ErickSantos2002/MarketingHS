"""A API de contato para sistema externo: o que eram `contact-update`,
`contact-status-update` e `contact-tags-sync`.

Fica sob `/publico` porque é esse prefixo que o limite de taxa do lote 0
cobre, e porque quem chama é máquina, com chave de API — nunca a tela.

⚠️ As respostas têm a FORMA DA ORIGEM (chaves em inglês): quem consome é
sistema de terceiro, e mudar o formato quebraria integração que não passa por
nós.

⚠️ Status desconhecido é 400, não criação automática — ver `_resolver_status`
em `escrita_contatos.py`. A origem criava; o lote 1D decidiu que não.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.chave_api import ChaveApi, chave_api
from app.database import sessao
from app.routers.escrita_contatos import _registrar_mudanca, _resolver_status

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/publico", tags=["api-contato"])

# Colunas que a atualização pode tocar. Lista fechada: o UPDATE nunca é montado
# a partir das chaves do corpo. `status` fica de fora de propósito — passa por
# `_resolver_status` e grava evento.
_CAMPOS = ("nome", "cargo", "whatsapp", "empresa", "faturamento",
           "funcionarios", "desafios")

DESCRICAO_API = "Mudança de status pela API"


def normalizar_tag(bruta) -> str:
    """O `normalizeTag` do `contact-tags-sync`: sem `/` na frente, sem espaço
    nas pontas, minúscula. Vale para as duas rotas que mexem em tag — a origem
    do `contact-update` não normalizava, e as duas discordavam."""
    return str(bruta or "").lstrip("/").strip().lower()


async def _id_da_tag(conn, nome: str) -> tuple[str, bool]:
    """Acha a tag sem diferenciar maiúscula, ou cria. Devolve (id, criada).

    ⚠️ `tags_name_key` é único na coluna crua; a busca por `lower(name)` evita
    criar "vip" ao lado de um "VIP" que já existia, como `tags-em-lote` do admin.
    """
    existente = await conn.fetchval(
        "SELECT id::text FROM tags WHERE lower(name) = lower($1) LIMIT 1", nome)
    if existente:
        return existente, False
    criada = await conn.fetchval(
        "INSERT INTO tags (name) VALUES ($1) ON CONFLICT (name) DO NOTHING "
        "RETURNING id::text", nome)
    if criada:
        return criada, True
    # Outra requisição criou no meio do caminho.
    return await conn.fetchval("SELECT id::text FROM tags WHERE name = $1", nome), False


async def _lead_por_identificador(conn, dnia_id: UUID | None, email: str | None,
                                  phone: str | None):
    """A ordem da origem: dnia_id, depois e-mail, depois telefone.

    Diferente da origem, que fazia `limit(1)` sem ordem: pelo `dnia_id` vence o
    lead CANÔNICO da identidade (`dndash_lead_id`, lote 5C), e nos outros o
    mais recente — o mesmo critério de `_resolver_lead` em `publico.py`.
    """
    colunas = "id::text AS id, dnia_id::text AS dnia_id, status"
    if dnia_id:
        canonico = await conn.fetchrow(
            f"""SELECT {colunas} FROM leads WHERE id =
                  (SELECT dndash_lead_id FROM ecosystem_identities WHERE dnia_id = $1::uuid)""",
            str(dnia_id))
        if canonico:
            return canonico
        return await conn.fetchrow(
            f"SELECT {colunas} FROM leads WHERE dnia_id = $1::uuid "
            "ORDER BY created_at DESC LIMIT 1", str(dnia_id))
    if email:
        return await conn.fetchrow(
            f"SELECT {colunas} FROM leads WHERE lower(email) = lower($1) "
            "ORDER BY created_at DESC LIMIT 1", email.strip())
    normalizado = await conn.fetchval("SELECT normalize_phone_br($1)", phone)
    return await conn.fetchrow(
        f"""SELECT {colunas} FROM leads
             WHERE ($1::text IS NOT NULL AND phone_normalized = $1) OR whatsapp = $2
             ORDER BY created_at DESC LIMIT 1""", normalizado, phone.strip())


class AtualizacaoIn(BaseModel):
    status: str | None = Field(default=None, min_length=1, max_length=60)
    nome: str | None = None
    cargo: str | None = None
    whatsapp: str | None = None
    empresa: str | None = None
    faturamento: str | None = None
    funcionarios: str | None = None
    desafios: str | None = None
    tags_add: list[str] | None = None
    tags_remove: list[str] | None = None
    note: str | None = Field(default=None, max_length=10000)


@router.patch("/contato")
async def atualizar_contato(
    dados: AtualizacaoIn,
    dnia_id: UUID | None = Query(None),
    email: str | None = Query(None),
    phone: str | None = Query(None),
    _: ChaveApi = Depends(chave_api("write")),
):
    """O que era `contact-update`.

    ⚠️ Registra `contact_updated` SEMPRE, mesmo sem mudança — como a origem. É o
    rastro de que o integrador chamou.
    """
    if not (dnia_id or email or phone):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Informe phone, email ou dnia_id como query param.")
    enviados = dados.model_dump(exclude_unset=True)

    async with sessao(role="service_role") as conn:
        lead = await _lead_por_identificador(conn, dnia_id, email, phone)
        if lead is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Contato não encontrado.")
        lead_id = lead["id"]
        atualizados: list[str] = []

        # O status é resolvido ANTES de qualquer escrita: status inválido não
        # pode deixar a outra metade do pedido gravada.
        novo_status = None
        if enviados.get("status"):
            novo_status = await _resolver_status(conn, enviados["status"])

        if novo_status is not None:
            await conn.execute("UPDATE leads SET status = $2 WHERE id = $1::uuid",
                               lead_id, novo_status)
            # `gravar_generico=False`: esta rota grava o PRÓPRIO `contact_updated`
            # mais abaixo, juntando status com os outros campos num evento só —
            # sem isso, duplicaria o genérico (e a linha de `journey_events` que
            # o gatilho copia de cada `contact_events`).
            await _registrar_mudanca(conn, lead_id, lead["status"], novo_status,
                                     origem="api", descricao=DESCRICAO_API,
                                     gravar_generico=False)
            atualizados.append("status")

        campos = {c: enviados[c] for c in _CAMPOS if c in enviados}
        if campos:
            atribuicoes = ", ".join(f"{c} = ${i + 2}" for i, c in enumerate(campos))
            await conn.execute(f"UPDATE leads SET {atribuicoes} WHERE id = $1::uuid",
                               lead_id, *campos.values())
            atualizados.extend(campos)

        mexeu_em_tag = False
        for bruta in enviados.get("tags_add") or []:
            nome = normalizar_tag(bruta)
            if not nome:
                continue
            tag_id, _criada = await _id_da_tag(conn, nome)
            await conn.execute(
                "INSERT INTO lead_tags (lead_id, tag_id) VALUES ($1::uuid, $2::uuid) "
                "ON CONFLICT DO NOTHING", lead_id, tag_id)
            mexeu_em_tag = True
        for bruta in enviados.get("tags_remove") or []:
            nome = normalizar_tag(bruta)
            if not nome:
                continue
            await conn.execute(
                """DELETE FROM lead_tags WHERE lead_id = $1::uuid AND tag_id IN
                     (SELECT id FROM tags WHERE lower(name) = lower($2))""",
                lead_id, nome)
            mexeu_em_tag = True
        if mexeu_em_tag:
            atualizados.append("tags")

        if enviados.get("note"):
            await conn.execute(
                "INSERT INTO lead_notes (lead_id, content) VALUES ($1::uuid, $2)",
                lead_id, enviados["note"])
            atualizados.append("note")

        # UM `contact_updated` por chamada — nunca dois. Quando a chamada mudou
        # status, este evento também carrega `de`/`para`/`status_anterior`/
        # `status_atual`: são as chaves que `GET /painel/agendamentos/mql-hoje`
        # (painel.py) e o histórico de status leem, e que `_registrar_mudanca`
        # não gravou aqui (`gravar_generico=False` acima).
        metadata_evento = {"fields_updated": atualizados, "source": "api"}
        if novo_status is not None:
            metadata_evento.update({
                "de": lead["status"], "para": novo_status,
                "status_anterior": lead["status"], "status_atual": novo_status,
            })
        await conn.execute(
            """INSERT INTO contact_events (lead_id, dnia_id, source_app, event_type,
                                           title, metadata)
               SELECT $1::uuid, l.dnia_id, 'marketinghs', 'contact_updated',
                      'Contato atualizado via API', $2::jsonb
                 FROM leads l WHERE l.id = $1::uuid""",
            lead_id, metadata_evento)

        final = await conn.fetchrow(
            "SELECT dnia_id::text AS dnia_id, lead_score, etiqueta FROM leads "
            "WHERE id = $1::uuid", lead_id)

    return {"success": True, "dnia_id": final["dnia_id"],
            "updated_fields": atualizados,
            "lead_score": final["lead_score"] or 0,
            "etiqueta": final["etiqueta"]}
