"""`/painel/agendamentos` — o teto que substituiu o `LIMIT 500` fixo.

O lote 6 portou `useAgendamentos` do Supabase para esta rota e, no caminho,
cortou o teto de 20.000 (paginação no cliente, `frontend/src/hooks/
useAgendamentos.tsx` antes desta tarefa) para 500 — em silêncio. Aqui a rota
volta a aguentar 20.000 e passa a AVISAR quando bate nele, em vez de só
truncar sem dizer nada — a mesma distinção que `useLeads`/`MAX_LEADS` faz do
lado do frontend.
"""

import pytest

from app import database as db
from app.dependencies import Usuario
from app.routers import painel

# Marcador único nos eventos que este arquivo insere, para não colidir com
# dado de verdade nem deixar lixo se um teste morrer no meio.
TITULO_TESTE = "teste-truncamento-agendamentos"


async def _algum_admin() -> str | None:
    """Um `user_id` real com o papel `admin` em `user_roles` — a rota exige
    `admin_atual`, e a política de `contact_events` só libera linha pra quem
    tem o papel de verdade (não aceita qualquer uuid)."""
    await db.init_db()
    if db._pool is None:
        return None
    async with db.sessao(role="service_role") as conn:
        return await conn.fetchval(
            "SELECT user_id::text FROM user_roles WHERE role = 'admin' LIMIT 1")


async def _inserir_eventos(quantidade: int) -> None:
    async with db.sessao(role="service_role") as conn:
        for _ in range(quantidade):
            await conn.execute(
                """INSERT INTO contact_events
                       (lead_id, source_app, event_type, title, occurred_at)
                   VALUES (NULL, 'marketinghs', 'meeting_scheduled', $1, now())""",
                TITULO_TESTE)


async def _limpar_eventos() -> None:
    async with db.sessao(role="service_role") as conn:
        await conn.execute(
            "DELETE FROM contact_events WHERE title = $1", TITULO_TESTE)


@pytest.mark.asyncio
async def test_agendamentos_avisa_quando_bate_no_teto():
    """Baixa o teto para 2 (em vez de inserir 20.001 linhas de verdade — o
    mesmo raciocínio do Passo 4 do brief, que baixa `MAX_LEADS` para provar a
    tarja, só que aqui de forma reversível e automática via monkeypatch, não
    editando o arquivo). Insere 3 eventos: a rota deve devolver só 2
    (ORDER BY occurred_at DESC), com `truncado=True`."""
    admin_id = await _algum_admin()
    if admin_id is None:
        pytest.skip("sem DATABASE_URL, ou nenhum admin em user_roles")

    teto_original = painel.TETO_AGENDAMENTOS
    painel.TETO_AGENDAMENTOS = 2
    try:
        await _inserir_eventos(3)
        usuario = Usuario(id=admin_id, email="teste@exemplo.invalid", papel="admin")
        resposta = await painel.listar_agendamentos(usuario)

        assert resposta["teto"] == 2
        assert resposta["truncado"] is True
        assert len(resposta["events"]) == 2
    finally:
        painel.TETO_AGENDAMENTOS = teto_original
        await _limpar_eventos()
        await db.close_db()


@pytest.mark.asyncio
async def test_agendamentos_nao_avisa_quando_so_acabou():
    """`truncado` distingue "parei porque acabou" de "parei porque bati no
    teto": com o teto de verdade (bem acima do que a base tem hoje), a
    resposta não pode alegar truncamento nenhum."""
    admin_id = await _algum_admin()
    if admin_id is None:
        pytest.skip("sem DATABASE_URL, ou nenhum admin em user_roles")

    usuario = Usuario(id=admin_id, email="teste@exemplo.invalid", papel="admin")
    resposta = await painel.listar_agendamentos(usuario)

    assert resposta["teto"] == 20000
    assert resposta["truncado"] is False
    assert len(resposta["events"]) < resposta["teto"]
    await db.close_db()
