"""A configuração do GrowthHS real (client-credentials + webhook de volta).

O modo de falhar é um segredo voltar inteiro na resposta (o `client_secret`
cria card no funil de vendas; o do webhook marca reunião e venda), um usuário
comum mudar para onde vão os leads, ou um espaço colado no segredo virar 401
eterno (o GrowthHS faz `strip()` do segredo dele antes de assinar).

⚠️ Tudo roda em `banco_growthhs`: `growthhs_config`, `integration_secrets`,
leads e `crm_handoffs` vivem na transação revertida. O worker de produção lê
as mesmas tabelas — gravar ali de verdade mandaria a credencial falsa daqui ao
GrowthHS real. Os fixtures de token vêm DEPOIS de `banco_growthhs` na
assinatura: a `conexao` fecha a pool ao sair, e o token apaga o usuário de
teste pela pool.
"""

import httpx
import pytest

from app import integracoes
from app.config import settings
from app.crm import entrega, growthhs
from app.routers import configuracao
from growthhs_banco import SEGREDOS, banco_growthhs  # noqa: F401 — fixture

ROTA = "/config/growthhs"
# Os testes de gravação usam a homologação; os de dois ambientes, as duas.
AMB = "homologacao"
ROTA_AMB = f"{ROTA}/{AMB}"
SEGREDO_CLIENTE = "segredo-do-cliente-8d-1234"
SEGREDO_WEBHOOK = "segredo-do-webhook-com-folga"


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _amb(r, ambiente=AMB):
    """O estado de um ambiente na resposta de `GET/PUT /config/growthhs`."""
    return r.json()["ambientes"][ambiente]


async def _zerar(conn, monkeypatch):
    """Configuração e segredos vazios NESTA transação (e no ambiente: o
    `ler_segredo` cai para `os.environ` quando o banco não tem)."""
    for nome in SEGREDOS:
        monkeypatch.delenv(nome, raising=False)
        integracoes.esquecer(nome)
    await conn.execute("DELETE FROM growthhs_config")
    await conn.execute("DELETE FROM public.integration_secrets WHERE name = ANY($1::text[])",
                       list(SEGREDOS))


async def _configurar(conn, monkeypatch, *, base_url="https://growthhs.exemplo.invalid",
                      client_id="hsg_teste_cfg", segredo=SEGREDO_CLIENTE):
    await _zerar(conn, monkeypatch)
    await conn.execute(
        """INSERT INTO growthhs_config (ambiente, base_url, client_id, list_id,
                                        boards_conferidos)
           VALUES ($3, $1, $2, 22, '{6,7}')""", base_url, client_id, AMB)
    if segredo:
        await integracoes.gravar_segredo(growthhs.segredo_cliente(AMB), segredo)


async def test_config_exige_admin(cliente, token_usuario):
    for metodo, rota, corpo in (("GET", ROTA, None), ("PUT", ROTA_AMB, {"list_id": 1}),
                                ("POST", f"{ROTA_AMB}/testar", None),
                                ("POST", f"{ROTA}/ativar", {"ambiente": AMB}),
                                ("POST", f"{ROTA}/reenfileirar", None)):
        r = await cliente.request(metodo, rota, json=corpo, headers=_auth(token_usuario))
        assert r.status_code == 403, (metodo, rota)


