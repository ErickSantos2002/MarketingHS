"""Segmentos. A lógica de regra mora no Postgres — aqui só a exposição.

Oito funções de segmento sobreviveram ao port do schema e estão em produção há
meses: `build_segment_condition`, `evaluate_segment_rules`,
`preview_segment_rules`, `evaluate_segment_for_lead`, `resolve_segment_audience`,
`count_segment_audience` e os dois triggers. Nenhuma delas é reimplementada
aqui — transformar regra em SQL é trabalho do banco, e reescrever isso em Python
seria trocar código provado por código novo sem ganho.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, usuario_atual

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/segmentos", tags=["segmentos"])


class RegraIn(BaseModel):
    field: str
    operator: str
    value: str


class SegmentoIn(BaseModel):
    nome: str = Field(min_length=1, max_length=200)
    descricao: str | None = None
    tipo: str = Field(pattern="^(static|dynamic)$")
    regras: list[RegraIn] = Field(default_factory=list)
    logica: str = Field(default="and", pattern="^(and|or)$")
    # Só para estático: a lista de membros.
    lead_ids: list[str] | None = None


@router.get("")
async def listar(_: Usuario = Depends(usuario_atual)):
    """Lista os segmentos com a contagem de contatos já resolvida.

    ⚠️ Uma consulta, não N+1. A tela buscava os segmentos e depois, para CADA
    um, fazia outra ida ao banco para contar — dez segmentos eram onze
    consultas. O LATERAL abaixo resolve os dois tipos numa passada: estático
    conta linhas de segment_contacts, dinâmico chama evaluate_segment_rules.
    """
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            """SELECT s.id::text, s.name AS nome, s.description AS descricao,
                      s.type AS tipo, s.rules AS regras,
                      COALESCE(s.logic, 'and') AS logica,
                      s.created_at::text, s.updated_at::text,
                      c.total AS total_contatos
                 FROM segments s
                 LEFT JOIN LATERAL (
                     SELECT CASE
                         WHEN s.type = 'dynamic'
                           THEN (SELECT count(*) FROM evaluate_segment_rules(s.id))
                         ELSE (SELECT count(*) FROM segment_contacts sc
                                WHERE sc.segment_id = s.id)
                     END AS total
                 ) c ON true
                ORDER BY s.created_at DESC"""
        )
    return [dict(l) for l in linhas]
