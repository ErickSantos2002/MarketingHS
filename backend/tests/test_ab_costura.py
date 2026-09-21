"""A costura do A/B no servidor — o que era `_shared/ab.ts`.

⚠️ O modo de falhar é o pior do projeto: sem costura, o relatório do teste
mostra exposição e ZERO conversão, que parece variante ruim, não defeito. Foi
o que aconteceu entre os lotes 1D e 8C, e nenhuma tela acusou.
"""

import pytest_asyncio

import app.database as db
from app.ab.costura import Ab, costurar_visitante, extrair_ab, registrar_conversao_ab


def test_extrai_do_topo_antes_do_metadata_e_vazio_vira_nada():
    ab = extrair_ab({"ab_vid": " v1 ", "ab_test": None, "ab_var": ""},
                    {"ab_test": "t1", "ab_var": "B"})
    # `""` no topo NÃO cai para o metadata — o `??` da origem só pula nulo.
    assert ab == Ab("v1", "t1", None)
    assert extrair_ab({}, None) == Ab(None, None, None)


async def test_falha_na_costura_nao_derruba_a_transacao_de_quem_chama(conexao):
    """Decisão 8: sem o SAVEPOINT, este erro abortaria a transação e o contato
    que a rota acabou de gravar iria junto — o `SELECT 1` abaixo estouraria
    com `InFailedSQLTransactionError`. O erro é do SERVIDOR (cast
    `::text::uuid`); ver o docstring de `app/ab/costura.py`."""
    ab = await costurar_visitante(conexao, Ab("v_teste8c-x", "teste-8c-t", "A"),
                                  email=None, phone=None, phone_normalized=None,
                                  lead_id="não-é-uuid", dnia_id=None,
                                  source_app="marketinghs", metadata=None)
    assert ab == Ab("v_teste8c-x", "teste-8c-t", "A")
    assert await conexao.fetchval("SELECT 1") == 1


async def test_sem_vid_acha_pelo_email_e_completa_pelo_ultimo_clique(conexao):
    await conexao.execute(
        "INSERT INTO ab_assignments (ab_test, ab_var, ab_vid) "
        "VALUES ('teste-8c-t', 'B', 'v_teste8c-f')")
    await conexao.execute(
        "INSERT INTO ab_identities (ab_vid, email, source_app) "
        "VALUES ('v_teste8c-f', 'fallback-8c@exemplo.invalid', 'nexus')")
    ab = await costurar_visitante(conexao, Ab(), email="Fallback-8C@exemplo.invalid",
                                  phone=None, phone_normalized=None, lead_id=None,
                                  dnia_id=None, source_app="nexus", metadata=None)
    assert ab == Ab("v_teste8c-f", "teste-8c-t", "B")
    # Já havia a costura por esse e-mail: não duplica.
    assert await conexao.fetchval(
        "SELECT count(*) FROM ab_identities WHERE ab_vid = 'v_teste8c-f'") == 1


async def test_conversao_so_uma_vez_e_so_com_teste(conexao):
    ab = Ab("v_teste8c-c", "teste-8c-t", "A")
    for _ in range(2):
        await registrar_conversao_ab(conexao, ab, "lead_criado", page_slug="lp")
    await registrar_conversao_ab(conexao, Ab("v_teste8c-c", None, None), "lead_criado")
    linhas = await conexao.fetch(
        "SELECT event_type, event_name, dedupe_key FROM ab_events WHERE ab_vid = 'v_teste8c-c'")
    assert [dict(l) for l in linhas] == [{
        "event_type": "conversion", "event_name": "lead_criado",
        "dedupe_key": "v_teste8c-c:teste-8c-t:conversion:lead_criado"}]


EMAIL_AB = "ab-8c@exemplo.invalid"


