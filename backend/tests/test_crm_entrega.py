"""A fila de entrega ao GrowthHS.

O modo de falhar: o lead "vai para o comercial" e não vai (falha silenciosa),
vira dois cards (entrega repetida), ou uma chave errada é re-tentada para
sempre. Nenhum aparece em tela; o vendedor descobre.
"""

import asyncio
from datetime import timedelta

import httpx
import pytest
import pytest_asyncio

import app.database as db
from app.crm import entrega
from app.crm.growthhs import Config

EMAIL = "entrega-8d@exemplo.invalid"
EMAIL_GEMEO = "entrega-8d-gemeo@exemplo.invalid"
CFG = Config(base_url="https://growthhs.exemplo.invalid", board_id=3,
             app_url="https://app.exemplo.invalid", api_key="chave-8d")


def _transporte(status, corpo=None, contagem=None):
    def responder(request):
        if contagem is not None:
            contagem.append(request)
        return httpx.Response(status, json=corpo or {"detail": "x"})
    return httpx.MockTransport(responder)


def _transporte_corpo_invalido(status, contagem=None):
    """Um 2xx cujo corpo NÃO é JSON — round 1, achado I1(b)."""
    def responder(request):
        if contagem is not None:
            contagem.append(request)
        return httpx.Response(status, content=b"isto nao e json")
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
    """422 é o corpo DAQUELE lead — falha o pedido. (401/403/404 são
    configuração e pausam a fila: ver o teste da pausa.)"""
    async with db.sessao(role="service_role") as conn:
        await entrega.enfileirar(conn, lead_8d["lead_id"], "manual")
    resultado = await entrega.rodar_entregas(somente_lead=lead_8d["lead_id"], cfg=CFG, transporte=_transporte(422))
    assert resultado["falhas"] == 1
    pedido = await _pedido(lead_8d["lead_id"])
    assert pedido["status"] == "falhou" and pedido["erro"].startswith("422")
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


async def test_2xx_com_corpo_invalido_ainda_entrega_e_nao_repete(lead_8d):
    """Round 1, achado I1(b): um 2xx já criou o card do lado do GrowthHS —
    corpo ilegível não pode virar re-envio (segundo card)."""
    async with db.sessao(role="service_role") as conn:
        await entrega.enfileirar(conn, lead_8d["lead_id"], "manual")
    chamadas = []
    resultado = await entrega.rodar_entregas(
        somente_lead=lead_8d["lead_id"], cfg=CFG,
        transporte=_transporte_corpo_invalido(201, chamadas))
    assert resultado["entregues"] == 1
    pedido = await _pedido(lead_8d["lead_id"])
    assert pedido["status"] == "entregue" and pedido["card_id"] is None

    # Segunda passada: nada pendente, nenhuma chamada nova ao GrowthHS.
    outro_resultado = await entrega.rodar_entregas(
        somente_lead=lead_8d["lead_id"], cfg=CFG,
        transporte=_transporte_corpo_invalido(201, chamadas))
    assert outro_resultado == {"entregues": 0, "ja_entregues": 0, "adiadas": 0, "falhas": 0, "pausadas": 0}
    assert len(chamadas) == 1


async def test_falha_apos_o_2xx_nao_reenvia(lead_8d, monkeypatch):
    """Round 1, achado I1(a): um defeito NOSSO depois do sucesso (aqui,
    `_registrar_evento` explodindo) não pode desfazer o `entregue` nem
    provocar um segundo POST."""
    async def _explode(*args, **kwargs):
        raise RuntimeError("defeito simulado depois do sucesso")
    monkeypatch.setattr(entrega, "_registrar_evento", _explode)

    async with db.sessao(role="service_role") as conn:
        await entrega.enfileirar(conn, lead_8d["lead_id"], "manual")
    chamadas = []
    resultado = await entrega.rodar_entregas(
        somente_lead=lead_8d["lead_id"], cfg=CFG,
        transporte=_transporte(201, {"id": 4821, "person_id": 1180, "created": True}, chamadas))
    assert resultado["entregues"] == 1
    pedido = await _pedido(lead_8d["lead_id"])
    assert pedido["status"] == "entregue" and pedido["card_id"] == 4821

    # Segunda passada: nada pendente, nenhuma chamada nova ao GrowthHS, mesmo
    # com o passo de registro tendo "quebrado" na primeira.
    outro_resultado = await entrega.rodar_entregas(
        somente_lead=lead_8d["lead_id"], cfg=CFG,
        transporte=_transporte(201, {"id": 9999, "person_id": 1}, chamadas))
    assert outro_resultado == {"entregues": 0, "ja_entregues": 0, "adiadas": 0, "falhas": 0, "pausadas": 0}
    assert len(chamadas) == 1