async def test_grava_parcial_e_nunca_devolve_segredos(cliente, banco_growthhs, token_admin,
                                                      monkeypatch):
    conn = banco_growthhs
    await _zerar(conn, monkeypatch)
    r = await cliente.put(ROTA_AMB, headers=_auth(token_admin), json={
        "base_url": "https://growthhs.exemplo.invalid/", "client_id": "  hsg_cliente  ",
        # ⚠️ Espaço colado em volta: o GrowthHS faz strip do dele, então o
        # nosso tem de ir sem — senão 401 para sempre.
        "client_secret": f"  {SEGREDO_CLIENTE}\n", "list_id": 22,
        "boards_conferidos": [6, 7], "webhook_secret": f" {SEGREDO_WEBHOOK} ",
        "listas_reuniao": [28], "listas_ganho": [32, 33]})
    assert r.status_code == 200, r.text
    corpo = _amb(r)
    assert corpo["base_url"] == "https://growthhs.exemplo.invalid"
    assert corpo["client_id"] == "hsg_cliente"
    assert corpo["list_id"] == 22 and corpo["boards_conferidos"] == [6, 7]
    assert corpo["listas_reuniao"] == [28] and corpo["listas_ganho"] == [32, 33]
    assert corpo["client_secret"] == {"configurado": True, "ultimos4": "1234"}
    assert corpo["webhook_secret"] == {"configurado": True}
    # Completo, mas não ATIVO: gravar não liga a fila.
    assert corpo["completo"] is True and corpo["ativo"] is False
    assert r.json()["ativo"] is None and r.json()["configurado"] is False
    assert "board_id" not in corpo and "api_key" not in corpo
    assert SEGREDO_CLIENTE not in r.text and SEGREDO_WEBHOOK not in r.text
    gravados = dict(await conn.fetch(
        "SELECT name, value FROM public.integration_secrets WHERE name = ANY($1::text[])",
        list(SEGREDOS)))
    assert gravados == {growthhs.segredo_cliente(AMB): SEGREDO_CLIENTE,
                        growthhs.segredo_webhook(AMB): SEGREDO_WEBHOOK}

    # Só o endereço do app: o resto fica (inclusive os segredos).
    r = await cliente.put(ROTA_AMB, headers=_auth(token_admin),
                          json={"app_url": "https://app.exemplo.invalid"})
    corpo = _amb(r)
    assert corpo["app_url"] == "https://app.exemplo.invalid"
    assert corpo["client_id"] == "hsg_cliente" and corpo["list_id"] == 22
    assert corpo["boards_conferidos"] == [6, 7] and corpo["listas_ganho"] == [32, 33]
    assert corpo["client_secret"]["configurado"] and corpo["webhook_secret"]["configurado"]

    # String vazia é "não mexi", não "apague".
    r = await cliente.put(ROTA_AMB, headers=_auth(token_admin),
                          json={"client_secret": "   ", "webhook_secret": ""})
    assert r.status_code == 200, r.text
    assert _amb(r)["client_secret"]["configurado"] is True

    r = await cliente.put(ROTA_AMB, headers=_auth(token_admin),
                          json={"limpar": ["client_secret", "webhook_secret"]})
    assert r.status_code == 200, r.text
    assert _amb(r)["client_secret"] == {"configurado": False, "ultimos4": None}
    assert _amb(r)["webhook_secret"] == {"configurado": False}
    assert _amb(r)["completo"] is False


async def test_limpar_campo_desconhecido_e_400(cliente, banco_growthhs, token_admin,
                                              monkeypatch):
    await _zerar(banco_growthhs, monkeypatch)
    r = await cliente.put(ROTA_AMB, headers=_auth(token_admin), json={"limpar": ["api_key"]})
    assert r.status_code == 400


@pytest.mark.parametrize("corpo", [
    {"base_url": "growthhs.exemplo.invalid"},
    {"app_url": "ftp://app.exemplo.invalid"},
    {"base_url": "ftp://growthhs.exemplo.invalid"},
    {"base_url": "https://"},
    {"base_url": "https://u:p@growthhs.exemplo.invalid"},
    {"base_url": "https://u@growthhs.exemplo.invalid"},
    {"app_url": "https://app.exemplo.invalid/#/x"},
    {"base_url": "https://growthhs.exemplo.invalid/a b"},
    # Revisão final (M5): query string e porta inválida.
    {"base_url": "https://growthhs.exemplo.invalid/?x=1"},
    {"app_url": "https://app.exemplo.invalid?"},
    {"base_url": "https://growthhs.exemplo.invalid:99999"},
    {"base_url": "https://growthhs.exemplo.invalid:porta"},
    # Revisão final (M4): a mesma lista como reunião e ganho.
    {"listas_reuniao": [28, 40], "listas_ganho": [40]},
    {"list_id": 0},
    {"boards_conferidos": [0]},
    {"boards_conferidos": [6, 6]},
    {"boards_conferidos": list(range(1, 12))},
    {"listas_reuniao": [-1]},
    {"listas_ganho": [32, 32]},
    {"listas_reuniao": list(range(1, 12))},
    # Vazia = o webhook ignoraria todo evento em silêncio.
    {"listas_reuniao": []},
    {"listas_ganho": []},
    {"webhook_secret": "curto-demais"},
    {"client_id": "x" * 201},
])
async def test_recusa_entradas_invalidas(cliente, token_admin, corpo):
    # 422 é do pydantic, antes da rota — nada chega ao banco.
    r = await cliente.put(ROTA_AMB, headers=_auth(token_admin), json=corpo)
    assert r.status_code == 422, (corpo, r.text)


