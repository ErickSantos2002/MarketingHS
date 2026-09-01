"""Campanhas. Substitui a `campaigns-api`.

⚠️ Este lote (3A) NÃO envia. O enfileirador, o worker e o Resend chegam no 3B;
o agendamento, no 3C. Se você está escrevendo uma chamada ao Resend aqui, parou
no lote errado.
"""

import logging

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, usuario_atual

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/campanhas", tags=["campanhas"])

COLUNAS = """
    c.id::text, c.name, c.channel, c.status, c.subject, c.body,
    c.scheduled_at::text, c.sent_at::text, c.stats, c.design,
    c.segment_ids::text[] AS segment_ids,
    c.excluded_segment_ids::text[] AS excluded_segment_ids,
    c.created_at::text, c.updated_at::text
"""

# Os nomes dos segmentos numa subconsulta lateral, não numa segunda viagem.
NOMES_DOS_SEGMENTOS = """
    LEFT JOIN LATERAL (
        SELECT array_agg(g.name ORDER BY g.name) AS nomes
          FROM segments g WHERE g.id = ANY(c.segment_ids)
    ) s ON true
"""

AMOSTRA_ENVIOS = 50


@router.get("")
async def listar(
    estado: str | None = Query(None, alias="status"),
    canal: str | None = Query(None, alias="channel"),
    pagina: int = Query(1, alias="page", ge=1),
    limite: int = Query(20, alias="limit", ge=1, le=100),
    _: Usuario = Depends(usuario_atual),
):
    """Lista paginada, com os NOMES dos segmentos já resolvidos.

    ⚠️ Os nomes vêm numa subconsulta lateral, não numa segunda ida ao banco por
    campanha. A `campaigns-api` buscava as campanhas e depois fazia um segundo
    `select` em `segments` com todos os ids — já era melhor que N+1, mas ainda
    são duas viagens e uma junção montada no navegador.
    """
    async with sessao(role="service_role") as conn:
        total = await conn.fetchval(
            """SELECT count(*) FROM campaigns
                WHERE ($1::text IS NULL OR status = $1)
                  AND ($2::text IS NULL OR channel = $2)""",
            estado, canal)
        linhas = await conn.fetch(
            f"""SELECT {COLUNAS}, s.nomes AS segment_names
                  FROM campaigns c {NOMES_DOS_SEGMENTOS}
                 WHERE ($1::text IS NULL OR c.status = $1)
                   AND ($2::text IS NULL OR c.channel = $2)
                 ORDER BY c.created_at DESC
                 LIMIT $3 OFFSET $4""",
            estado, canal, limite, (pagina - 1) * limite)
    return {
        "data": [{**dict(l), "segment_names": l["segment_names"] or []}
                 for l in linhas],
        "pagination": {"page": pagina, "limit": limite, "total": total,
                       "pages": (total + limite - 1) // limite},
    }


@router.get("/{campanha_id}")
async def detalhe(campanha_id: str, _: Usuario = Depends(usuario_atual)):
    """A campanha, os nomes dos segmentos e uma amostra dos envios.

    ⚠️ `stats` é lido da coluna, NÃO recalculado aqui. Quem calcula é
    `finalize_campaign_if_drained`, no banco, quando a fila drena. Uma segunda
    contagem nesta rota divergiria da primeira no meio de um envio, e a tela
    mostraria um número que o banco não confirma.
    """
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            f"""SELECT {COLUNAS}, s.nomes AS segment_names
                  FROM campaigns c {NOMES_DOS_SEGMENTOS}
                 WHERE c.id = $1::uuid""",
            campanha_id)
        if linha is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Campanha não encontrada.")

        envios = await conn.fetch(
            """SELECT cs.id::text, cs.status, cs.sent_at::text,
                      cs.opened_at::text, cs.clicked_at::text, cs.error,
                      l.id::text AS lead_id, l.nome, l.email
                 FROM campaign_sends cs
                 LEFT JOIN leads l ON l.id = cs.lead_id
                WHERE cs.campaign_id = $1::uuid
                ORDER BY cs.created_at DESC
                LIMIT $2""",
            campanha_id, AMOSTRA_ENVIOS)

    return {**dict(linha),
            "segment_names": linha["segment_names"] or [],
            "sends": [dict(e) for e in envios]}