@pytest_asyncio.fixture
async def contato_ab(chave_de, limpar_ab):
    """Chave `write` e limpeza do contato que as rotas criam pelo e-mail.

    ⚠️ `journey_events` não tem FK: `trg_contact_event_journey` copia todo
    `contact_events`, e a cópia fica se não for apagada aqui.
    """
    async def limpar():
        async with db.sessao(role="service_role") as conn:
            leads = await conn.fetch("SELECT id FROM leads WHERE lower(email) = $1", EMAIL_AB)
            ids = [l["id"] for l in leads]
            identidades = await conn.fetch(
                "SELECT dnia_id FROM ecosystem_identities WHERE lower(email) = $1", EMAIL_AB)
            dnias = [i["dnia_id"] for i in identidades]
            await conn.execute("DELETE FROM journey_events WHERE lead_id = ANY($1::uuid[])", ids)
            await conn.execute("DELETE FROM contact_events WHERE lead_id = ANY($1::uuid[]) "
                               "OR dnia_id = ANY($2::uuid[])", ids, dnias)
            await conn.execute("DELETE FROM ab_identities WHERE lower(email) = $1", EMAIL_AB)
            await conn.execute("DELETE FROM ecosystem_identities WHERE lower(email) = $1",
                               EMAIL_AB)
            await conn.execute("DELETE FROM leads WHERE id = ANY($1::uuid[])", ids)

    await limpar()
    yield await chave_de("write")
    await limpar()


async def test_identidade_costura_o_visitante_ao_contato_uma_vez(cliente, contato_ab):
    corpo = {"email": EMAIL_AB, "nome": "Visitante 8C", "source_app": "nexus",
             "metadata": {"ab_vid": "v_teste8c-id", "ab_test": "teste-8c-id", "ab_var": "A"}}
    for _ in range(2):
        r = await cliente.post("/publico/identidade", json=corpo,
                               headers={"Authorization": f"Bearer {contato_ab}"})
        assert r.status_code == 200, r.text
    lead_id = r.json()["lead_id"]
    async with db.sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            "SELECT lead_id::text, source_app FROM ab_identities WHERE ab_vid = 'v_teste8c-id'")
    assert [dict(l) for l in linhas] == [{"lead_id": lead_id, "source_app": "nexus"}]


async def test_agendamento_vira_conversao_do_teste(cliente, contato_ab):
    r = await cliente.post("/publico/evento-de-contato", headers={
        "Authorization": f"Bearer {contato_ab}"}, json={
        "source_app": "nexus", "event_type": "meeting_scheduled",
        "title": "Reunião agendada", "email": EMAIL_AB,
        "metadata": {"ab_vid": "v_teste8c-ag", "ab_test": "teste-8c-ag", "ab_var": "B"}})
    assert r.status_code == 200, r.text
    async with db.sessao(role="service_role") as conn:
        conversao = await conn.fetchrow(
            "SELECT event_name, ab_var, metadata FROM ab_events "
            "WHERE ab_test = 'teste-8c-ag' AND event_type = 'conversion'")
        costurado = await conn.fetchval(
            "SELECT count(*) FROM ab_identities WHERE ab_vid = 'v_teste8c-ag'")
    assert conversao["event_name"] == "agendamento" and conversao["ab_var"] == "B"
    assert conversao["metadata"] == {"event_type": "meeting_scheduled"}
    assert costurado == 1


async def test_evento_que_nao_e_agendamento_costura_mas_nao_converte(cliente, contato_ab):
    r = await cliente.post("/publico/evento-de-contato", headers={
        "Authorization": f"Bearer {contato_ab}"}, json={
        "source_app": "nexus", "event_type": "deal_moved", "title": "Moveu",
        "email": EMAIL_AB, "ab_vid": "v_teste8c-mv", "ab_test": "teste-8c-mv"})
    assert r.status_code == 200, r.text
    async with db.sessao(role="service_role") as conn:
        assert await conn.fetchval(
            "SELECT count(*) FROM ab_events WHERE ab_test = 'teste-8c-mv'") == 0
        assert await conn.fetchval(
            "SELECT count(*) FROM ab_identities WHERE ab_vid = 'v_teste8c-mv'") == 1