async def test_mostra_urls_do_webhook(cliente, banco_growthhs, token_admin, monkeypatch):
    await _zerar(banco_growthhs, monkeypatch)
    monkeypatch.setattr(settings, "FRONTEND_URL", "https://mkt.exemplo.invalid/")
    r = await cliente.get(ROTA, headers=_auth(token_admin))
    assert r.status_code == 200, r.text
    for amb in ("homologacao", "producao"):
        base = f"https://mkt.exemplo.invalid/api/publico/growthhs/webhook/{amb}?evento="
        assert _amb(r, amb)["webhook_urls"] == {
            "meeting_scheduled": base + "meeting_scheduled", "deal_won": base + "deal_won"}
        # Sem configuração: "Não configurado", com as listas padrão.
        assert _amb(r, amb)["completo"] is False and _amb(r, amb)["ativo"] is False
        assert _amb(r, amb)["listas_reuniao"] == [28]
        assert _amb(r, amb)["listas_ganho"] == [32]
    assert r.json()["ativo"] is None and r.json()["configurado"] is False


# ── Testar ──────────────────────────────────────────────────────────────────

async def test_testar_valido(cliente, banco_growthhs, token_admin, monkeypatch):
    await _configurar(banco_growthhs, monkeypatch)
    vistos = []

    async def falso(cfg, **_):
        vistos.append(cfg)

    monkeypatch.setattr(growthhs, "testar", falso)
    r = await cliente.post(f"{ROTA_AMB}/testar", headers=_auth(token_admin))
    assert r.status_code == 200, r.text
    assert r.json() == {"valido": True}
    # A config SALVA: é ela que a fila vai usar.
    assert vistos[0].client_id == "hsg_teste_cfg"
    assert vistos[0].client_secret == SEGREDO_CLIENTE


async def test_testar_recusado(cliente, banco_growthhs, token_admin, monkeypatch):
    await _configurar(banco_growthhs, monkeypatch)

    async def falso(cfg, **_):
        raise growthhs.ErroDefinitivo("401: " + "credencial inválida " * 40, 401)

    monkeypatch.setattr(growthhs, "testar", falso)
    r = await cliente.post(f"{ROTA_AMB}/testar", headers=_auth(token_admin))
    assert r.status_code == 200, r.text
    corpo = r.json()
    assert corpo["valido"] is False and corpo["status"] == 401
    assert corpo["detalhe"].startswith("401: credencial") and len(corpo["detalhe"]) <= 200
    assert SEGREDO_CLIENTE not in r.text


async def test_testar_fora_do_ar_e_502(cliente, banco_growthhs, token_admin, monkeypatch):
    await _configurar(banco_growthhs, monkeypatch)

    async def falso(cfg, **_):
        raise growthhs.ErroTransitorio("sem resposta do GrowthHS")

    monkeypatch.setattr(growthhs, "testar", falso)
    r = await cliente.post(f"{ROTA_AMB}/testar", headers=_auth(token_admin))
    assert r.status_code == 502


async def test_aceita_endereco_interno(cliente, banco_growthhs, token_admin, monkeypatch):
    """O nome interno do EasyPanel é legítimo — IP/host privado não se recusa."""
    await _zerar(banco_growthhs, monkeypatch)
    r = await cliente.put(ROTA_AMB, headers=_auth(token_admin),
                          json={"base_url": "http://erick_hsgrowth-api:8000",
                                # Boards vazio é aceito: só deixa `configurado` falso.
                                "boards_conferidos": []})
    assert r.status_code == 200, r.text
    assert _amb(r)["base_url"] == "http://erick_hsgrowth-api:8000"
    assert _amb(r)["boards_conferidos"] == [] and _amb(r)["completo"] is False


# ⚠️ Segurança (achado da coordenadora): o `base_url` aponta para onde o admin
# quiser, inclusive endereço interno. Se o corpo da resposta voltasse no
# "Testar" (ou em `crm_handoffs.erro`, que esta tela mostra), a integração
# seria um leitor de URL interna.
CORPOS_SECRETOS = [
    (404, {"content": b"<html>segredo-interno</html>",
           "headers": {"content-type": "text/html"}}, "segredo-interno",
     "404: endereço não parece a API do GrowthHS"),
    (500, {"text": "token=abc"}, "token=abc", "500: GrowthHS fora do ar ou ocupado"),
    (422, {"content": b"<pre>DATABASE_URL=postgres://x</pre>"}, "DATABASE_URL",
     "422: o GrowthHS recusou os dados do contato"),
]


def _transporte(status, kw):
    return httpx.MockTransport(lambda r: httpx.Response(status, **kw))


def _testar_com(monkeypatch, transporte):
    real = growthhs.testar

    async def com_transporte(cfg, **_):
        await real(cfg, transporte=transporte)

    monkeypatch.setattr(growthhs, "testar", com_transporte)


