"""A sincronização do DataCore.

⚠️ Usa a fixture `conexao` do conftest, que reverte tudo. Estes testes escrevem
em `leads` e `ecosystem_identities`, as duas tabelas mais importantes do
sistema — nenhuma linha pode ficar para trás.
"""

import pytest

from app.dominio.datacore import ClienteErp
from app.dominio.sincronizacao_datacore import sincronizar


def _cliente(**kw) -> ClienteErp:
    base = dict(cpf_cnpj="11222333000181", nome="Alfa Ltda",
                email="alfa-teste-5b@exemplo.com.br", fone="81999998888",
                cidade="Recife", uf="PE", tipo_pessoa="J")
    base.update(kw)
    return ClienteErp(**base)


@pytest.mark.asyncio
async def test_rodar_duas_vezes_nao_duplica(conexao):
    """A idempotência é `datacore_cliente_id`. Sem ela, cada sincronização
    criaria a base inteira de novo."""
    c = [_cliente()]
    r1 = await sincronizar(conexao, c)
    r2 = await sincronizar(conexao, c)
    assert r1.criados == 1 and r1.atualizados == 0
    assert r2.criados == 0 and r2.atualizados == 1
    n = await conexao.fetchval(
        "SELECT count(*) FROM ecosystem_identities WHERE datacore_cliente_id = $1",
        c[0].cpf_cnpj)
    assert n == 1


@pytest.mark.asyncio
async def test_cliente_sem_email_entra(conexao):
    """~91% da base não tem e-mail. Descartá-los jogaria fora o valor de
    segmentação, que é o principal do lote."""
    r = await sincronizar(conexao, [_cliente(cpf_cnpj="99888777000166", email=None)])
    assert r.criados == 1 and r.sem_email == 1
    email = await conexao.fetchval(
        """SELECT l.email FROM leads l
             JOIN ecosystem_identities i ON i.dnia_id = l.dnia_id
            WHERE i.datacore_cliente_id = '99888777000166'""")
    assert email is None


@pytest.mark.asyncio
async def test_email_repetido_no_erp_nao_derruba_a_carga(conexao):
    """Dois cadastros do mesmo Porã dividem um e-mail, e `leads_email_unique`
    recusaria o segundo. Os dois viram contato; o segundo entra sem e-mail."""
    dois = [_cliente(cpf_cnpj="10000000000001", email="mesmo-5b@exemplo.com"),
            _cliente(cpf_cnpj="10000000000002", email="mesmo-5b@exemplo.com")]
    r = await sincronizar(conexao, dois)
    assert r.criados == 2, r.erros
    assert r.colisoes_de_email == 1
    com_email = await conexao.fetchval(
        """SELECT count(*) FROM leads l
             JOIN ecosystem_identities i ON i.dnia_id = l.dnia_id
            WHERE i.datacore_cliente_id IN ('10000000000001','10000000000002')
              AND l.email IS NOT NULL""")
    assert com_email == 1


@pytest.mark.asyncio
async def test_telefone_compartilhado_nao_colapsa_identidades(conexao):
    """26 clientes do ERP dividem o telefone 4133551019, e
    ecosystem_identities.phone é UNIQUE. Se o telefone fosse para a identidade,
    os 26 virariam uma empresa só."""
    chaves = ["20000000000001", "20000000000002", "20000000000003"]
    tres = [_cliente(cpf_cnpj=k, email=None, fone="4133551019") for k in chaves]
    r = await sincronizar(conexao, tres)
    assert r.criados == 3, r.erros

    identidades = await conexao.fetchval(
        "SELECT count(*) FROM ecosystem_identities WHERE datacore_cliente_id = ANY($1)",
        chaves)
    com_phone = await conexao.fetchval(
        """SELECT count(*) FROM ecosystem_identities
            WHERE datacore_cliente_id = ANY($1) AND phone IS NOT NULL""", chaves)
    no_lead = await conexao.fetchval(
        """SELECT count(*) FROM leads l
             JOIN ecosystem_identities i ON i.dnia_id = l.dnia_id
            WHERE i.datacore_cliente_id = ANY($1) AND l.whatsapp IS NOT NULL""", chaves)
    assert identidades == 3, "três clientes, três identidades — não uma"
    assert com_phone == 0, "o telefone não pode ir para a identidade"
    assert no_lead == 3, "mas vai para o lead, que não tem unicidade"


@pytest.mark.asyncio
async def test_marca_como_cliente(conexao):
    """O `stage` carrega o fato "é cliente"; o `tipo` é o que o construtor de
    segmentos sabe filtrar (`build_segment_condition` entende `tipo`, e NÃO
    entende `stage`). Os dois juntos são o "pronto" do lote."""
    await sincronizar(conexao, [_cliente(cpf_cnpj="30000000000001")])
    linha = await conexao.fetchrow(
        """SELECT i.stage, l.source, l.tipo, l.status
             FROM ecosystem_identities i
             JOIN leads l ON l.dnia_id = i.dnia_id
            WHERE i.datacore_cliente_id = '30000000000001'""")
    assert linha["stage"] == "client", "vocabulário do banco é inglês"
    assert linha["source"] == "datacore"
    assert linha["tipo"] == "datacore"
    # Não inventamos status: o funil não tem "Cliente", e criar um é decisão
    # de produto. Fica o padrão da coluna.
    assert linha["status"] == "Lead"


@pytest.mark.asyncio
async def test_um_cliente_ruim_nao_derruba_os_outros(conexao):
    """O SAVEPOINT por cliente. Sem ele, o primeiro erro aborta a transação e
    todo o resto morre em cadeia — a lição do lote 4."""
    # `tipo_pessoa` com 300 caracteres não cabe em lugar nenhum; o nome com
    # NUL byte é o que o Postgres recusa de verdade.
    ruim = _cliente(cpf_cnpj="40000000000001", nome="x\x00y", email=None)
    bons = [_cliente(cpf_cnpj="40000000000002", email=None),
            _cliente(cpf_cnpj="40000000000003", email=None)]
    r = await sincronizar(conexao, [ruim, *bons])
    assert len(r.erros) == 1, r.erros
    assert r.criados == 2, "os dois bons entraram apesar do erro do primeiro"


@pytest.mark.asyncio
async def test_rodar_duas_vezes_sem_email_tambem_nao_duplica(conexao):
    """⚠️ O caso que o primeiro teste de idempotência NÃO cobria.

    `ON CONFLICT (email) DO NOTHING` não protege quem entra sem e-mail: NULL não
    conflita com NULL no Postgres. E ~91% da base do ERP não tem e-mail — ou
    seja, a segunda carga criaria um lead duplicado para cada um deles.
    """
    c = [_cliente(cpf_cnpj="50000000000001", email=None)]
    await sincronizar(conexao, c)
    await sincronizar(conexao, c)
    n = await conexao.fetchval(
        """SELECT count(*) FROM leads l
             JOIN ecosystem_identities i ON i.dnia_id = l.dnia_id
            WHERE i.datacore_cliente_id = '50000000000001'""")
    assert n == 1, f"a segunda carga duplicou o lead ({n} linhas)"
