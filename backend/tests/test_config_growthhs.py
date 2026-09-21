"""A configuração do GrowthHS. O modo de falhar é a chave voltar inteira na
resposta (é ela que cria card no funil de vendas) ou um usuário comum mudar
para onde vão os leads."""

import app.database as db
from app import integracoes
from app.crm import growthhs

ROTA = "/config/growthhs"


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _sem_chave():
    anterior = await integracoes.ler_segredo(growthhs.SEGREDO_CHAVE)
    await integracoes.apagar_segredo(growthhs.SEGREDO_CHAVE)
    return anterior


async def test_config_exige_admin(cliente, token_usuario):
    for metodo, corpo in (("GET", None), ("PUT", {"board_id": 1})):
        r = await cliente.request(metodo, ROTA, json=corpo, headers=_auth(token_usuario))
        assert r.status_code == 403
    r = await cliente.post(f"{ROTA}/testar", headers=_auth(token_usuario))
    assert r.status_code == 403


async def test_grava_parcial_e_nunca_devolve_a_chave(cliente, token_admin, config_growthhs):
    await config_growthhs(None, None)
    anterior = await _sem_chave()
    try:
        r = await cliente.put(ROTA, headers=_auth(token_admin), json={
            "base_url": "https://growthhs.exemplo.invalid/", "board_id": 3,
            "api_key": "chave-secreta-8d-1234"})
        assert r.status_code == 200, r.text
        corpo = r.json()
        assert corpo["base_url"] == "https://growthhs.exemplo.invalid"
        assert corpo["board_id"] == 3 and corpo["configurado"] is True
        assert corpo["api_key"] == {"configurado": True, "ultimos4": "1234"}
        assert "chave-secreta" not in r.text

        # Só o endereço do app: o resto fica.
        r = await cliente.put(ROTA, headers=_auth(token_admin),
                              json={"app_url": "https://app.exemplo.invalid"})
        assert r.json()["board_id"] == 3
        assert r.json()["app_url"] == "https://app.exemplo.invalid"

        r = await cliente.put(ROTA, headers=_auth(token_admin), json={"limpar": ["api_key"]})
        assert r.json()["api_key"]["configurado"] is False
        assert r.json()["configurado"] is False
    finally:
        # Devolve exatamente o que havia — inclusive "nada": a chave de teste
        # não pode ficar gravada se o teste quebrar no meio.
        if anterior:
            await integracoes.gravar_segredo(growthhs.SEGREDO_CHAVE, anterior)
        else:
            await integracoes.apagar_segredo(growthhs.SEGREDO_CHAVE)
        integracoes.esquecer(growthhs.SEGREDO_CHAVE)


async def test_recusa_endereco_sem_protocolo_e_funil_invalido(cliente, token_admin,
                                                             config_growthhs):
    await config_growthhs(None, None)
    r = await cliente.put(ROTA, headers=_auth(token_admin),
                          json={"base_url": "growthhs.exemplo.invalid"})
    assert r.status_code == 422
    r = await cliente.put(ROTA, headers=_auth(token_admin), json={"board_id": 0})
    assert r.status_code == 422


async def test_mostra_a_fila_com_as_falhas(cliente, token_admin, config_growthhs):
    await config_growthhs(None, None)
    async with db.sessao(role="service_role") as conn:
        lead = await conn.fetchval(
            "INSERT INTO leads (nome, email, tipo) VALUES ('Fila 8D', "
            "'fila-8d@exemplo.invalid', 'teste') RETURNING id::text")
        await conn.execute(
            "INSERT INTO crm_handoffs (lead_id, origem, status, erro) "
            "VALUES ($1::uuid, 'manual', 'falhou', '401: chave inválida')", lead)
    try:
        fila = (await cliente.get(ROTA, headers=_auth(token_admin))).json()["fila"]
        assert fila["falhas"] >= 1
        assert any(f["lead_id"] == lead and f["erro"] == "401: chave inválida"
                   for f in fila["ultimas_falhas"])
    finally:
        # `fn_lead_insert_event` grava um contact_event (e o gatilho das
        # jornadas, um journey_event) em todo INSERT de lead — sem FK.
        async with db.sessao(role="service_role") as conn:
            await conn.execute("DELETE FROM journey_events WHERE lead_id = $1::uuid", lead)
            await conn.execute("DELETE FROM contact_events WHERE lead_id = $1::uuid", lead)
            await conn.execute("DELETE FROM leads WHERE id = $1::uuid", lead)


async def test_testar_sem_endereco_e_400(cliente, token_admin, config_growthhs):
    await config_growthhs(None, None)
    r = await cliente.post(f"{ROTA}/testar", headers=_auth(token_admin))
    assert r.status_code == 400