@pytest.mark.parametrize("status,kw,secreto,esperado", CORPOS_SECRETOS)
async def test_testar_nunca_ecoa_o_corpo(cliente, banco_growthhs, token_admin, monkeypatch,
                                         status, kw, secreto, esperado):
    await _configurar(banco_growthhs, monkeypatch, client_id=f"hsg_eco_{status}")
    growthhs.limpar_tokens()
    _testar_com(monkeypatch, _transporte(status, kw))
    r = await cliente.post(f"{ROTA_AMB}/testar", headers=_auth(token_admin))
    assert secreto not in r.text
    if status >= 500:
        assert r.status_code == 502 and r.json()["detail"] == esperado
    else:
        assert r.status_code == 200, r.text
        assert r.json() == {"valido": False, "status": status, "detalhe": esperado}


async def test_testar_mostra_o_detail_json_de_la(cliente, banco_growthhs, token_admin,
                                                 monkeypatch):
    await _configurar(banco_growthhs, monkeypatch, client_id="hsg_eco_json")
    growthhs.limpar_tokens()
    _testar_com(monkeypatch, _transporte(401, {"json": {"detail": "Credenciais\ninválidas"}}))
    r = await cliente.post(f"{ROTA_AMB}/testar", headers=_auth(token_admin))
    assert r.json()["detalhe"] == ("401: client_id ou client_secret recusados — "
                                   "Credenciais inválidas")


@pytest.mark.parametrize("status,kw,secreto,esperado", CORPOS_SECRETOS)
async def test_erro_da_fila_nunca_ecoa_o_corpo(cliente, banco_growthhs, token_admin,
                                               monkeypatch, status, kw, secreto, esperado):
    """404 e 422 (no token, que o transporte recusa primeiro) pausam, 500
    adia — nos três, o `erro` gravado (e o que o GET mostra) tem o status e a
    mensagem, nunca o corpo."""
    conn = banco_growthhs
    await _zerar(conn, monkeypatch)
    monkeypatch.setattr(entrega, "sessao", configuracao.sessao)
    lead = await _lead(conn, f"fila-eco-{status}@exemplo.invalid")
    await entrega.enfileirar(conn, lead, "manual")
    cfg = growthhs.Config(base_url="https://growthhs.exemplo.invalid",
                          client_id=f"hsg_fila_eco_{status}", client_secret="segredo-x",
                          list_id=22, boards_conferidos=(6,), app_url=None,
                          ambiente=AMB)
    growthhs.limpar_tokens()
    await entrega.rodar_entregas(somente_lead=lead, cfg=cfg, transporte=_transporte(status, kw))
    erro = await conn.fetchval(
        "SELECT erro FROM crm_handoffs WHERE lead_id = $1::uuid", lead)
    assert secreto not in erro and esperado in erro
    eventos = await conn.fetch(
        "SELECT metadata::text FROM contact_events WHERE lead_id = $1::uuid", lead)
    assert all(secreto not in e["metadata"] for e in eventos)
    r = await cliente.get(ROTA, headers=_auth(token_admin))
    assert secreto not in r.text


@pytest.mark.parametrize("falta", ["base_url", "client_id", "segredo"])
async def test_testar_sem_config_e_400(cliente, banco_growthhs, token_admin, monkeypatch,
                                       falta):
    await _configurar(banco_growthhs, monkeypatch, **{falta: None})

    async def nunca(cfg, **_):  # pragma: no cover — não pode ser chamado
        raise AssertionError("testou sem credencial completa")

    monkeypatch.setattr(growthhs, "testar", nunca)
    r = await cliente.post(f"{ROTA_AMB}/testar", headers=_auth(token_admin))
    assert r.status_code == 400, r.text


# ── Fila (pausa, falhas, reenfileirar) ──────────────────────────────────────

async def _lead(conn, email):
    return await conn.fetchval(
        "INSERT INTO leads (nome, email, tipo) VALUES ('Fila GrowthHS', $1, 'teste') "
        "RETURNING id::text", email)


async def test_mostra_a_fila_com_as_falhas(cliente, banco_growthhs, token_admin, monkeypatch):
    conn = banco_growthhs
    await _zerar(conn, monkeypatch)
    lead = await _lead(conn, "fila-real-a@exemplo.invalid")
    await conn.execute(
        "INSERT INTO crm_handoffs (lead_id, origem, status, erro) "
        "VALUES ($1::uuid, 'manual', 'falhou', '401: credencial inválida')", lead)
    fila = (await cliente.get(ROTA, headers=_auth(token_admin))).json()["fila"]
    assert fila["falhas"] >= 1
    assert any(f["lead_id"] == lead and f["erro"] == "401: credencial inválida"
               for f in fila["ultimas_falhas"])


