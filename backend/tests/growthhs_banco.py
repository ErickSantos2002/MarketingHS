"""Fixture `banco_growthhs`: o banco de produção, mas tudo dentro da transação
revertida da `conexao`.

⚠️ Os testes de configuração e de webhook do GrowthHS mexem em `growthhs_config`
e em `integration_secrets`. Gravar ali de verdade derrubaria o worker de
produção (que lê as mesmas tabelas), então `sessao` é desviada, em cada módulo
que a importou, para uma falsa que devolve a própria `conexao` num savepoint.
"""

import contextlib
import importlib
import pathlib

import pytest_asyncio

MIGRATION = (pathlib.Path(__file__).parent.parent / "migrations"
             / "029_growthhs_real.sql")

# Módulos que fazem `from app.database import sessao` — o desvio precisa ser
# feito no próprio módulo. `app.crm.volta` ainda pode não existir.
MODULOS = ("app.crm.growthhs", "app.integracoes", "app.routers.configuracao",
           "app.routers.publico", "app.routers.leitura_contatos",
           "app.crm.volta")

SEGREDOS = ("GROWTHHS_CLIENT_SECRET", "GROWTHHS_WEBHOOK_SECRET")


async def aplicar_029(conexao):
    """Garante as colunas da 029 NESTA transação, sem tocar a tabela real.

    ⚠️ `marketinghs_app` não é dono de `growthhs_config` (o dono é
    `administrador`), então `ALTER TABLE` real é recusado nos testes. Se a 029
    ainda não está no banco, cria uma tabela TEMPORÁRIA com o mesmo nome e a
    mesma forma, e aplica nela o SQL da migration (com o nome trocado para
    `pg_temp`). Tabela temporária vem antes de `public` no search_path, então
    `FROM growthhs_config` sem schema enxerga a cópia — e a real, que o worker
    de produção lê, nunca é alterada nem bloqueada. Depois que a 029 for
    aplicada de verdade, nada disso roda. Os testes devem usar o nome SEM
    schema. Devolve True se usou a cópia temporária.
    """
    ja_tem = await conexao.fetchval(
        """SELECT EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'growthhs_config'
              AND column_name = 'client_id')""")
    if ja_tem:
        return False
    await conexao.execute(
        "CREATE TEMP TABLE growthhs_config "
        "(LIKE public.growthhs_config INCLUDING ALL) ON COMMIT DROP")
    await conexao.execute(MIGRATION.read_text().replace(
        "public.growthhs_config", "pg_temp.growthhs_config"))
    return True


@pytest_asyncio.fixture
async def banco_growthhs(cliente, conexao, monkeypatch):
    # ⚠️ `cliente` antes de `conexao`: a pool só fecha depois que a conexão
    # emprestada volta.
    from app import integracoes

    await aplicar_029(conexao)

    @contextlib.asynccontextmanager
    async def falsa(*, role=None, user_id=None, **_):
        async with conexao.transaction():
            yield conexao

    for nome in MODULOS:
        try:
            modulo = importlib.import_module(nome)
        except ModuleNotFoundError:
            continue
        if hasattr(modulo, "sessao"):
            monkeypatch.setattr(modulo, "sessao", falsa)

    for n in SEGREDOS:
        integracoes.esquecer(n)
    yield conexao
    for n in SEGREDOS:
        integracoes.esquecer(n)