# ---------------------------------------------------------------------------
# Revisão final do 8D — I2, I3, I5, M2
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def gemeo(lead_8d):
    """Um SEGUNDO lead da mesma pessoa (mesmo `dnia_id`) — o que a fusão de
    contatos produz. Apagado com o que a entrega grava."""
    async def limpar():
        async with db.sessao(role="service_role") as conn:
            ids = [r["id"] for r in await conn.fetch(
                "SELECT id FROM leads WHERE email = $1", EMAIL_GEMEO)]
            await conn.execute("DELETE FROM journey_events WHERE lead_id = ANY($1::uuid[])", ids)
            await conn.execute("DELETE FROM contact_events WHERE lead_id = ANY($1::uuid[])", ids)
            await conn.execute("DELETE FROM leads WHERE id = ANY($1::uuid[])", ids)
            await conn.execute("DELETE FROM ecosystem_identities WHERE email = $1", EMAIL_GEMEO)

    await limpar()
    async with db.sessao(role="service_role") as conn:
        lead = await conn.fetchval(
            """INSERT INTO leads (nome, email, tipo, dnia_id)
               VALUES ('Entrega 8D gêmeo', $1, 'teste', $2::uuid) RETURNING id::text""",
            EMAIL_GEMEO, lead_8d["dnia_id"])
    yield lead
    await limpar()


async def _identidade(dnia_id):
    async with db.sessao(role="service_role") as conn:
        return await conn.fetchrow(
            "SELECT growthhs_card_id, growthhs_person_id FROM ecosystem_identities "
            "WHERE dnia_id = $1::uuid", dnia_id)


async def test_mesma_pessoa_em_dois_leads_nao_vira_dois_cards(lead_8d, gemeo):
    """I2: a origem olhava a PESSOA; olhar só o lead deixava a fusão de
    contatos gerar dois cards para a mesma pessoa."""
    chamadas = []
    corpo = {"id": 4821, "person_id": 1180, "created": True}
    async with db.sessao(role="service_role") as conn:
        await entrega.enfileirar(conn, lead_8d["lead_id"], "manual")
    await entrega.rodar_entregas(somente_lead=lead_8d["lead_id"], cfg=CFG,
                                 transporte=_transporte(201, corpo, chamadas))
    async with db.sessao(role="service_role") as conn:
        await entrega.enfileirar(conn, gemeo, "regra")
    resultado = await entrega.rodar_entregas(somente_lead=gemeo, cfg=CFG,
                                             transporte=_transporte(201, {"id": 9}, chamadas))
    assert len(chamadas) == 1
    assert resultado["ja_entregues"] == 1
    pedido = await _pedido(gemeo)
    assert pedido["status"] == "entregue" and pedido["card_id"] == 4821


async def test_identidade_com_card_conta_como_entregue(lead_8d):
    """I2, o outro lado: card anotado na identidade (entrega de outro lead já
    apagado, ou vínculo lido do GrowthHS) também é "já está lá"."""
    async with db.sessao(role="service_role") as conn:
        await conn.execute(
            "UPDATE ecosystem_identities SET growthhs_card_id = 555, growthhs_person_id = 77 "
            "WHERE dnia_id = $1::uuid", lead_8d["dnia_id"])
        await entrega.enfileirar(conn, lead_8d["lead_id"], "manual")
    chamadas = []
    resultado = await entrega.rodar_entregas(somente_lead=lead_8d["lead_id"], cfg=CFG,
                                             transporte=_transporte(201, {"id": 1}, chamadas))
    assert chamadas == [] and resultado["ja_entregues"] == 1
    pedido = await _pedido(lead_8d["lead_id"])
    assert (pedido["status"], pedido["card_id"], pedido["person_id"]) == ("entregue", 555, 77)