async def test_credencial_errada_aparece_como_pausa(cliente, banco_growthhs, token_admin,
                                                   monkeypatch):
    conn = banco_growthhs
    await _zerar(conn, monkeypatch)
    # A entrega também precisa cair na transação revertida.
    monkeypatch.setattr(entrega, "sessao", configuracao.sessao)
    lead = await _lead(conn, "fila-real-b@exemplo.invalid")
    await entrega.enfileirar(conn, lead, "manual")
    cfg = growthhs.Config(base_url="https://growthhs.exemplo.invalid",
                          client_id="hsg_pausa_cfg", client_secret="segredo-errado",
                          list_id=22, boards_conferidos=(6,), app_url=None,
                          ambiente=AMB)
    await entrega.rodar_entregas(
        somente_lead=lead, cfg=cfg,
        transporte=httpx.MockTransport(
            lambda r: httpx.Response(401, json={"detail": "credencial inválida"})))
    fila = (await cliente.get(ROTA, headers=_auth(token_admin))).json()["fila"]
    assert fila["pausada"] is not None
    assert "401" in fila["pausada"]["motivo"] and fila["pausada"]["desde"]


async def test_falha_ja_resolvida_nao_conta(cliente, banco_growthhs, token_admin, monkeypatch):
    """Um pedido que falhou e depois foi entregue (reenfileirado, botão) não é
    falha — o painel não pode acusar o que já chegou ao comercial."""
    conn = banco_growthhs
    await _zerar(conn, monkeypatch)
    lead = await _lead(conn, "fila-real-c@exemplo.invalid")
    antes = (await cliente.get(ROTA, headers=_auth(token_admin))).json()["fila"]["falhas"]
    await conn.execute(
        "INSERT INTO crm_handoffs (lead_id, origem, status, erro) "
        "VALUES ($1::uuid, 'manual', 'falhou', '503: fora do ar')", lead)
    await conn.execute(
        "INSERT INTO crm_handoffs (lead_id, origem, status, card_id) "
        "VALUES ($1::uuid, 'manual', 'entregue', 4821)", lead)
    fila = (await cliente.get(ROTA, headers=_auth(token_admin))).json()["fila"]
    assert fila["falhas"] == antes
    assert all(f["lead_id"] != lead for f in fila["ultimas_falhas"])


async def test_reenfileirar_devolve_as_falhas_sem_entrega(cliente, banco_growthhs,
                                                         token_admin, monkeypatch):
    conn = banco_growthhs
    await _zerar(conn, monkeypatch)
    # ⚠️ A rota reenfileira a fila INTEIRA. Na transação revertida nada fica,
    # mas o UPDATE trancaria as linhas reais enquanto o teste roda e a contagem
    # incluiria as delas — com falha real na fila, o teste não roda.
    if await conn.fetchval("SELECT count(*) FROM crm_handoffs WHERE status = 'falhou'"):
        pytest.skip("há falhas reais na fila — o teste não tranca produção")
    primeiro = await _lead(conn, "fila-real-d@exemplo.invalid")
    segundo = await _lead(conn, "fila-real-e@exemplo.invalid")
    # O primeiro só falhou; o segundo falhou e depois chegou ao comercial.
    await conn.execute(
        "INSERT INTO crm_handoffs (lead_id, origem, status, erro, tentativas) "
        "VALUES ($1::uuid, 'manual', 'falhou', '422: corpo', 3)", primeiro)
    await conn.execute(
        "INSERT INTO crm_handoffs (lead_id, origem, status, erro) "
        "VALUES ($1::uuid, 'manual', 'falhou', '422: corpo')", segundo)
    await conn.execute(
        "INSERT INTO crm_handoffs (lead_id, origem, status, card_id) "
        "VALUES ($1::uuid, 'manual', 'entregue', 4821)", segundo)

    r = await cliente.post(f"{ROTA}/reenfileirar", headers=_auth(token_admin))
    assert r.status_code == 200, r.text
    assert r.json() == {"reenfileirados": 1}
    linha = await conn.fetchrow(
        "SELECT status, tentativas, erro, visivel_em <= now() AS visivel "
        "FROM crm_handoffs WHERE lead_id = $1::uuid", primeiro)
    pendentes_do_segundo = await conn.fetchval(
        "SELECT count(*) FROM crm_handoffs WHERE lead_id = $1::uuid AND status = 'pendente'",
        segundo)
    assert dict(linha) == {"status": "pendente", "tentativas": 0, "erro": None,
                           "visivel": True}
    assert pendentes_do_segundo == 0


