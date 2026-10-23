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

MIGRATIONS = pathlib.Path(__file__).parent.parent / "migrations"
MIGRATION = MIGRATIONS / "029_growthhs_real.sql"
MIGRATION_030 = MIGRATIONS / "030_growthhs_ambientes.sql"
# As tabelas que a 030 altera — copiadas para `pg_temp` enquanto ela não está
# no banco de verdade.
TABELAS_030 = ("growthhs_config", "crm_handoffs", "ecosystem_identities")

# Módulos que fazem `from app.database import sessao` — o desvio precisa ser
# feito no próprio módulo. `app.crm.volta` ainda pode não existir.
MODULOS = ("app.crm.growthhs", "app.integracoes", "app.routers.configuracao",
           "app.routers.publico", "app.routers.leitura_contatos",
           "app.crm.volta", "app.routers.automacoes", "app.crm.entrega")

SEGREDOS = tuple(f"GROWTHHS_{tipo}_SECRET_{amb}" for tipo in ("CLIENT", "WEBHOOK")
                 for amb in ("HOMOLOGACAO", "PRODUCAO"))


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
        """SELECT EXISTS (SELECT 1 FROM pg_attribute
            WHERE attrelid = to_regclass('public.growthhs_config')
              AND attname = 'listas_ganho' AND NOT attisdropped)""")
    if ja_tem:
        return False
    await conexao.execute(
        "CREATE TEMP TABLE growthhs_config "
        "(LIKE public.growthhs_config INCLUDING ALL) ON COMMIT DROP")
    await conexao.execute(MIGRATION.read_text().replace(
        "public.growthhs_config", "pg_temp.growthhs_config"))
    return True


async def tem_030(conexao) -> bool:
    return await conexao.fetchval(
        """SELECT EXISTS (SELECT 1 FROM pg_attribute
            WHERE attrelid = to_regclass('public.growthhs_config')
              AND attname = 'ambiente' AND NOT attisdropped)""")


def sql_030_em(nomes: dict[str, str]) -> str:
    """O SQL da 030 com `public.<tabela>` trocado por `nomes[tabela]`.
    ⚠️ `public.growthhs_config_linha_unica` (o índice da 018) vira
    `<nome>_linha_unica` pela mesma troca — quem cria a cópia dá esse nome
    ao índice de linha única dela."""
    sql = MIGRATION_030.read_text()
    for tabela, nome in nomes.items():
        sql = sql.replace(f"public.{tabela}", nome)
    return sql


async def aplicar_030(conexao):
    """Garante a forma da 030 NESTA transação, sem tocar as tabelas reais —
    o mesmo desenho de `aplicar_029`: se a 030 ainda não está no banco, as
    três tabelas que ela altera ganham uma cópia TEMPORÁRIA com o mesmo nome
    (que vem antes de `public` no search_path) e o SQL da migration é
    aplicado nas cópias. Consultas SEM schema enxergam a cópia. Depois que a
    030 for aplicada de verdade, nada disso roda. Devolve True se copiou.

    ⚠️ `growthhs_config` é copiada SEM os índices (o `LIKE ... INCLUDING ALL`
    daria outro nome ao índice de linha única, e a 030 não o acharia para
    apagar): o índice é recriado com o nome que a troca de `sql_030_em` dá.
    """
    if await tem_030(conexao):
        return False
    await conexao.execute(
        "CREATE TEMP TABLE growthhs_config (LIKE public.growthhs_config "
        "INCLUDING DEFAULTS INCLUDING CONSTRAINTS) ON COMMIT DROP")
    await conexao.execute(
        "CREATE UNIQUE INDEX growthhs_config_linha_unica ON pg_temp.growthhs_config ((true))")
    for tabela in ("crm_handoffs", "ecosystem_identities"):
        await conexao.execute(
            f"CREATE TEMP TABLE {tabela} (LIKE public.{tabela} INCLUDING ALL) ON COMMIT DROP")
    await conexao.execute(sql_030_em({t: f"pg_temp.{t}" for t in TABELAS_030}))
    return True


@pytest_asyncio.fixture
async def banco_growthhs(cliente, conexao, monkeypatch):
    # ⚠️ `cliente` antes de `conexao`: a pool só fecha depois que a conexão
    # emprestada volta.
    from app import integracoes

    await aplicar_029(conexao)
    await aplicar_030(conexao)

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
