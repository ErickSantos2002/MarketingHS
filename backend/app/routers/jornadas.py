"""Jornadas (fluxos). Substitui a `journeys-api`.

⚠️ O trabalho pesado está no banco e NÃO se reimplementa aqui. Dez funções de
jornada sobreviveram ao port e estão em produção há meses:
`journey_claim_due_runs`, `journey_wake_on_event`, `journey_enroll_event`,
`journey_enroll_segment`, `journey_node_metrics`, `validate_journey_graph`,
`evaluate_rules_for_lead`, `evaluate_segment_for_lead`, e os dois triggers.
Confira com `\\df` antes de escrever qualquer coisa parecida.

⚠️ `authenticated` + `admin_atual` desde 01/10/2026. `journeys` é admin-only
no RLS e `journey_runs` é SELECT admin — as rotas só LEEM execuções; quem as
escreve é o worker, como máquina. Teste: `tests/test_conversao_authenticated.py`.
"""

import logging

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, admin_atual

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/jornadas", tags=["jornadas"])

COLUNAS = """
    j.id::text, j.name, j.description, j.status, j.entry_type, j.entry_config,
    j.reentry, j.reentry_cooldown_hours, j.entry_node_id, j.nodes,
    j.created_at::text, j.updated_at::text
"""

# A contagem de execuções por estado, numa subconsulta lateral. A origem buscava
# TODOS os runs de TODOS os fluxos e agregava no navegador — funciona com
# dezenas de fluxos e para de funcionar sem avisar.
CONTAGEM_DE_EXECUCOES = """
    LEFT JOIN LATERAL (
        SELECT jsonb_build_object(
            'active',  count(*) FILTER (WHERE r.state = 'active'),
            'waiting', count(*) FILTER (WHERE r.state = 'waiting'),
            'done',    count(*) FILTER (WHERE r.state = 'done'),
            'failed',  count(*) FILTER (WHERE r.state = 'failed'),
            'exited',  count(*) FILTER (WHERE r.state = 'exited')
        ) AS numeros
          FROM journey_runs r WHERE r.journey_id = j.id
    ) e ON true
"""

ESTADOS = ("draft", "active", "paused", "archived")


class JornadaIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    entry_type: str = Field(pattern="^(segment|event)$")
    entry_config: dict = Field(default_factory=dict)
    reentry: str = Field(default="once", pattern="^(once|allowed)$")
    reentry_cooldown_hours: int | None = Field(default=None, gt=0)
    entry_node_id: str | None = None
    nodes: list[dict] = Field(default_factory=list)


class JornadaPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    status: str | None = Field(default=None, pattern="^(draft|active|paused|archived)$")
    entry_type: str | None = Field(default=None, pattern="^(segment|event)$")
    entry_config: dict | None = None
    reentry: str | None = Field(default=None, pattern="^(once|allowed)$")
    reentry_cooldown_hours: int | None = Field(default=None, gt=0)
    entry_node_id: str | None = None
    nodes: list[dict] | None = None


CASTS = {"entry_config": "::jsonb", "nodes": "::jsonb"}


def _sem_execucoes() -> dict:
    return {"active": 0, "waiting": 0, "done": 0, "failed": 0, "exited": 0}