async def test_reenfileirar_pega_a_falha_de_reconversao(cliente, banco_growthhs,
                                                       token_admin, monkeypatch):
    """Revisão final (I2): entregue em setembro, converteu de novo e o pedido
    novo falhou. O painel conta essa falha (`_FALHA_EM_ABERTO`); o botão
    tinha de pegá-la também — antes, QUALQUER `entregue` excluía o lead."""
    conn = banco_growthhs
    await _zerar(conn, monkeypatch)
    if await conn.fetchval("SELECT count(*) FROM crm_handoffs WHERE status = 'falhou'"):
        pytest.skip("há falhas reais na fila — o teste não tranca produção")
    lead = await _lead(conn, "fila-real-f@exemplo.invalid")
    await conn.execute(
        "INSERT INTO crm_handoffs (lead_id, origem, status, card_id) "
        "VALUES ($1::uuid, 'manual', 'entregue', 4821)", lead)
    falha = await conn.fetchval(
        "INSERT INTO crm_handoffs (lead_id, origem, status, erro) "
        "VALUES ($1::uuid, 'regra', 'falhou', '422: corpo') RETURNING id", lead)
    assert (await cliente.get(ROTA, headers=_auth(token_admin))).json()["fila"]["falhas"] == 1

    r = await cliente.post(f"{ROTA}/reenfileirar", headers=_auth(token_admin))
    assert r.json() == {"reenfileirados": 1}
    assert await conn.fetchval(
        "SELECT status FROM crm_handoffs WHERE id = $1", falha) == "pendente"


async def _config_com_listas(conn, monkeypatch):
    await _configurar(conn, monkeypatch)
    await conn.execute("UPDATE growthhs_config SET listas_reuniao = '{28}', "
                       "listas_ganho = '{32}'")


@pytest.mark.parametrize("corpo", [{"listas_ganho": [28]}, {"listas_reuniao": [32, 50]}])
async def test_lista_em_comum_com_a_salva_e_422(cliente, banco_growthhs, token_admin,
                                               monkeypatch, corpo):
    """Revisão final (M4): só uma das duas no PUT — a outra é a salva. A mesma
    lista como reunião e como ganho marcaria venda num card que só teve
    reunião. Nada é gravado."""
    conn = banco_growthhs
    await _config_com_listas(conn, monkeypatch)
    r = await cliente.put(ROTA_AMB, headers=_auth(token_admin),
                          json={**corpo, "client_id": "hsg_nao_gravado"})
    assert r.status_code == 422, r.text
    linha = await conn.fetchrow(
        "SELECT client_id, listas_reuniao, listas_ganho FROM growthhs_config")
    assert (linha["client_id"], linha["listas_reuniao"], linha["listas_ganho"]) == (
        "hsg_teste_cfg", [28], [32])


async def test_trocar_as_duas_listas_juntas_e_aceito(cliente, banco_growthhs, token_admin,
                                                    monkeypatch):
    """Inverter reunião e ganho num PUT só: o que vale é o par novo."""
    await _config_com_listas(banco_growthhs, monkeypatch)
    r = await cliente.put(ROTA_AMB, headers=_auth(token_admin),
                          json={"listas_reuniao": [32], "listas_ganho": [28]})
    assert r.status_code == 200, r.text
    assert _amb(r)["listas_reuniao"] == [32] and _amb(r)["listas_ganho"] == [28]


async def test_trocar_o_endereco_sem_secret_apaga_o_secret(cliente, banco_growthhs, token_admin,
                                                          monkeypatch):
    """O secret é só de escrita. Trocar o endereço e clicar "Testar" o
    mandaria ao endereço novo — então o endereço novo sem secret no mesmo
    pedido derruba o salvo. Mesmo endereço (até com barra no fim) não mexe."""
    conn = banco_growthhs
    await _configurar(conn, monkeypatch)

    r = await cliente.put(ROTA_AMB, headers=_auth(token_admin),
                          json={"base_url": "https://growthhs.exemplo.invalid/"})
    assert r.status_code == 200, r.text
    assert _amb(r)["client_secret"]["configurado"] is True

    r = await cliente.put(ROTA_AMB, headers=_auth(token_admin),
                          json={"base_url": "https://outro.exemplo.invalid"})
    assert r.status_code == 200, r.text
    assert _amb(r)["base_url"] == "https://outro.exemplo.invalid"
    assert _amb(r)["client_secret"]["configurado"] is False

    # Endereço novo COM o secret no mesmo pedido: fica.
    r = await cliente.put(ROTA_AMB, headers=_auth(token_admin), json={
        "base_url": "https://terceiro.exemplo.invalid", "client_secret": SEGREDO_CLIENTE})
    assert r.status_code == 200, r.text
    assert _amb(r)["client_secret"]["configurado"] is True


# ── Dois ambientes (migration 030) ──────────────────────────────────────────

