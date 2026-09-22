"""A configuração do GrowthHS. O modo de falhar é a chave voltar inteira na
resposta (é ela que cria card no funil de vendas) ou um usuário comum mudar
para onde vão os leads."""

import httpx
import pytest
import pytest_asyncio

import app.database as db
from app import integracoes
from app.crm import entrega, growthhs

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
    # Revisão final do 8D (I3): o banco é o de produção, e o worker (outro
    # processo, cache de 60 s do segredo) poderia mandar a chave falsa deste
    # teste ao GrowthHS de verdade. Com chave real gravada, o teste não roda.
    if await integracoes.ler_segredo(growthhs.SEGREDO_CHAVE):
        pytest.skip("há chave real do GrowthHS gravada — o teste não sobrescreve produção")
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


# ---------------------------------------------------------------------------
# Revisão final do 8D — I3 (pausa e reenfileirar), M3 (falhas que já não são)
# ---------------------------------------------------------------------------

EMAILS_FILA = ("fila-8d-a@exemplo.invalid", "fila-8d-b@exemplo.invalid")


@pytest_asyncio.fixture
async def leads_fila():
    """Dois leads sem identidade, apagados (com o que o INSERT grava sem FK)
    antes e depois. `crm_handoffs` vai junto pelo ON DELETE CASCADE."""
    await db.init_db()

    async def limpar():
        async with db.sessao(role="service_role") as conn:
            ids = [r["id"] for r in await conn.fetch(
                "SELECT id FROM leads WHERE email = ANY($1::text[])", list(EMAILS_FILA))]
            await conn.execute("DELETE FROM journey_events WHERE lead_id = ANY($1::uuid[])", ids)
            await conn.execute("DELETE FROM contact_events WHERE lead_id = ANY($1::uuid[])", ids)
            await conn.execute("DELETE FROM leads WHERE id = ANY($1::uuid[])", ids)

    await limpar()
    async with db.sessao(role="service_role") as conn:
        ids = [await conn.fetchval(
            "INSERT INTO leads (nome, email, tipo) VALUES ('Fila 8D', $1, 'teste') "
            "RETURNING id::text", e) for e in EMAILS_FILA]
    yield ids
    await limpar()


async def test_chave_errada_aparece_como_pausa(cliente, token_admin, config_growthhs,
                                              leads_fila):
    await config_growthhs(None, None)
    async with db.sessao(role="service_role") as conn:
        await entrega.enfileirar(conn, leads_fila[0], "manual")
    cfg = growthhs.Config(base_url="https://growthhs.exemplo.invalid", board_id=3,
                          app_url=None, api_key="chave-errada")
    await entrega.rodar_entregas(
        somente_lead=leads_fila[0], cfg=cfg,
        transporte=httpx.MockTransport(lambda r: httpx.Response(401, json={"detail": "chave"})))
    fila = (await cliente.get(ROTA, headers=_auth(token_admin))).json()["fila"]
    assert fila["pausada"] is not None
    assert "401" in fila["pausada"]["motivo"] and fila["pausada"]["desde"]


async def test_falha_ja_resolvida_nao_conta(cliente, token_admin, config_growthhs, leads_fila):
    """M3: um pedido que falhou e depois foi entregue (reenfileirado, botão)
    não é falha — o painel não pode acusar o que já chegou ao comercial."""
    await config_growthhs(None, None)
    antes = (await cliente.get(ROTA, headers=_auth(token_admin))).json()["fila"]["falhas"]
    async with db.sessao(role="service_role") as conn:
        await conn.execute(
            "INSERT INTO crm_handoffs (lead_id, origem, status, erro) "
            "VALUES ($1::uuid, 'manual', 'falhou', '503: fora do ar')", leads_fila[0])
        await conn.execute(
            "INSERT INTO crm_handoffs (lead_id, origem, status, card_id) "
            "VALUES ($1::uuid, 'manual', 'entregue', 4821)", leads_fila[0])
    fila = (await cliente.get(ROTA, headers=_auth(token_admin))).json()["fila"]
    assert fila["falhas"] == antes
    assert all(f["lead_id"] != leads_fila[0] for f in fila["ultimas_falhas"])


async def test_reenfileirar_devolve_as_falhas_sem_entrega(cliente, token_admin, token_usuario,
                                                         leads_fila):
    r = await cliente.post(f"{ROTA}/reenfileirar", headers=_auth(token_usuario))
    assert r.status_code == 403

    async with db.sessao(role="service_role") as conn:
        # ⚠️ A rota reenfileira a fila INTEIRA — o banco é o de produção. Com
        # falha real na fila, o teste não roda (não é ele quem decide isso).
        reais = await conn.fetchval(
            "SELECT count(*) FROM crm_handoffs WHERE status = 'falhou' "
            "AND lead_id <> ALL($1::uuid[])", leads_fila)
        if reais:
            pytest.skip("há falhas reais na fila — o teste não reenfileira produção")
        # O primeiro só falhou; o segundo falhou e depois chegou ao comercial.
        await conn.execute(
            "INSERT INTO crm_handoffs (lead_id, origem, status, erro, tentativas) "
            "VALUES ($1::uuid, 'manual', 'falhou', '422: corpo', 3)", leads_fila[0])
        await conn.execute(
            "INSERT INTO crm_handoffs (lead_id, origem, status, erro) "
            "VALUES ($1::uuid, 'manual', 'falhou', '422: corpo')", leads_fila[1])
        await conn.execute(
            "INSERT INTO crm_handoffs (lead_id, origem, status, card_id) "
            "VALUES ($1::uuid, 'manual', 'entregue', 4821)", leads_fila[1])

    r = await cliente.post(f"{ROTA}/reenfileirar", headers=_auth(token_admin))
    assert r.status_code == 200, r.text
    assert r.json() == {"reenfileirados": 1}
    async with db.sessao(role="service_role") as conn:
        primeiro = await conn.fetchrow(
            "SELECT status, tentativas, erro, visivel_em <= now() AS visivel "
            "FROM crm_handoffs WHERE lead_id = $1::uuid", leads_fila[0])
        segundo = await conn.fetchval(
            "SELECT count(*) FROM crm_handoffs WHERE lead_id = $1::uuid AND status = 'pendente'",
            leads_fila[1])
    assert dict(primeiro) == {"status": "pendente", "tentativas": 0, "erro": None, "visivel": True}
    assert segundo == 0
