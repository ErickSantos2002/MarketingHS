"""A fila de entrega ao GrowthHS.

O modo de falhar: o lead "vai para o comercial" e não vai (falha silenciosa),
vira dois cards (entrega repetida), ou uma chave errada é re-tentada para
sempre. Nenhum aparece em tela; o vendedor descobre.
"""

import httpx
import pytest_asyncio

import app.database as db
from app.crm import entrega
from app.crm.growthhs import Config

EMAIL = "entrega-8d@exemplo.invalid"
CFG = Config(base_url="https://growthhs.exemplo.invalid", board_id=3,
             app_url="https://app.exemplo.invalid", api_key="chave-8d")


def _transporte(status, corpo=None, contagem=None):
    def responder(request):
        if contagem is not None:
            contagem.append(request)
        return httpx.Response(status, json=corpo or {"detail": "x"})
    return httpx.MockTransport(responder)


@pytest_asyncio.fixture
async def lead_8d():
    """Um lead com identidade, apagado com tudo o que a entrega grava."""
    await db.init_db()

    async def limpar():
        async with db.sessao(role="service_role") as conn:
            ids = [r["id"] for r in await conn.fetch(
                "SELECT id FROM leads WHERE email = $1", EMAIL)]
            await conn.execute("DELETE FROM journey_events WHERE lead_id = ANY($1::uuid[])", ids)
            await conn.execute("DELETE FROM contact_events WHERE lead_id = ANY($1::uuid[])", ids)
            await conn.execute("DELETE FROM leads WHERE id = ANY($1::uuid[])", ids)
            await conn.execute("DELETE FROM ecosystem_identities WHERE email = $1", EMAIL)

    await limpar()
    async with db.sessao(role="service_role") as conn:
        dnia = await conn.fetchval(
            "INSERT INTO ecosystem_identities (email) VALUES ($1) RETURNING dnia_id::text", EMAIL)
        lead = await conn.fetchval(
            """INSERT INTO leads (nome, email, tipo, dnia_id, utm_source)
               VALUES ('Entrega 8D', $1, 'teste', $2::uuid, 'google') RETURNING id::text""",
            EMAIL, dnia)
    yield {"lead_id": lead, "dnia_id": dnia}
    await limpar()


async def _pedido(lead_id):
    async with db.sessao(role="service_role") as conn:
        return await conn.fetchrow(
            "SELECT * FROM crm_handoffs WHERE lead_id = $1::uuid ORDER BY id DESC LIMIT 1",
            lead_id)


async def _eventos(lead_id, tipo):
    async with db.sessao(role="service_role") as conn:
        return await conn.fetch(
            "SELECT metadata FROM contact_events WHERE lead_id = $1::uuid AND event_type = $2",
            lead_id, tipo)


async def test_enfileirar_nao_duplica_pendente(lead_8d):
    async with db.sessao(role="service_role") as conn:
        primeiro = await entrega.enfileirar(conn, lead_8d["lead_id"], "manual")
        segundo = await entrega.enfileirar(conn, lead_8d["lead_id"], "regra")
    assert primeiro is not None and segundo is None


async def test_sem_configuracao_nao_reivindica_nada(lead_8d):
    async with db.sessao(role="service_role") as conn:
        await entrega.enfileirar(conn, lead_8d["lead_id"], "manual")
    vazio = Config(base_url=None, board_id=None, app_url=None, api_key=None)
    assert await entrega.rodar_entregas(cfg=vazio, somente_lead=lead_8d["lead_id"]) == {"desligado": True}
    assert (await _pedido(lead_8d["lead_id"]))["status"] == "pendente"


async def test_entrega_grava_o_card_na_fila_na_identidade_e_na_linha_do_tempo(lead_8d):
    async with db.sessao(role="service_role") as conn:
        await entrega.enfileirar(conn, lead_8d["lead_id"], "manual")
    resultado = await entrega.rodar_entregas(somente_lead=lead_8d["lead_id"], cfg=CFG, transporte=_transporte(201, {"id": 4821, "person_id": 1180, "created": True}))
    assert resultado["entregues"] == 1

    pedido = await _pedido(lead_8d["lead_id"])
    assert pedido["status"] == "entregue" and pedido["card_id"] == 4821
    async with db.sessao(role="service_role") as conn:
        ident = await conn.fetchrow(
            "SELECT growthhs_card_id, growthhs_person_id FROM ecosystem_identities "
            "WHERE dnia_id = $1::uuid", lead_8d["dnia_id"])
    assert (ident["growthhs_card_id"], ident["growthhs_person_id"]) == (4821, 1180)
    eventos = await _eventos(lead_8d["lead_id"], "crm_handoff")
    assert eventos[0]["metadata"]["card_id"] == 4821
    assert eventos[0]["metadata"]["origem"] == "manual"


async def test_lead_ja_entregue_nao_chama_de_novo(lead_8d):
    chamadas = []
    corpo = {"id": 4821, "person_id": 1180, "created": True}
    for _ in range(2):
        async with db.sessao(role="service_role") as conn:
            await entrega.enfileirar(conn, lead_8d["lead_id"], "regra")
        await entrega.rodar_entregas(somente_lead=lead_8d["lead_id"], cfg=CFG, transporte=_transporte(201, corpo, chamadas))
    assert len(chamadas) == 1
    assert (await _pedido(lead_8d["lead_id"]))["card_id"] == 4821


async def test_erro_definitivo_falha_na_hora_e_aparece(lead_8d):
    async with db.sessao(role="service_role") as conn:
        await entrega.enfileirar(conn, lead_8d["lead_id"], "manual")
    resultado = await entrega.rodar_entregas(somente_lead=lead_8d["lead_id"], cfg=CFG, transporte=_transporte(401))
    assert resultado["falhas"] == 1
    pedido = await _pedido(lead_8d["lead_id"])
    assert pedido["status"] == "falhou" and pedido["erro"].startswith("401")
    assert len(await _eventos(lead_8d["lead_id"], "crm_handoff_falhou")) == 1


async def test_erro_transitorio_adia_e_esgota(lead_8d, monkeypatch):
    async with db.sessao(role="service_role") as conn:
        await entrega.enfileirar(conn, lead_8d["lead_id"], "manual")
    assert (await entrega.rodar_entregas(somente_lead=lead_8d["lead_id"], cfg=CFG, transporte=_transporte(503)))["adiadas"] == 1
    pedido = await _pedido(lead_8d["lead_id"])
    assert pedido["status"] == "pendente" and pedido["tentativas"] == 1

    # Esgotar: com o pedido já visível e o teto em 2, a próxima falha é final.
    monkeypatch.setattr(entrega, "MAX_TENTATIVAS", 2)
    async with db.sessao(role="service_role") as conn:
        await conn.execute("UPDATE crm_handoffs SET visivel_em = now() WHERE id = $1",
                           pedido["id"])
    assert (await entrega.rodar_entregas(somente_lead=lead_8d["lead_id"], cfg=CFG, transporte=_transporte(503)))["falhas"] == 1
    assert (await _pedido(lead_8d["lead_id"]))["status"] == "falhou"


async def test_mover_etapa_falha_a_vista(lead_8d):
    async with db.sessao(role="service_role") as conn:
        await entrega.enfileirar(conn, lead_8d["lead_id"], "regra", acao="mover")
    chamadas = []
    await entrega.rodar_entregas(somente_lead=lead_8d["lead_id"], cfg=CFG, transporte=_transporte(201, {"id": 1}, chamadas))
    pedido = await _pedido(lead_8d["lead_id"])
    assert pedido["status"] == "falhou" and "mover" in pedido["erro"]
    assert chamadas == []
