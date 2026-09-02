"""A porta de leitura para o DataCore.

⚠️ O teste que importa aqui é o de ESCRITA RECUSADA. A regra de mão única está
na spec e em comentário, e comentário não impede um UPDATE distraído. Este teste
prova que quem impede é o servidor.
"""

import pytest
import pytest_asyncio

import app.database as db


@pytest_asyncio.fixture
async def datacore():
    await db.init_datacore()
    if db._pool_datacore is None:
        pytest.skip("sem DATACORE_URL — os testes do DataCore exigem o ERP")
    async with db.sessao_datacore() as conn:
        yield conn
    await db.close_datacore()


@pytest.mark.asyncio
async def test_pool_do_datacore_recusa_escrita(datacore):
    with pytest.raises(Exception) as erro:
        await datacore.execute("CREATE TEMP TABLE t_proibida (i int)")
    assert "read-only" in str(erro.value).lower()


@pytest.mark.asyncio
async def test_pool_do_datacore_le(datacore):
    n = await datacore.fetchval("SELECT count(*) FROM tiny.clientes")
    # Conferido em 02/09/2026: 2.081. O ERP é vivo e o número sobe; o piso é
    # só para provar que estamos no banco certo, não no vazio.
    assert n > 2000