async def test_ja_entregue_preenche_a_identidade_vazia(lead_8d):
    """M2: se a identidade ficou sem o card (a gravação dela é só registro e
    pode ter falhado), o caminho "já entregue" a preenche."""
    corpo = {"id": 4821, "person_id": 1180, "created": True}
    async with db.sessao(role="service_role") as conn:
        await entrega.enfileirar(conn, lead_8d["lead_id"], "manual")
    await entrega.rodar_entregas(somente_lead=lead_8d["lead_id"], cfg=CFG,
                                 transporte=_transporte(201, corpo))
    async with db.sessao(role="service_role") as conn:
        await conn.execute(
            "UPDATE ecosystem_identities SET growthhs_card_id = NULL, growthhs_person_id = NULL "
            "WHERE dnia_id = $1::uuid", lead_8d["dnia_id"])
        await entrega.enfileirar(conn, lead_8d["lead_id"], "manual")
    resultado = await entrega.rodar_entregas(somente_lead=lead_8d["lead_id"], cfg=CFG,
                                             transporte=_transporte(201, {"id": 9}))
    assert resultado["ja_entregues"] == 1
    ident = await _identidade(lead_8d["dnia_id"])
    assert (ident["growthhs_card_id"], ident["growthhs_person_id"]) == (4821, 1180)


async def test_chave_errada_pausa_a_fila_sem_gastar_tentativa(lead_8d, gemeo):
    """I3: 401/403/404 é configuração — a mesma para todos os pedidos. Falhar
    cada um derrubaria a fila inteira de uma vez; o certo é pausar: o pedido
    volta a pendente daqui a 10 min, a tentativa não conta, e o ciclo para
    (os outros pedidos do lote nem são tentados)."""
    async with db.sessao(role="service_role") as conn:
        await entrega.enfileirar(conn, lead_8d["lead_id"], "manual")
        await entrega.enfileirar(conn, gemeo, "manual")
    chamadas = []
    resultado = await entrega.rodar_entregas(
        somente_lead=[lead_8d["lead_id"], gemeo], cfg=CFG,
        transporte=_transporte(401, None, chamadas))
    assert len(chamadas) == 1
    assert resultado["pausadas"] == 2 and resultado["falhas"] == 0
    async with db.sessao(role="service_role") as conn:
        pedidos = await conn.fetch(
            """SELECT status, tentativas, erro, visivel_em > now() + interval '9 minutes' AS adiado
                 FROM crm_handoffs WHERE lead_id = ANY($1::uuid[])""",
            [lead_8d["lead_id"], gemeo])
    assert [(p["status"], p["tentativas"], p["adiado"]) for p in pedidos] == [
        ("pendente", 0, True), ("pendente", 0, True)]
    assert sum(1 for p in pedidos if p["erro"] and p["erro"].startswith(entrega.PREFIXO_PAUSA)) == 1
    assert await _eventos(lead_8d["lead_id"], "crm_handoff_falhou") == []
    assert await _eventos(gemeo, "crm_handoff_falhou") == []


@pytest.mark.parametrize("codigo", [403, 404])
async def test_403_e_404_tambem_pausam(lead_8d, codigo):
    async with db.sessao(role="service_role") as conn:
        await entrega.enfileirar(conn, lead_8d["lead_id"], "manual")
    resultado = await entrega.rodar_entregas(somente_lead=lead_8d["lead_id"], cfg=CFG,
                                             transporte=_transporte(codigo))
    assert resultado["pausadas"] == 1
    pedido = await _pedido(lead_8d["lead_id"])
    assert pedido["status"] == "pendente" and pedido["tentativas"] == 0


