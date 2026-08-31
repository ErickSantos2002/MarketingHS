"""Leitura de contatos para o admin.

Substitui o acesso direto ao banco do AdminDataProvider, que é o hub de dados
de todo o painel.

⚠️ Ordem de registro importa: rota literal (`/duplicatas`) tem de vir ANTES de
rota paramétrica (`/{lead_id}`), ou o FastAPI casa "duplicatas" como se fosse um
id e a rota literal nunca é alcançada.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, usuario_atual

router = APIRouter(prefix="/contatos", tags=["contatos-leitura"])

# As 33 colunas que o painel consome. Espelha LEAD_COLUMNS em
# frontend/src/hooks/useLeads.tsx — as duas listas têm de andar juntas.
COLUNAS_LEAD = """
    id::text, created_at::text, updated_at::text, tipo, tipo_participante,
    session_id, nome, email, whatsapp, cargo, empresa, faturamento,
    funcionarios, desafios, source, utm_source, utm_medium, utm_campaign,
    utm_term, utm_content, etiqueta, origem_campanha, presenca,
    interesse_ecossistema, interesse_mtia, interesse_formacao,
    data_interesse::text, last_conversion_date::text, indicacao,
    dnia_id::text, status, lead_score, deleted_at::text
"""

TAMANHO_PAGINA_MAX = 1000


class PaginaContatos(BaseModel):
    itens: list[dict]
    tem_mais: bool


class EnriquecimentoIn(BaseModel):
    # POST e não GET: a lista passa de 200 ids e não cabe em query string.
    dnia_ids: list[str] = Field(min_length=1, max_length=10000)


class NotaIn(BaseModel):
    conteudo: str = Field(min_length=1, max_length=5000)


@router.get("", response_model=PaginaContatos)
async def listar(
    pagina: int = Query(0, ge=0),
    tamanho: int = Query(1000, ge=1, le=TAMANHO_PAGINA_MAX),
    incluir_apagados: bool = Query(False),
    _: Usuario = Depends(usuario_atual),
):
    """Uma página da tabela de leads.

    ⚠️ `id DESC` como desempate não é enfeite. `updated_at` fica igual em toda a
    base depois de um recálculo de scores (lote 1A), e `ORDER BY` com valores
    empatados não garante ordem estável entre páginas — a paginação passaria a
    pular e repetir contatos, e ninguém notaria olhando uma tela só.
    """
    filtro = "" if incluir_apagados else "WHERE deleted_at IS NULL"
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            f"""SELECT {COLUNAS_LEAD} FROM leads {filtro}
                 ORDER BY updated_at DESC, id DESC
                 LIMIT $1 OFFSET $2""",
            tamanho + 1, pagina * tamanho,
        )
    tem_mais = len(linhas) > tamanho
    return PaginaContatos(itens=[dict(l) for l in linhas[:tamanho]], tem_mais=tem_mais)


@router.get("/conversoes-utm")
async def conversoes_utm(_: Usuario = Depends(usuario_atual)):
    """Mapa lead_id -> utm_contents das conversões.

    O hook paginava lead_conversions de 1000 em 1000 e agrupava no navegador.
    Isso é agregação; o banco faz numa consulta.
    """
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            """SELECT lead_id::text, array_agg(DISTINCT utm_content) AS utm_contents
                 FROM lead_conversions
                WHERE utm_content IS NOT NULL AND lead_id IS NOT NULL
                GROUP BY lead_id""")
    return {l["lead_id"]: l["utm_contents"] for l in linhas}


@router.get("/duplicatas")
async def duplicatas(_: Usuario = Depends(usuario_atual)):
    """Identidades que compartilham e-mail ou telefone.

    Só mostra. A fusão é do lote 1D — merge_identities mexe em várias tabelas e
    merece o seu próprio lote.
    """
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            """
            WITH repetidos AS (
                SELECT lower(email) AS chave, 'email' AS tipo
                  FROM ecosystem_identities
                 WHERE email IS NOT NULL AND email <> ''
                 GROUP BY lower(email) HAVING count(*) > 1
                UNION ALL
                SELECT phone AS chave, 'telefone' AS tipo
                  FROM ecosystem_identities
                 WHERE phone IS NOT NULL AND phone <> ''
                 GROUP BY phone HAVING count(*) > 1
            )
            SELECT r.tipo, r.chave,
                   json_agg(json_build_object(
                     'dnia_id', ei.dnia_id::text, 'nome', ei.nome,
                     'email', ei.email, 'phone', ei.phone, 'stage', ei.stage,
                     'lead_id', ei.dndash_lead_id::text,
                     'created_at', ei.created_at::text
                   ) ORDER BY ei.created_at) AS identidades
              FROM repetidos r
              JOIN ecosystem_identities ei
                ON (r.tipo = 'email'    AND lower(ei.email) = r.chave)
                OR (r.tipo = 'telefone' AND ei.phone = r.chave)
             GROUP BY r.tipo, r.chave
             ORDER BY r.tipo, r.chave
            """)
    return [dict(l) for l in linhas]


@router.post("/enriquecimento")
async def enriquecimento(dados: EnriquecimentoIn, _: Usuario = Depends(usuario_atual)):
    """Marca, por identidade, presença nos outros sistemas e agendamento aberto.

    A regra do agendamento vem de useContactsEnriched e tem três partes:

      1. Eventos legados de agendamento (`scheduling_widget_booked`,
         `meeting_scheduled`) contam como aberto sempre — não têm ciclo de vida.
      2. Uma atividade do Nexus abre com `activity_created` de tipo meeting ou
         demo, e fecha com completed / cancelled / no_show / deleted, casadas
         pelo `activity_id` do metadata.
      3. A identidade tem agendamento aberto se qualquer atividade dela abriu e
         não fechou.

    Atividade que só tem evento de fechamento, ou que abriu com tipo diferente
    de meeting/demo, não conta — igual ao original.
    """
    ids = dados.dnia_ids
    async with sessao(role="service_role") as conn:
        identidades = await conn.fetch(
            """SELECT dnia_id::text, nexus_contact_id::text, mentoria_client_id::text
                 FROM ecosystem_identities WHERE dnia_id = ANY($1::uuid[])""",
            ids)
        sinais = await conn.fetch(
            """
            WITH eventos AS (
                SELECT dnia_id, source_app, event_type, metadata
                  FROM contact_events
                 WHERE dnia_id = ANY($1::uuid[])
            ),
            atividades AS (
                SELECT dnia_id,
                       metadata->>'activity_id' AS atividade,
                       bool_or(event_type = 'activity_created'
                               AND lower(coalesce(metadata->>'type','')) IN ('meeting','demo')) AS abriu,
                       bool_or(event_type IN ('activity_completed','activity_cancelled',
                                              'activity_no_show','activity_deleted')) AS fechou
                  FROM eventos
                 WHERE metadata->>'activity_id' IS NOT NULL
                 GROUP BY dnia_id, metadata->>'activity_id'
            )
            SELECT e.dnia_id::text,
                   bool_or(e.source_app = 'nexus')    AS tem_eventos_nexus,
                   bool_or(e.source_app = 'mentoria') AS tem_eventos_mentoria,
                   bool_or(e.event_type IN ('scheduling_widget_booked','meeting_scheduled'))
                     OR coalesce(bool_or(a.abriu AND NOT a.fechou), false) AS tem_agendamento_aberto
              FROM eventos e
              LEFT JOIN atividades a ON a.dnia_id = e.dnia_id
             GROUP BY e.dnia_id
            """,
            ids)

    por_id = {s["dnia_id"]: dict(s) for s in sinais}
    return {
        i["dnia_id"]: {
            "nexus_contact_id": i["nexus_contact_id"],
            "mentoria_client_id": i["mentoria_client_id"],
            "tem_eventos_nexus": por_id.get(i["dnia_id"], {}).get("tem_eventos_nexus", False),
            "tem_eventos_mentoria": por_id.get(i["dnia_id"], {}).get("tem_eventos_mentoria", False),
            "tem_agendamento_aberto": por_id.get(i["dnia_id"], {}).get("tem_agendamento_aberto", False),
        }
        for i in identidades
    }


@router.get("/{lead_id}")
async def ficha(lead_id: str, _: Usuario = Depends(usuario_atual)):
    """Lead, tags e notas numa volta só.

    A tela recarrega o lead depois de cada mudança para pegar `etiqueta` e
    `lead_score`. Quem recalcula é só o trigger do banco — o scoring do cliente
    foi removido neste lote.
    """
    async with sessao(role="service_role") as conn:
        lead = await conn.fetchrow(
            f"SELECT {COLUNAS_LEAD} FROM leads WHERE id = $1::uuid", lead_id)
        if lead is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Contato não encontrado.")
        tags = await conn.fetch(
            """SELECT t.id::text, t.name AS nome, t.color AS cor
                 FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id
                WHERE lt.lead_id = $1::uuid ORDER BY t.name""", lead_id)
        notas = await conn.fetch(
            """SELECT id::text, content AS conteudo, created_at::text
                 FROM lead_notes WHERE lead_id = $1::uuid
                ORDER BY created_at DESC""", lead_id)
    return {"lead": dict(lead), "tags": [dict(x) for x in tags],
            "notas": [dict(n) for n in notas]}


@router.get("/{lead_id}/eventos")
async def eventos(lead_id: str, limite: int = Query(50, ge=1, le=500),
                  _: Usuario = Depends(usuario_atual)):
    """Histórico do contato, incluindo o que veio de outros sistemas.

    ⚠️ Filtra por `lead_id` OU pelo `dnia_id` do contato. Evento vindo de outro
    sistema do ecossistema chega com `dnia_id` e sem `lead_id` — filtrar só pelo
    segundo esconderia justamente o histórico cross-app, que é a razão de a
    ficha existir. E a FK `contact_events.lead_id` é ON DELETE SET NULL: evento
    de contato apagado sobrevive correlacionado só pelo `dnia_id`.
    """
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            """SELECT ce.id::text, ce.source_app, ce.event_type, ce.title,
                      ce.description, ce.metadata, ce.occurred_at::text
                 FROM contact_events ce
                WHERE ce.lead_id = $1::uuid
                   OR ce.dnia_id = (SELECT dnia_id FROM leads WHERE id = $1::uuid)
                ORDER BY ce.occurred_at DESC
                LIMIT $2""",
            lead_id, limite)
    return [dict(l) for l in linhas]


@router.post("/{lead_id}/notas", status_code=status.HTTP_201_CREATED)
async def criar_nota(lead_id: str, dados: NotaIn, _: Usuario = Depends(usuario_atual)):
    async with sessao(role="service_role") as conn:
        existe = await conn.fetchval("SELECT 1 FROM leads WHERE id = $1::uuid", lead_id)
        if not existe:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Contato não encontrado.")
        linha = await conn.fetchrow(
            """INSERT INTO lead_notes (lead_id, content) VALUES ($1::uuid, $2)
               RETURNING id::text, content AS conteudo, created_at::text""",
            lead_id, dados.conteudo.strip())
    return dict(linha)


@router.delete("/{lead_id}/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remover_tag(lead_id: str, tag_id: str, _: Usuario = Depends(usuario_atual)):
    async with sessao(role="service_role") as conn:
        await conn.execute(
            "DELETE FROM lead_tags WHERE lead_id = $1::uuid AND tag_id = $2::uuid",
            lead_id, tag_id)
