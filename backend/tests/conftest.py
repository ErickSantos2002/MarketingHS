"""Fixtures dos testes que tocam o banco.

⚠️ Toda escrita acontece numa transação SEMPRE revertida. Nenhum teste pode
deixar linha para trás — uma mensagem esquecida em `email_send_queue` viraria
e-mail enviado de verdade na próxima vez que o worker subisse.
"""

import asyncio
import inspect
import threading

import pytest
import pytest_asyncio

import app.database as db
from rodada import ENVIO


# ── Trava entre rodadas (decisão 27 do Erick, 01/10/2026) ────────────────────
# Duas suítes inteiras (duas frentes, ou a suíte e um arquivo solto) rodam ao
# mesmo tempo contra o MESMO banco. O que um processo COMITA o outro vê — e
# aí uma rodada derruba a outra: a configuração global que uma fixture troca e
# devolve (`segredo`, `segredos_resend`, `config_ab`, `config_growthhs`), a
# limpeza por prefixo (`limpar_ab`, tags, campanhas), a contagem da tabela
# inteira (`test_conversao_authenticated`), o reenfileirar de TODAS as falhas
# (`test_config_growthhs`). O levantamento de 01/10 achou dezenas desses; a
# lista está em docs/frentes/backend.md (rodada 4).
#
# A saída é uma trava de sessão do Postgres (`pg_advisory_lock`), tomada por
# TESTE antes de qualquer outra fixture (autouse) e solta depois da última:
# entre processos, os testes que comitam andam um de cada vez; os que só usam
# `conexao` (transação revertida, invisível para o outro) andam livres.
#
# ⚠️ A trava mora numa conexão própria, num laço asyncio próprio, numa thread
# própria: o pytest-asyncio abre um laço por teste, e a pool do app é
# fechada a cada fixture — nenhum dos dois vive o bastante para segurá-la.
# Se o processo morrer, o servidor solta a trava junto com a conexão.

CHAVE_DA_TRAVA = 7_270_010_027  # "rodada de pytest do MarketingHS"

# Toda fixture que grava fora da transação revertida (direto ou em cadeia —
# `item.fixturenames` já é o fecho transitivo).
FIXTURES_QUE_COMITAM = frozenset({
    "cliente", "envio", "segredo", "segredos_resend", "config_ab",
    "config_growthhs", "limpar_ab", "chave_de", "token_admin", "token_usuario",
})


def pytest_configure(config):
    config.addinivalue_line(
        "markers", "trava_global: o teste lê estado comitado que outra rodada "
        "muda — anda sob a trava entre rodadas mesmo usando só `conexao`")


def _precisa_da_trava(item) -> bool:
    if item.get_closest_marker("trava_global"):
        return True
    nomes = set(getattr(item, "fixturenames", ()))
    if nomes & FIXTURES_QUE_COMITAM:
        return True
    if "conexao" in nomes:
        return False
    # Teste assíncrono sem `conexao` pode gravar por `db.sessao()` direto (ou
    # por fixture local do arquivo, como `lead_8d`). Na dúvida, trava:
    # travar a mais só custa tempo; travar a menos derruba a outra rodada.
    return inspect.iscoroutinefunction(getattr(item, "obj", None))


class _TravaEntreRodadas:
    """Uma por processo. `pegar()` bloqueia até a outra rodada soltar."""

    def __init__(self):
        self._laco = None
        self._conn = None

    def _rodar(self, coro):
        return asyncio.run_coroutine_threadsafe(coro, self._laco).result()

    def _subir(self):
        self._laco = asyncio.new_event_loop()
        threading.Thread(target=self._laco.run_forever, daemon=True,
                         name="trava-entre-rodadas").start()

    async def _conectar(self):
        import asyncpg
        from app.config import settings
        if self._conn is None or self._conn.is_closed():
            self._conn = await asyncpg.connect(settings.DATABASE_URL)
        return self._conn

    async def _pegar(self):
        conn = await self._conectar()
        await conn.execute("SELECT pg_advisory_lock($1)", CHAVE_DA_TRAVA)

    async def _soltar(self):
        if self._conn is not None and not self._conn.is_closed():
            await self._conn.execute("SELECT pg_advisory_unlock($1)", CHAVE_DA_TRAVA)

    def pegar(self):
        if self._laco is None:
            self._subir()
        self._rodar(self._pegar())

    def soltar(self):
        self._rodar(self._soltar())


_trava = _TravaEntreRodadas()