def test_transitorio_espera_com_teto_e_desiste_depois_de_um_dia():
    """I3: a fila desistia em ~31 min — um GrowthHS fora do ar numa noite
    derrubava todos os pedidos. Agora a espera dobra até 60 min e o total
    passa de 24 h."""
    esperas = [entrega.espera_transitoria(n) for n in range(1, entrega.MAX_TENTATIVAS)]
    assert esperas[0] == timedelta(minutes=1)
    assert max(esperas) == timedelta(minutes=60)
    assert sum(esperas, timedelta()) > timedelta(hours=24)


async def test_parada_do_worker_sai_entre_pedidos_e_devolve_o_resto(lead_8d, gemeo):
    """I5: o worker pedindo parada não pode ficar entregando o lote inteiro;
    sai entre um pedido e outro, e o que foi reivindicado e não tentado volta
    à fila na hora, sem gastar tentativa."""
    parar = asyncio.Event()
    chamadas = []

    def responder(request):
        chamadas.append(request)
        parar.set()
        return httpx.Response(201, json={"id": 4821})

    async with db.sessao(role="service_role") as conn:
        await entrega.enfileirar(conn, lead_8d["lead_id"], "manual")
        await entrega.enfileirar(conn, gemeo, "manual")
        # O gêmeo não pode cair no "já entregue" por ser a mesma pessoa: tira
        # a identidade dele para o teste medir só a parada.
        await conn.execute("UPDATE leads SET dnia_id = NULL WHERE id = $1::uuid", gemeo)
    resultado = await entrega.rodar_entregas(
        somente_lead=[lead_8d["lead_id"], gemeo], cfg=CFG,
        transporte=httpx.MockTransport(responder), parar=parar)
    assert len(chamadas) == 1 and resultado["entregues"] == 1
    async with db.sessao(role="service_role") as conn:
        restante = await conn.fetchrow(
            """SELECT status, tentativas, visivel_em <= now() AS visivel FROM crm_handoffs
                WHERE lead_id = ANY($1::uuid[]) AND status = 'pendente'""",
            [lead_8d["lead_id"], gemeo])
    assert (restante["status"], restante["tentativas"], restante["visivel"]) == ("pendente", 0, True)


async def test_cancelar_depois_do_2xx_ainda_grava_entregue(lead_8d, monkeypatch):
    """I5: o card já existe do lado do GrowthHS; um cancelamento (o worker
    desistindo de esperar na parada) no meio da gravação não pode deixar o
    pedido pendente — seria o segundo card."""
    original = entrega._marcar_entregue

    async def lento(*args):
        await asyncio.sleep(0.3)
        await original(*args)
    monkeypatch.setattr(entrega, "_marcar_entregue", lento)

    async with db.sessao(role="service_role") as conn:
        await entrega.enfileirar(conn, lead_8d["lead_id"], "manual")
    chamadas = []
    tarefa = asyncio.create_task(entrega.rodar_entregas(
        somente_lead=lead_8d["lead_id"], cfg=CFG,
        transporte=_transporte(201, {"id": 4821}, chamadas)))
    while not chamadas:
        await asyncio.sleep(0.01)
    await asyncio.sleep(0.1)
    tarefa.cancel()
    with pytest.raises(asyncio.CancelledError):
        await tarefa
    # A gravação blindada continua depois do cancelamento (0,3 s do `lento` +
    # idas ao banco remoto). Até 01/10 era um `sleep(0.6)` fixo, que sob a
    # carga da suíte inteira não bastou (achou 'pendente'). Agora sonda até
    # gravar ou estourar o teto — o teto é generoso porque só é gasto no
    # vermelho de verdade; a asserção abaixo não muda.
    prazo = asyncio.get_running_loop().time() + 10
    while True:
        pedido = await _pedido(lead_8d["lead_id"])
        if pedido["status"] == "entregue" or asyncio.get_running_loop().time() > prazo:
            break
        await asyncio.sleep(0.1)
    assert pedido["status"] == "entregue" and pedido["card_id"] == 4821
