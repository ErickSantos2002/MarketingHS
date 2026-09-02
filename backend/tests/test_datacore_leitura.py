"""O leitor do DataCore.

⚠️ Os testes provam DIREÇÃO e INVARIANTE, não números exatos: o ERP é vivo e a
contagem sobe. Fixar 2081 ou 190 faria o teste quebrar num dia em que nada de
errado aconteceu.
"""

import pytest
import pytest_asyncio

import app.database as db
from app.dominio.datacore import _email_plausivel, clientes_do_datacore


@pytest_asyncio.fixture
async def datacore():
    await db.init_datacore()
    if db._pool_datacore is None:
        pytest.skip("sem DATACORE_URL — os testes do DataCore exigem o ERP")
    async with db.sessao_datacore() as conn:
        yield conn
    await db.close_datacore()


@pytest.mark.asyncio
async def test_le_todos_os_clientes_mesmo_sem_email(datacore):
    """Cliente sem e-mail NÃO é descartado: são ~91% da base, e o valor
    principal do lote é segmentação, que não depende de e-mail."""
    linhas = await clientes_do_datacore(datacore, com_email_de_notas=False)
    assert len(linhas) > 2000
    assert any(c.email is None for c in linhas), "esperava clientes sem e-mail"


@pytest.mark.asyncio
async def test_cliente_sem_cpf_cnpj_fica_de_fora(datacore):
    """O cpf_cnpj é a chave de idempotência. Cliente sem ele não pode entrar:
    string vazia como chave casaria com qualquer outro sem chave na carga
    seguinte. Em 02/09/2026 é um só ("C4 DEVELOPMENT", id 764)."""
    linhas = await clientes_do_datacore(datacore, com_email_de_notas=False)
    assert all(c.cpf_cnpj and c.cpf_cnpj.strip() for c in linhas)

    total_no_erp = await datacore.fetchval("SELECT count(*) FROM tiny.clientes")
    sem_chave = await datacore.fetchval(
        "SELECT count(*) FROM tiny.clientes WHERE btrim(cpf_cnpj) = ''")
    assert len(linhas) == total_no_erp - sem_chave


@pytest.mark.asyncio
async def test_o_cpf_cnpj_serve_como_chave(datacore):
    """A idempotência da sincronização depende disto. Se o ERP passar a repetir
    cpf_cnpj, é aqui que se descobre — não em produção, com contato duplicado."""
    linhas = await clientes_do_datacore(datacore, com_email_de_notas=False)
    chaves = [c.cpf_cnpj for c in linhas]
    assert len(chaves) == len(set(chaves))


@pytest.mark.asyncio
async def test_email_de_notas_amplia_o_alcance(datacore):
    """190 no cadastro, 327 unindo nota fiscal e conta a receber (02/09/2026).
    O teste prova a direção; o número exato é do dia."""
    so_cadastro = await clientes_do_datacore(datacore, com_email_de_notas=False)
    com_notas = await clientes_do_datacore(datacore, com_email_de_notas=True)

    def com_email(l):
        return sum(1 for c in l if c.email)

    assert com_email(so_cadastro) >= 150
    assert com_email(com_notas) > com_email(so_cadastro)
    # A união acrescenta e-mail; não pode acrescentar nem perder CLIENTE.
    assert len(com_notas) == len(so_cadastro)


@pytest.mark.asyncio
async def test_o_cadastro_do_cliente_ganha_da_nota(datacore):
    """Quem tem e-mail no cadastro mantém o do cadastro mesmo com a união
    ligada — a nota fiscal entra por baixo, nunca por cima."""
    so_cadastro = {c.cpf_cnpj: c.email
                   for c in await clientes_do_datacore(datacore, com_email_de_notas=False)
                   if c.email}
    com_notas = {c.cpf_cnpj: c.email
                 for c in await clientes_do_datacore(datacore, com_email_de_notas=True)}
    assert so_cadastro, "esperava ao menos um cliente com e-mail no cadastro"
    for cpf, email in so_cadastro.items():
        assert com_notas[cpf] == email


def test_email_implausivel_vira_nulo():
    """O ERP guarda "não tem" e "-" no campo de e-mail. Deixar passar só adianta
    o hard bounce, que custa reputação do remetente."""
    assert _email_plausivel("alfa@exemplo.com.br") == "alfa@exemplo.com.br"
    assert _email_plausivel("  ALFA@Exemplo.com  ") == "alfa@exemplo.com"
    for lixo in (None, "", "não tem", "-", "sem@dominio", "a@b", "@exemplo.com",
                 "dois@@arrobas.com", "ponto@final."):
        assert _email_plausivel(lixo) is None, lixo
