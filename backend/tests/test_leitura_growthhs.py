"""A tela de contato mostra o card do GrowthHS no lugar do link do CRM antigo.

`/contatos/enriquecimento` já carregava `nexus_contact_id`; agora carrega
também `growthhs_card_id` e devolve o link pronto (`growthhs_card_url`) — o
frontend comum não lê `growthhs_config`, que é de admin.

⚠️ Em `banco_growthhs`: a configuração e a identidade vivem na transação
revertida — o worker de produção lê a mesma `growthhs_config`.
"""

from growthhs_banco import banco_growthhs  # noqa: F401 — fixture

EMAIL = "enriquecimento-8d@exemplo.invalid"
ROTA = "/contatos/enriquecimento"


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _preparar(conn, app_url):
    await conn.execute("DELETE FROM growthhs_config")
    await conn.execute(
        "INSERT INTO growthhs_config (base_url, app_url) VALUES ($1, $2)",
        "https://api.exemplo.invalid", app_url)
    return await conn.fetchval(
        "INSERT INTO ecosystem_identities (email, growthhs_card_id) VALUES ($1, 4821) "
        "RETURNING dnia_id::text", EMAIL)


async def test_enriquecimento_traz_o_link_pronto_do_card(cliente, banco_growthhs,
                                                        token_admin):
    dnia = await _preparar(banco_growthhs, "https://app.exemplo.invalid/")
    r = await cliente.post(ROTA, headers=_auth(token_admin), json={"dnia_ids": [dnia]})
    assert r.status_code == 200, r.text
    item = r.json()[dnia]
    assert item["growthhs_card_id"] == 4821
    assert item["growthhs_card_url"] == "https://app.exemplo.invalid/cards/4821"


async def test_enriquecimento_sem_app_url_nao_tem_link_mas_o_id_fica(cliente, banco_growthhs,
                                                                     token_admin):
    dnia = await _preparar(banco_growthhs, None)
    r = await cliente.post(ROTA, headers=_auth(token_admin), json={"dnia_ids": [dnia]})
    assert r.status_code == 200, r.text
    item = r.json()[dnia]
    assert item["growthhs_card_id"] == 4821
    assert item["growthhs_card_url"] is None