@pytest.fixture(autouse=True)
def _trava_entre_rodadas(request):
    from app.config import settings
    if not settings.DATABASE_URL or not _precisa_da_trava(request.node):
        yield
        return
    _trava.pegar()
    try:
        yield
    finally:
        _trava.soltar()


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
        # ⚠️ Limpa antes de inserir. Esta fixture COMMITA e só desfaz no
        # teardown — se o pytest morrer no meio (timeout, Ctrl-C), a linha fica
        # e `leads_email_unique` faz TODA rodada seguinte falhar no setup, com
        # um erro que aponta para o índice e não para o motivo. E a exclusão
        # lógica não resolve: o índice único não olha `deleted_at`.
        # ⚠️ E-mail único por rodada (decisão 27; era `a@b.c` fixo): a
        # pré-limpeza pega o desta rodada, o antigo e o de rodada morta (> 2 h).
        await conn.execute(f"DELETE FROM leads WHERE {ENVIO.onde(1)} AND tipo = 'teste'",
                           *ENVIO.parametros())
        # ⚠️ E a CAMPANHA que a rodada morta deixou. Até 01/10 a pré-limpeza só
        # cobria o lead, e duas campanhas 'teste de webhook' ficaram presas em
        # 'sending' em produção desde 02/09 (apagadas pelo Erick com
        # scripts/2026-10-01-limpar-campanhas-teste-webhook.sql). A trava é a
        # MESMA do script: nome, status, TODOS os envios com a assinatura da
        # fixture (lead_id NULL — o DELETE acima já soltou o lead — e
        # resend_email_id 're_abc') e nada na fila. Campanha de verdade com
        # esse nome não casa. 'failed' antes do DELETE porque o
        # `guard_campaign_delete` recusa apagar em 'sending'.
        orfas = await conn.fetch(
            """SELECT c.id FROM campaigns c
                WHERE c.name = 'teste de webhook' AND c.status = 'sending'
                  AND EXISTS (SELECT 1 FROM campaign_sends cs WHERE cs.campaign_id = c.id)
                  AND NOT EXISTS (SELECT 1 FROM campaign_sends cs
                                   WHERE cs.campaign_id = c.id
                                     AND (cs.lead_id IS NOT NULL
                                          OR cs.resend_email_id IS DISTINCT FROM 're_abc'))
                  AND NOT EXISTS (SELECT 1 FROM email_send_queue q
                                   WHERE q.campaign_id = c.id)""")
        ids = [o["id"] for o in orfas]
        if ids:
            await conn.execute(
                "UPDATE campaigns SET status = 'failed' WHERE id = ANY($1::uuid[])", ids)
            await conn.execute("DELETE FROM campaigns WHERE id = ANY($1::uuid[])", ids)
        campanha = await conn.fetchval(
            "INSERT INTO campaigns (name, channel, status) "
            "VALUES ('teste de webhook', 'email', 'sending') RETURNING id")
        lead = await conn.fetchval(
            "INSERT INTO leads (nome, email, tipo) "
            "VALUES ('Webhook', $1, 'teste') RETURNING id", ENVIO.atual)
        send = await conn.fetchval(
            "INSERT INTO campaign_sends (campaign_id, lead_id, channel, status, "
            "resend_email_id) VALUES ($1, $2, 'email', 'sent', 're_abc') "
            "RETURNING id", campanha, lead)
    yield str(send)
    async with db.sessao(role="service_role") as conn:
        # ⚠️ Só os eventos DOS TESTES: `re_abc`/`re_x` são os ids de e-mail que
        # test_webhook.py inventa (o Resend usa UUID). Até 01/10 era
        # `svix_id LIKE 'msg_%'` — e o Svix de verdade também começa com
        # `msg_`: o teardown apagaria os eventos reais de produção.
        await conn.execute(
            "DELETE FROM email_events WHERE svix_id LIKE 'msg_%' "
            "AND resend_email_id IN ('re_abc', 're_x')")
        await conn.execute("DELETE FROM email_suppressions WHERE email = $1", ENVIO.atual)
        await conn.execute("UPDATE campaigns SET status='failed' WHERE id=$1", campanha)
        await conn.execute("DELETE FROM campaigns WHERE id = $1", campanha)
        await conn.execute("DELETE FROM leads WHERE id = $1", lead)


