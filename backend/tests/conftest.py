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
        # ⚠️ Limpa antes de inserir. Esta fixture COMMITA e só desfaz no
        # teardown — se o pytest morrer no meio (timeout, Ctrl-C), a linha fica
        # e `leads_email_unique` faz TODA rodada seguinte falhar no setup, com
        # um erro que aponta para o índice e não para o motivo. E a exclusão
        # lógica não resolve: o índice único não olha `deleted_at`.
        await conn.execute("DELETE FROM leads WHERE email = 'a@b.c' AND tipo = 'teste'")
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


@pytest_asyncio.fixture
async def token_admin():
    """Um JWT de administrador de verdade, para as rotas com `admin_atual`.

    ⚠️ Cria usuário em `auth.users` do banco real. Limpa antes (pytest morto no
    meio deixa a linha e o e-mail único derruba a rodada seguinte) e depois.
    """
    from app.auth.security import emitir_token, gerar_hash

    await db.init_db()
    if db._pool is None:
        pytest.skip("sem DATABASE_URL")
    email = "admin-teste-8a@exemplo.invalid"
    async with db.sessao(role="service_role") as conn:
        await conn.execute(
            "DELETE FROM public.user_roles WHERE user_id IN "
            "(SELECT id FROM auth.users WHERE email = $1)", email)
        await conn.execute("DELETE FROM auth.users WHERE email = $1", email)
        uid = await conn.fetchval(
            "INSERT INTO auth.users (email, password_hash) VALUES ($1, $2) "
            "RETURNING id::text", email, gerar_hash("senha-de-teste-8a"))
        await conn.execute(
            "INSERT INTO public.user_roles (user_id, role) VALUES ($1::uuid, 'admin')",
            uid)
    token, _ = emitir_token(uid, "admin", email)
    yield token
    async with db.sessao(role="service_role") as conn:
        await conn.execute("DELETE FROM public.user_roles WHERE user_id = $1::uuid", uid)
        await conn.execute("DELETE FROM auth.users WHERE id = $1::uuid", uid)


SEGREDOS_DO_RESEND = ("RESEND_API_KEY", "EMAIL_FROM", "UNSUBSCRIBE_SECRET",
                      "RESEND_WEBHOOK_SECRET")


@pytest_asyncio.fixture
async def segredos_resend(monkeypatch):
    """Começa o teste SEM nenhum segredo do Resend, e devolve os que havia.

    ⚠️ O banco é o de produção. Se houver segredo de verdade gravado, ele sai
    durante o teste e VOLTA no teardown — por isso nunca mate o pytest no meio.
    O ambiente também é esvaziado: `ler_segredo` cai para `os.environ`.
    """
    from app import integracoes

    await db.init_db()
    if db._pool is None:
        pytest.skip("sem DATABASE_URL")
    async with db.sessao(role="service_role") as conn:
        antes = {r["name"]: r["value"] for r in await conn.fetch(
            "SELECT name, value FROM integration_secrets WHERE name = ANY($1::text[])",
            list(SEGREDOS_DO_RESEND))}
        await conn.execute(
            "DELETE FROM integration_secrets WHERE name = ANY($1::text[])",
            list(SEGREDOS_DO_RESEND))
    for nome in SEGREDOS_DO_RESEND:
        monkeypatch.delenv(nome, raising=False)
        integracoes.esquecer(nome)
    yield
    async with db.sessao(role="service_role") as conn:
        await conn.execute(
            "DELETE FROM integration_secrets WHERE name = ANY($1::text[])",
            list(SEGREDOS_DO_RESEND))
        for nome, valor in antes.items():
            await conn.execute(
                "INSERT INTO integration_secrets (name, value, updated_at) "
                "VALUES ($1, $2, now())", nome, valor)
    for nome in SEGREDOS_DO_RESEND:
        integracoes.esquecer(nome)


