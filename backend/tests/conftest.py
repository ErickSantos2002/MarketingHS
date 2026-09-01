"""Fixtures dos testes que tocam o banco.

⚠️ Toda escrita acontece numa transação SEMPRE revertida. Nenhum teste pode
deixar linha para trás — uma mensagem esquecida em `email_send_queue` viraria
e-mail enviado de verdade na próxima vez que o worker subisse.
"""

import pytest
import pytest_asyncio

import app.database as db


@pytest_asyncio.fixture
async def conexao():
    await db.init_db()
    if db._pool is None:
        pytest.skip("sem DATABASE_URL — os testes de fila exigem banco")
    async with db._pool.acquire() as conn:
        tr = conn.transaction()
        await tr.start()
        await conn.execute("SET LOCAL ROLE service_role")
        try:
            yield conn
        finally:
            await tr.rollback()
    await db.close_db()


@pytest_asyncio.fixture
async def semear(conexao):
    """Cria campanha, contatos e linhas de `campaign_sends` já na fila."""
    from app import fila

    async def _semear(quantidade: int = 1):
        campanha = await conexao.fetchval(
            "INSERT INTO campaigns (name, channel, status) "
            "VALUES ('teste de fila', 'email', 'sending') RETURNING id")
        mensagens = []
        for i in range(quantidade):
            # ⚠️ `tipo` é NOT NULL sem default em `leads`. Omiti-lo derruba a
            # fixture com NotNullViolationError, e o erro aparece como falha do
            # teste de fila — que não tem nada a ver.
            lead = await conexao.fetchval(
                "INSERT INTO leads (nome, email, tipo) VALUES ($1, $2, 'teste') "
                "RETURNING id",
                f"Teste {i}", f"teste{i}@exemplo.invalid")
            send = await conexao.fetchval(
                "INSERT INTO campaign_sends (campaign_id, lead_id, channel, status) "
                "VALUES ($1, $2, 'email', 'pending') RETURNING id", campanha, lead)
            mensagens.append({"send_id": str(send), "campaign_id": str(campanha),
                              "lead_id": str(lead)})
        await fila.publicar(conexao, mensagens)
        return mensagens

    return _semear