# ── Usuários de teste ────────────────────────────────────────────────────────
# ⚠️ Até 01/10 os dois usuários tinham e-mail FIXO e a fixture apagava o
# usuário no setup: duas rodadas do pytest ao mesmo tempo (duas frentes, ou a
# suíte e um arquivo solto) apagavam o usuário uma da outra no meio do teste,
# e a outra levava 401 falso (4 vermelhos medidos em test_crm_caminhos.py).
# Agora cada fixture cria um e-mail ÚNICO, `<prefixo>-<12 hex>@exemplo.invalid`,
# e só apaga o seu. A pré-limpeza apaga o que uma rodada MORTA deixou: casa a
# forma exata do e-mail (regex ancorada, domínio .invalid — nenhum usuário
# real casa) E exige mais de 2 h de vida, para nunca levar o usuário de uma
# rodada viva (a suíte inteira leva ~30 min). Os e-mails fixos antigos entram
# na pré-limpeza pelo nome exato, para a última rodada morta da era antiga.
PREFIXOS_USUARIO_TESTE = ("admin-teste-8a", "usuario-teste-8c")
_RE_USUARIO_TESTE = (r"^(" + "|".join(PREFIXOS_USUARIO_TESTE)
                     + r")-[0-9a-f]{12}@exemplo\.invalid$")
_EMAILS_FIXOS_ANTIGOS = [f"{p}@exemplo.invalid" for p in PREFIXOS_USUARIO_TESTE]


async def _limpar_usuarios_de_rodada_morta(conn):
    await conn.execute(
        """DELETE FROM auth.users
            WHERE (email ~ $1 AND created_at < now() - interval '2 hours')
               OR email = ANY($2::text[])""",
        _RE_USUARIO_TESTE, _EMAILS_FIXOS_ANTIGOS)


async def _criar_usuario_de_teste(prefixo: str, papel: str):
    """Cria o usuário e devolve (uid, token). `user_roles` cai junto no
    DELETE de `auth.users` (ON DELETE CASCADE)."""
    import uuid
    from app.auth.security import emitir_token, gerar_hash

    assert prefixo in PREFIXOS_USUARIO_TESTE
    email = f"{prefixo}-{uuid.uuid4().hex[:12]}@exemplo.invalid"
    async with db.sessao(role="service_role") as conn:
        await _limpar_usuarios_de_rodada_morta(conn)
        uid = await conn.fetchval(
            "INSERT INTO auth.users (email, password_hash) VALUES ($1, $2) "
            "RETURNING id::text", email, gerar_hash("senha-de-teste-" + prefixo))
        await conn.execute(
            "INSERT INTO public.user_roles (user_id, role) VALUES ($1::uuid, $2)",
            uid, papel)
    token, _ = emitir_token(uid, papel, email)
    return uid, token


async def _apagar_usuario_de_teste(uid: str):
    async with db.sessao(role="service_role") as conn:
        await conn.execute("DELETE FROM public.user_roles WHERE user_id = $1::uuid", uid)
        await conn.execute("DELETE FROM auth.users WHERE id = $1::uuid", uid)


@pytest_asyncio.fixture
async def token_admin():
    """Um JWT de administrador de verdade, para as rotas com `admin_atual`.

    ⚠️ Cria usuário em `auth.users` do banco real, com e-mail único (ver o
    bloco acima) — quem precisar do id ou do e-mail lê do próprio token
    (`ler_token(token)["sub"]`), nunca de um e-mail fixo.
    """
    await db.init_db()
    if db._pool is None:
        pytest.skip("sem DATABASE_URL")
    uid, token = await _criar_usuario_de_teste("admin-teste-8a", "admin")
    try:
        yield token
    finally:
        await _apagar_usuario_de_teste(uid)


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
    await db.init_db()
    if db._pool is None:
        pytest.skip("sem DATABASE_URL")
    uid, token = await _criar_usuario_de_teste("usuario-teste-8c", "user")
    try:
        yield token
    finally:
        await _apagar_usuario_de_teste(uid)


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


@pytest_asyncio.fixture
async def config_growthhs():
    """Põe `growthhs_config` num estado conhecido e devolve o que havia.

    ⚠️ Linha única, de PRODUÇÃO — a que diz para onde vão os cards. A chave
    (`GROWTHHS_API_KEY`) não passa por aqui: quem precisa grava e apaga com
    `integracoes`, e devolve o que havia.
    """
    await db.init_db()
    if db._pool is None:
        pytest.skip("sem DATABASE_URL")
    async with db.sessao(role="service_role") as conn:
        antes = await conn.fetchrow(
            "SELECT base_url, board_id, app_url FROM growthhs_config LIMIT 1")

    async def gravar(base_url, board_id, app_url=None):
        async with db.sessao(role="service_role") as conn:
            await conn.execute("DELETE FROM growthhs_config")
            if base_url is not None or board_id is not None or app_url is not None:
                await conn.execute(
                    "INSERT INTO growthhs_config (base_url, board_id, app_url) "
                    "VALUES ($1, $2, $3)", base_url, board_id, app_url)

    yield gravar
    if antes:
        await gravar(antes["base_url"], antes["board_id"], antes["app_url"])
    else:
        await gravar(None, None)
