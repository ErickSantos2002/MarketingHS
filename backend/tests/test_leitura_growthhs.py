"""A tela de contato mostra o card do GrowthHS no lugar do link do CRM antigo.

`/contatos/enriquecimento` já carregava `nexus_contact_id`; agora carrega
também `growthhs_card_id` e devolve o link pronto (`growthhs_card_url`) — o
frontend comum não lê `growthhs_config`, que é de admin.
"""

import pytest_asyncio

import app.database as db

EMAIL = "enriquecimento-8d@exemplo.invalid"
ROTA = "/contatos/enriquecimento"


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def identidade_8d():
    """Uma identidade com card no GrowthHS, apagada no fim."""
    await db.init_db()

    async def limpar():
        async with db.sessao(role="service_role") as conn:
            await conn.execute("DELETE FROM ecosystem_identities WHERE email = $1", EMAIL)

    await limpar()
    async with db.sessao(role="service_role") as conn:
        dnia = await conn.fetchval(
            "INSERT INTO ecosystem_identities (email, growthhs_card_id) VALUES ($1, 4821) "
            "RETURNING dnia_id::text", EMAIL)
    yield dnia
    await limpar()


async def test_enriquecimento_traz_o_link_pronto_do_card(
    cliente, token_admin, config_growthhs, identidade_8d,
):
    await config_growthhs("https://api.exemplo.invalid", 3, "https://app.exemplo.invalid")
    r = await cliente.post(ROTA, headers=_auth(token_admin), json={"dnia_ids": [identidade_8d]})
    assert r.status_code == 200, r.text
    item = r.json()[identidade_8d]
    assert item["growthhs_card_id"] == 4821
    assert item["growthhs_card_url"] == "https://app.exemplo.invalid/cards/4821"


async def test_enriquecimento_sem_app_url_nao_tem_link_mas_o_id_fica(
    cliente, token_admin, config_growthhs, identidade_8d,
):
    await config_growthhs("https://api.exemplo.invalid", 3)
    r = await cliente.post(ROTA, headers=_auth(token_admin), json={"dnia_ids": [identidade_8d]})
    assert r.status_code == 200, r.text
    item = r.json()[identidade_8d]
    assert item["growthhs_card_id"] == 4821
    assert item["growthhs_card_url"] is None
