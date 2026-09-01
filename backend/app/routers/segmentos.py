"""Segmentos. A lógica de regra mora no Postgres — aqui só a exposição.

Oito funções de segmento sobreviveram ao port do schema e estão em produção há
meses: `build_segment_condition`, `evaluate_segment_rules`,
`preview_segment_rules`, `evaluate_segment_for_lead`, `resolve_segment_audience`,
`count_segment_audience` e os dois triggers. Nenhuma delas é reimplementada
aqui — transformar regra em SQL é trabalho do banco, e reescrever isso em Python
seria trocar código provado por código novo sem ganho.
"""

import logging

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, usuario_atual

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/segmentos", tags=["segmentos"])


# ⚠️ lead_id que não existe é erro de quem chama, não bug do servidor. Sem esta
# tradução a violação de chave estrangeira sobe como 500 — e 500 manda quem
# depura procurar defeito no lugar errado.
CONTATO_INEXISTENTE = "Um ou mais contatos informados não existem."


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


@router.post("", status_code=status.HTTP_201_CREATED)
async def criar(dados: SegmentoIn, _: Usuario = Depends(usuario_atual)):
    """Cria o segmento e, se for estático, os membros — na MESMA transação.

    ⚠️ A tela gravava o segmento e só então inseria os membros, em lotes de 100.
    Falhar no meio deixava um segmento com parte dos contatos, e nada indicava
    que estava pela metade. Aqui ou nasce inteiro, ou não nasce.
    """
    try:
        async with sessao(role="service_role") as conn:
            segmento_id = await conn.fetchval(
                """INSERT INTO segments (name, description, type, rules, logic)
                   VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING id""",
                dados.nome.strip(), dados.descricao, dados.tipo,
                [r.model_dump() for r in dados.regras], dados.logica)

            if dados.tipo == "static" and dados.lead_ids:
                # unnest em vez de laço de lotes: uma instrução, e o banco cuida
                # do volume.
                await conn.execute(
                    """INSERT INTO segment_contacts (segment_id, lead_id)
                       SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING""",
                    segmento_id, dados.lead_ids)
    except asyncpg.exceptions.ForeignKeyViolationError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, CONTATO_INEXISTENTE)

    return {"id": str(segmento_id)}


@router.put("/{segmento_id}")
async def editar(segmento_id: str, dados: SegmentoIn,
                 _: Usuario = Depends(usuario_atual)):
    """⚠️ A tela apagava TODOS os membros e reinseria. Havia uma janela em que o
    segmento ficava vazio, e se a reinserção falhasse ele ficava vazio para
    sempre. Na transação a janela não existe: quem consultar durante a operação
    vê o estado antigo, e quem consultar depois vê o novo.
    """
    try:
        async with sessao(role="service_role") as conn:
            r = await conn.execute(
                """UPDATE segments SET name = $2, description = $3, type = $4,
                                       rules = $5::jsonb, logic = $6, updated_at = now()
                    WHERE id = $1::uuid""",
                segmento_id, dados.nome.strip(), dados.descricao, dados.tipo,
                [x.model_dump() for x in dados.regras], dados.logica)
            if r.endswith(" 0"):
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Segmento não encontrado.")

            if dados.tipo == "static" and dados.lead_ids is not None:
                await conn.execute(
                    "DELETE FROM segment_contacts WHERE segment_id = $1::uuid",
                    segmento_id)
                if dados.lead_ids:
                    await conn.execute(
                        """INSERT INTO segment_contacts (segment_id, lead_id)
                           SELECT $1::uuid, unnest($2::uuid[]) ON CONFLICT DO NOTHING""",
                        segmento_id, dados.lead_ids)
    except asyncpg.exceptions.ForeignKeyViolationError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, CONTATO_INEXISTENTE)

    return {"id": segmento_id}


@router.post("/{segmento_id}/duplicar", status_code=status.HTTP_201_CREATED)
async def duplicar(segmento_id: str, _: Usuario = Depends(usuario_atual)):
    """Copia o segmento e os membros numa transação. O sufixo é ' (cópia)',
    o mesmo que a tela já usava.

    ⚠️ A tela duplicava com a lista de membros VAZIA — duplicar um segmento
    estático devolvia uma casca sem ninguém dentro. Aqui os membros vêm junto,
    que é o que "duplicar" quer dizer para quem clica.
    """
    async with sessao(role="service_role") as conn:
        novo_id = await conn.fetchval(
            """INSERT INTO segments (name, description, type, rules, logic)
               SELECT name || ' (cópia)', description, type, rules, logic
                 FROM segments WHERE id = $1::uuid
               RETURNING id""",
            segmento_id)
        if novo_id is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Segmento não encontrado.")

        await conn.execute(
            """INSERT INTO segment_contacts (segment_id, lead_id)
               SELECT $2, lead_id FROM segment_contacts WHERE segment_id = $1::uuid
               ON CONFLICT DO NOTHING""",
            segmento_id, novo_id)

    return {"id": str(novo_id)}


@router.delete("/{segmento_id}", status_code=status.HTTP_204_NO_CONTENT)
async def excluir(segmento_id: str, _: Usuario = Depends(usuario_atual)):
    """⚠️ `guard_segment_delete` é um trigger que impede excluir segmento em uso
    por campanha não enviada ou fluxo ativo, e levanta exceção com uma mensagem
    escrita para quem usa:

        Este segmento é usado pela campanha "X" (ainda não enviada).
        Remova-o da campanha antes de excluí-lo.

    Deixar isso virar 500 seria trocar orientação por "Internal Server Error".
    O `except` abaixo devolve a mensagem do banco como 409.
    """
    try:
        async with sessao(role="service_role") as conn:
            r = await conn.execute(
                "DELETE FROM segments WHERE id = $1::uuid", segmento_id)
    except asyncpg.exceptions.RaiseError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc))
    if r.endswith(" 0"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Segmento não encontrado.")