COMPLETO = {"base_url": "https://g.exemplo.invalid", "client_id": "hsg_x",
            "client_secret": "segredo-completo-1234", "list_id": 22,
            "boards_conferidos": [6]}


async def test_gravar_um_ambiente_nao_mexe_no_outro(cliente, banco_growthhs, token_admin,
                                                    monkeypatch):
    await _zerar(banco_growthhs, monkeypatch)
    r = await cliente.put(f"{ROTA}/homologacao", headers=_auth(token_admin), json={
        **COMPLETO, "base_url": "https://homo.exemplo.invalid",
        "webhook_secret": SEGREDO_WEBHOOK})
    assert r.status_code == 200, r.text
    r = await cliente.put(f"{ROTA}/producao", headers=_auth(token_admin), json={
        **COMPLETO, "base_url": "https://prod.exemplo.invalid", "client_id": "hsg_prod",
        "client_secret": "segredo-da-producao-9876"})
    assert r.status_code == 200, r.text
    homo, prod = _amb(r, "homologacao"), _amb(r, "producao")
    assert (homo["base_url"], homo["client_id"]) == ("https://homo.exemplo.invalid", "hsg_x")
    assert (prod["base_url"], prod["client_id"]) == ("https://prod.exemplo.invalid", "hsg_prod")
    assert homo["client_secret"]["ultimos4"] == "1234"
    assert prod["client_secret"]["ultimos4"] == "9876"
    assert homo["webhook_secret"]["configurado"] is True
    assert prod["webhook_secret"]["configurado"] is False
    assert homo["completo"] and prod["completo"]

    # Limpar o segredo da produção não apaga o da homologação.
    r = await cliente.put(f"{ROTA}/producao", headers=_auth(token_admin),
                          json={"limpar": ["client_secret"]})
    assert _amb(r, "producao")["client_secret"]["configurado"] is False
    assert _amb(r, "homologacao")["client_secret"]["configurado"] is True


async def test_trocar_endereco_apaga_so_o_secret_daquele_ambiente(cliente, banco_growthhs,
                                                                 token_admin, monkeypatch):
    await _zerar(banco_growthhs, monkeypatch)
    for amb in ("homologacao", "producao"):
        await cliente.put(f"{ROTA}/{amb}", headers=_auth(token_admin), json=COMPLETO)
    r = await cliente.put(f"{ROTA}/producao", headers=_auth(token_admin),
                          json={"base_url": "https://outro.exemplo.invalid"})
    assert _amb(r, "producao")["client_secret"]["configurado"] is False
    assert _amb(r, "homologacao")["client_secret"]["configurado"] is True


async def test_ativar_incompleto_e_400_e_nao_troca(cliente, banco_growthhs, token_admin,
                                                    monkeypatch):
    await _zerar(banco_growthhs, monkeypatch)
    await cliente.put(f"{ROTA}/homologacao", headers=_auth(token_admin), json=COMPLETO)
    r = await cliente.post(f"{ROTA}/ativar", headers=_auth(token_admin),
                           json={"ambiente": "homologacao"})
    assert r.status_code == 200, r.text
    # Produção só com endereço: recusada, dizendo o que falta.
    await cliente.put(f"{ROTA}/producao", headers=_auth(token_admin),
                      json={"base_url": "https://prod.exemplo.invalid"})
    r = await cliente.post(f"{ROTA}/ativar", headers=_auth(token_admin),
                           json={"ambiente": "producao"})
    assert r.status_code == 400, r.text
    assert "Client ID" in r.json()["detail"] and "lista de entrada" in r.json()["detail"]
    # Sem linha nenhuma, também 400 (não 500).
    await banco_growthhs.execute("DELETE FROM growthhs_config WHERE ambiente = 'producao'")
    r = await cliente.post(f"{ROTA}/ativar", headers=_auth(token_admin),
                           json={"ambiente": "producao"})
    assert r.status_code == 400, r.text
    assert (await growthhs.ler_config()).ambiente == "homologacao"


