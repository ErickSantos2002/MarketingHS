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
        """Devolve as mensagens; `mensagens[0]["campaign_id"]` escopa as
        contagens. ⚠️ Contar a tabela INTEIRA faz o teste depender do banco
        estar vazio — e ele passa a quebrar por causa de dado deixado por
        outra coisa, apontando para o lugar errado."""
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


@pytest_asyncio.fixture
async def cliente():
    """Cliente ASGI, falando com o app de verdade — sem rede.

    ⚠️ Diferente da fixture `conexao`, o que passa por aqui é GRAVADO: o app
    pega a própria conexão do pool e comita. Quem usar este cliente limpa o que
    escreveu, e a fixture `envio` abaixo faz isso.
    """
    import httpx
    from app.main import app

    await db.init_db()
    if db._pool is None:
        pytest.skip("sem DATABASE_URL — os testes de webhook exigem banco")
    transporte = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transporte,
                                 base_url="http://teste") as c:
        yield c
    await db.close_db()


@pytest_asyncio.fixture
async def segredo():
    """Grava um RESEND_WEBHOOK_SECRET de teste e o devolve no formato whsec_."""
    import base64
    from app import integracoes

    valor = "whsec_" + base64.b64encode(b"segredo-de-teste-do-webhook").decode()
    await db.init_db()
    anterior = await integracoes.ler_segredo("RESEND_WEBHOOK_SECRET")
    await integracoes.gravar_segredo("RESEND_WEBHOOK_SECRET", valor)
    yield valor
    async with db.sessao(role="service_role") as conn:
        if anterior:
            await conn.execute(
                "UPDATE integration_secrets SET value = $1 WHERE name = $2",
                anterior, "RESEND_WEBHOOK_SECRET")
        else:
            await conn.execute(
                "DELETE FROM integration_secrets WHERE name = $1",
                "RESEND_WEBHOOK_SECRET")
    integracoes.esquecer("RESEND_WEBHOOK_SECRET")


@pytest_asyncio.fixture
async def envio():
    """Um `campaign_sends` de verdade, apagado no fim junto com tudo que os
    testes escreveram a partir dele."""
    await db.init_db()
    async with db.sessao(role="service_role") as conn:
        campanha = await conn.fetchval(
            "INSERT INTO campaigns (name, channel, status) "
            "VALUES ('teste de webhook', 'email', 'sending') RETURNING id")
        lead = await conn.fetchval(
            "INSERT INTO leads (nome, email, tipo) "
            "VALUES ('Webhook', 'a@b.c', 'teste') RETURNING id")
        send = await conn.fetchval(
            "INSERT INTO campaign_sends (campaign_id, lead_id, channel, status, "
            "resend_email_id) VALUES ($1, $2, 'email', 'sent', 're_abc') "
            "RETURNING id", campanha, lead)
    yield str(send)
    async with db.sessao(role="service_role") as conn:
        await conn.execute("DELETE FROM email_events WHERE svix_id LIKE 'msg_%'")
        await conn.execute("DELETE FROM email_suppressions WHERE email = 'a@b.c'")
        await conn.execute("UPDATE campaigns SET status='failed' WHERE id=$1", campanha)
        await conn.execute("DELETE FROM campaigns WHERE id = $1", campanha)
        await conn.execute("DELETE FROM leads WHERE id = $1", lead)