@pytest_asyncio.fixture
async def chave_de():
    """Fábrica de chave de API: `crua = await chave_de("read")`."""
    from app.chave_api import gerar_chave

    await db.init_db()
    if db._pool is None:
        pytest.skip("sem DATABASE_URL")
    hashes = []

    async def _criar(permissao: str) -> str:
        crua, hash_, prefixo = gerar_chave()
        async with db.sessao(role="service_role") as conn:
            await conn.execute(
                "INSERT INTO api_keys (name, key_hash, key_prefix, permissions) "
                "VALUES ('teste 8A', $1, $2, $3)", hash_, prefixo, permissao)
        hashes.append(hash_)
        return crua

    yield _criar
    async with db.sessao(role="service_role") as conn:
        await conn.execute("DELETE FROM api_keys WHERE key_hash = ANY($1::text[])", hashes)


@pytest_asyncio.fixture
async def token_usuario():
    """JWT de um usuário SEM papel de admin — para provar os 403.

    ⚠️ Sem esta prova, uma rota que esquecesse o `admin_atual` passaria: o
    usuário comum levaria zero linhas do RLS, não erro, e ninguém notaria.
    """
    from app.auth.security import emitir_token, gerar_hash

    await db.init_db()
    if db._pool is None:
        pytest.skip("sem DATABASE_URL")
    email = "usuario-teste-8c@exemplo.invalid"

    async def limpar():
        async with db.sessao(role="service_role") as conn:
            await conn.execute(
                "DELETE FROM public.user_roles WHERE user_id IN "
                "(SELECT id FROM auth.users WHERE email = $1)", email)
            await conn.execute("DELETE FROM auth.users WHERE email = $1", email)

    await limpar()
    async with db.sessao(role="service_role") as conn:
        uid = await conn.fetchval(
            "INSERT INTO auth.users (email, password_hash) VALUES ($1, $2) "
            "RETURNING id::text", email, gerar_hash("senha-de-teste-8c"))
        await conn.execute(
            "INSERT INTO public.user_roles (user_id, role) VALUES ($1::uuid, 'user')", uid)
    token, _ = emitir_token(uid, "user", email)
    yield token
    await limpar()


@pytest_asyncio.fixture
async def config_ab():
    """Põe `ab_config` num estado conhecido: `await config_ab("exemplo.invalid")`.

    ⚠️ `ab_config` é UMA linha, global — é a configuração de PRODUÇÃO do A/B.
    A fixture guarda o que havia e devolve no teardown, mesmo que o teste
    falhe. `config_ab(None)` deixa a tabela vazia (nada configurado).
    """
    await db.init_db()
    if db._pool is None:
        pytest.skip("sem DATABASE_URL")
    async with db.sessao(role="service_role") as conn:
        antes = await conn.fetchrow(
            "SELECT production_domain, redirector_base FROM ab_config LIMIT 1")

    async def gravar(dominio, base=None):
        async with db.sessao(role="service_role") as conn:
            await conn.execute("DELETE FROM ab_config")
            if dominio is not None or base is not None:
                await conn.execute(
                    "INSERT INTO ab_config (production_domain, redirector_base) "
                    "VALUES ($1, $2)", dominio, base)

    yield gravar
    await gravar(antes["production_domain"] if antes else None,
                 antes["redirector_base"] if antes else None)


# Tudo o que os testes do 8C gravam em `ab_*` começa com isto — é o que a
# limpeza apaga. `ab_vid` de teste começa com "v_teste8c".
PREFIXO_AB = "teste-8c"


@pytest_asyncio.fixture
async def limpar_ab():
    """Apaga, antes e depois, o que os testes do A/B gravaram."""
    await db.init_db()
    if db._pool is None:
        pytest.skip("sem DATABASE_URL")

    async def limpar():
        async with db.sessao(role="service_role") as conn:
            for tabela in ("ab_events", "ab_assignments"):
                await conn.execute(f"DELETE FROM {tabela} WHERE ab_test LIKE $1",
                                   PREFIXO_AB + "%")
            await conn.execute("DELETE FROM ab_identities WHERE ab_vid LIKE 'v_teste8c%'")
            await conn.execute("DELETE FROM ab_tests WHERE public_slug LIKE $1",
                               PREFIXO_AB + "%")

    await limpar()
    yield PREFIXO_AB
    await limpar()