async def test_ativar_troca_e_so_um_fica_ativo(cliente, banco_growthhs, token_admin,
                                               monkeypatch):
    conn = banco_growthhs
    await _zerar(conn, monkeypatch)
    for amb in ("homologacao", "producao"):
        await cliente.put(f"{ROTA}/{amb}", headers=_auth(token_admin), json=COMPLETO)
    r = await cliente.post(f"{ROTA}/ativar", headers=_auth(token_admin),
                           json={"ambiente": "homologacao"})
    assert r.json()["ativo"] == "homologacao" and r.json()["configurado"] is True
    assert _amb(r, "homologacao")["ativo"] and not _amb(r, "producao")["ativo"]
    r = await cliente.post(f"{ROTA}/ativar", headers=_auth(token_admin),
                           json={"ambiente": "producao"})
    assert r.status_code == 200, r.text
    assert r.json()["ativo"] == "producao"
    assert not _amb(r, "homologacao")["ativo"] and _amb(r, "producao")["ativo"]
    assert await conn.fetchval("SELECT count(*) FROM growthhs_config WHERE ativo") == 1
    # Ativar o que já está ativo não quebra.
    r = await cliente.post(f"{ROTA}/ativar", headers=_auth(token_admin),
                           json={"ambiente": "producao"})
    assert r.status_code == 200 and r.json()["ativo"] == "producao"
    assert (await growthhs.ler_config()).ambiente == "producao"


async def test_ativo_que_perde_o_secret_continua_ativo_e_a_fila_espera(
        cliente, banco_growthhs, token_admin, monkeypatch):
    await _zerar(banco_growthhs, monkeypatch)
    await cliente.put(f"{ROTA}/producao", headers=_auth(token_admin), json=COMPLETO)
    await cliente.post(f"{ROTA}/ativar", headers=_auth(token_admin),
                       json={"ambiente": "producao"})
    r = await cliente.put(f"{ROTA}/producao", headers=_auth(token_admin),
                          json={"base_url": "https://novo.exemplo.invalid"})
    assert r.json()["ativo"] == "producao" and r.json()["configurado"] is False
    assert _amb(r, "producao")["faltando"] == ["Client secret"]
    assert (await growthhs.ler_config()).configurado is False


async def test_testar_usa_o_ambiente_do_caminho(cliente, banco_growthhs, token_admin,
                                                monkeypatch):
    await _zerar(banco_growthhs, monkeypatch)
    await cliente.put(f"{ROTA}/homologacao", headers=_auth(token_admin), json=COMPLETO)
    await cliente.put(f"{ROTA}/producao", headers=_auth(token_admin), json={
        **COMPLETO, "client_id": "hsg_prod", "client_secret": "segredo-da-producao-9876"})
    vistos = []

    async def falso(cfg, **_):
        vistos.append(cfg)

    monkeypatch.setattr(growthhs, "testar", falso)
    r = await cliente.post(f"{ROTA}/producao/testar", headers=_auth(token_admin))
    assert r.status_code == 200 and r.json() == {"valido": True}
    assert (vistos[0].ambiente, vistos[0].client_id, vistos[0].client_secret) == (
        "producao", "hsg_prod", "segredo-da-producao-9876")


@pytest.mark.parametrize("metodo,rota,corpo", [
    ("PUT", f"{ROTA}/teste", {"list_id": 1}),
    ("POST", f"{ROTA}/teste/testar", None),
    ("POST", f"{ROTA}/ativar", {"ambiente": "teste"}),
])
async def test_ambiente_desconhecido_e_404(cliente, banco_growthhs, token_admin, monkeypatch,
                                           metodo, rota, corpo):
    await _zerar(banco_growthhs, monkeypatch)
    r = await cliente.request(metodo, rota, json=corpo, headers=_auth(token_admin))
    assert r.status_code == 404, r.text
    assert await banco_growthhs.fetchval("SELECT count(*) FROM growthhs_config") == 0


async def test_ativar_solta_a_pausa_do_ambiente_anterior(cliente, banco_growthhs, token_admin,
                                                         monkeypatch):
    """A pausa (401/403/404) era do GrowthHS de antes: trocando de ambiente,
    os pedidos pausados tentam na hora e a faixa "Fila pausada" some."""
    conn = banco_growthhs
    await _zerar(conn, monkeypatch)
    lead = await _lead(conn, "fila-pausa-troca@exemplo.invalid")
    await conn.execute(
        "INSERT INTO crm_handoffs (lead_id, origem, status, erro, visivel_em) "
        "VALUES ($1::uuid, 'manual', 'pendente', $2, now() + interval '10 minutes')",
        lead, f"{entrega.PREFIXO_PAUSA} — o GrowthHS respondeu 401")
    await cliente.put(f"{ROTA}/producao", headers=_auth(token_admin), json=COMPLETO)
    r = await cliente.post(f"{ROTA}/ativar", headers=_auth(token_admin),
                           json={"ambiente": "producao"})
    assert r.status_code == 200, r.text
    assert r.json()["fila"]["pausada"] is None
    linha = await conn.fetchrow(
        "SELECT erro, visivel_em <= now() AS visivel FROM crm_handoffs "
        "WHERE lead_id = $1::uuid", lead)
    assert (linha["erro"], linha["visivel"]) == (None, True)