@router.get("")
async def listar(usuario: Usuario = Depends(admin_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            f"""SELECT {COLUNAS}, e.numeros AS runs
                  FROM journeys j {CONTAGEM_DE_EXECUCOES}
                 ORDER BY j.created_at DESC""")
    return {"data": [{**dict(l), "runs": l["runs"] or _sem_execucoes()}
                     for l in linhas]}


@router.get("/{jornada_id}")
async def detalhe(jornada_id: str, usuario: Usuario = Depends(admin_atual)):
    """O fluxo, as métricas por nó e a contagem de execuções.

    ⚠️ As métricas saem de `journey_node_metrics`, que já existe no banco. Não
    recalcule por nó aqui: seria a segunda implementação da mesma conta, e a que
    diverge é sempre a que ninguém está olhando.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            f"""SELECT {COLUNAS}, e.numeros AS runs
                  FROM journeys j {CONTAGEM_DE_EXECUCOES}
                 WHERE j.id = $1::uuid""", jornada_id)
        if linha is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Fluxo não encontrado.")
        metricas = await conn.fetchval(
            "SELECT journey_node_metrics($1::uuid)", jornada_id)
    d = dict(linha)
    runs = d.pop("runs", None) or _sem_execucoes()
    return {"data": d, "metrics": metricas or {}, "runs": runs}


@router.post("", status_code=status.HTTP_201_CREATED)
async def criar(dados: JornadaIn, usuario: Usuario = Depends(admin_atual)):
    """Nasce sempre em `draft` — o status não vem do corpo.

    ⚠️ O trigger `fn_journeys_validate` recusa grafo inválido ou cíclico com uma
    mensagem que EXPLICA o que está errado no fluxo. Ela é a mensagem de erro do
    usuário; mascarar por um genérico deixaria quem monta o fluxo sem saber
    onde errou.
    """
    campos = dados.model_dump()
    if campos.pop("reentry_cooldown_hours") is None:
        # Sem valor explícito, o DEFAULT 168 (7 dias) da coluna assume.
        colunas = list(campos)
    else:
        campos["reentry_cooldown_hours"] = dados.reentry_cooldown_hours
        colunas = list(campos)

    nomes = ", ".join(colunas)
    marcas = ", ".join(f"${i}{CASTS.get(c, '')}" for i, c in enumerate(colunas, 1))
    try:
        async with sessao(role="authenticated", user_id=usuario.id) as conn:
            novo = await conn.fetchval(
                f"INSERT INTO journeys ({nomes}, status) "
                f"VALUES ({marcas}, 'draft') RETURNING id",
                *[campos[c] for c in colunas])
    except asyncpg.exceptions.RaiseError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    return {"success": True, "journey": {"id": str(novo)}}


@router.patch("/{jornada_id}")
async def editar(jornada_id: str, dados: JornadaPatch,
                 usuario: Usuario = Depends(admin_atual)):
    """PATCH parcial. A validação do grafo continua sendo do trigger."""
    campos = dados.model_dump(exclude_unset=True)
    if not campos:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nada a atualizar.")

    partes, valores = [], []
    for i, (coluna, valor) in enumerate(campos.items(), start=2):
        partes.append(f"{coluna} = ${i}{CASTS.get(coluna, '')}")
        valores.append(valor)

    try:
        async with sessao(role="authenticated", user_id=usuario.id) as conn:
            r = await conn.execute(
                f"""UPDATE journeys SET {', '.join(partes)}, updated_at = now()
                     WHERE id = $1::uuid""",
                jornada_id, *valores)
    except asyncpg.exceptions.RaiseError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    if r.endswith(" 0"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Fluxo não encontrado.")
    return {"id": jornada_id}


@router.delete("/{jornada_id}", status_code=status.HTTP_204_NO_CONTENT)
async def excluir(jornada_id: str, usuario: Usuario = Depends(admin_atual)):
    """⚠️ `guard_journey_delete` é mais restritivo que as outras guardas do
    projeto: só apaga fluxo em `draft` E sem NENHUMA execução, mesmo antiga.

        status != 'draft'          -> 'fluxo % nao pode ser excluido (status %)'
        existe journey_runs        -> 'fluxo % ja possui execucoes'

    A mensagem do banco vira 409, como em segmento e campanha.
    """
    try:
        async with sessao(role="authenticated", user_id=usuario.id) as conn:
            r = await conn.execute(
                "DELETE FROM journeys WHERE id = $1::uuid", jornada_id)
    except asyncpg.exceptions.RaiseError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc))
    if r.endswith(" 0"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Fluxo não encontrado.")


@router.get("/{jornada_id}/execucoes")
async def execucoes(jornada_id: str, usuario: Usuario = Depends(admin_atual)):
    """As execuções do fluxo, com o contato junto."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        existe = await conn.fetchval(
            "SELECT 1 FROM journeys WHERE id = $1::uuid", jornada_id)
        if existe is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Fluxo não encontrado.")
        linhas = await conn.fetch(
            """SELECT r.id::text, r.lead_id::text, r.current_node_id, r.state,
                      r.wakeup_at::text, r.waiting_event, r.entered_at::text,
                      r.updated_at::text,
                      COALESCE(l.nome, '-') AS lead_name,
                      COALESCE(l.email, '-') AS lead_email
                 FROM journey_runs r
                 LEFT JOIN leads l ON l.id = r.lead_id
                WHERE r.journey_id = $1::uuid
                ORDER BY r.updated_at DESC
                LIMIT 200""", jornada_id)
    return [dict(l) for l in linhas]
