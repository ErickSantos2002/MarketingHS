"""Nós "avisar por e-mail" e "enviar para webhook" (prova do RD, Tarefa 8).

Os dois nós não mandam nada na hora: gravam uma linha em `journey_saidas` (uma
por run e nó — `uniq_journey_saidas_run_node`), e um laço próprio do worker
drena (`saidas.rodar_saidas`). Nenhum teste fala com a rede: o Resend é
trocado por um falso e o webhook vai para `httpx.MockTransport`.

⚠️ Os testes de `rodar_saidas` gravam FORA da transação revertida (o laço
abre as próprias sessões): a fixture `saida` insere com `sessao()`, só
reivindica as linhas dela (`somente=`) e apaga por id no fim. Linha real de
produção nunca é reivindicada por um teste.

Tudo depende da 027 (`journey_saidas`); sem ela, pula com o motivo.
"""

import json

import httpx
import pytest
import pytest_asyncio

import app.database as db
from app import ritmo
from app.config import settings
from app.jornadas import executor, saidas

pytestmark = pytest.mark.trava_global

IP_PUBLICO = "93.184.216.34"


@pytest.fixture(autouse=True)
def dns_publico(monkeypatch):
    """Nenhum teste resolve nome de verdade: todo host vira um IP público
    (o teste de SSRF troca isto para mostrar a recusa)."""
    resolvidos = {}

    async def resolver(host, porta):
        return resolvidos.get(host, [IP_PUBLICO])
    monkeypatch.setattr(saidas, "_resolver", resolver)
    return resolvidos


async def _exigir_027(conn):
    if not await conn.fetchval("SELECT to_regclass('public.journey_saidas') IS NOT NULL"):
        pytest.skip("migration 027 ainda não aplicada neste banco")


# ── Montagem (sem banco) ─────────────────────────────────────────────────────

LEAD = {"id": "00000000-0000-0000-0000-00000000aa01", "nome": "Maria Souza",
        "email": "maria@cliente.invalid", "whatsapp": "+5531999999999",
        "empresa": "Mineradora X", "cargo": "Compras",
        "campos_extras": {"mensagem": "Quero 3 etilômetros", "ja_faz_testagem": "sim"},
        "tags": ["prova-rd"]}
CONVERSAO = {"page_slug": "phoebus-prova", "form_id": "prova_cap_phoebus",
             "page_url": "https://www.healthsafety.com.br/phoebus", "canal": "organico"}


def test_aviso_tem_link_da_ficha_e_dados():
    url = f"{settings.FRONTEND_URL}/contacts?contato={LEAD['id']}"
    assunto, html = saidas.montar_aviso(LEAD, CONVERSAO, url)
    assert assunto == "[MarketingHS] Novo lead: Maria Souza — Mineradora X"
    for trecho in ("Maria Souza", "maria@cliente.invalid", "+5531999999999",
                   "Mineradora X", "phoebus-prova", "prova_cap_phoebus",
                   "Quero 3 etilômetros", "ja_faz_testagem", "sim", url):
        assert trecho in html


def test_aviso_assunto_configurado_vence():
    assunto, _ = saidas.montar_aviso(LEAD, None, "http://x", "Lead da prova")
    assert assunto == "Lead da prova"


def test_aviso_escapa_html_do_lead():
    lead = {**LEAD, "nome": "<script>x</script>", "empresa": "A&B",
            "campos_extras": {"mensagem": "<img src=x onerror=alert(1)>",
                              "<b>chave</b>": "<i>v</i>"}}
    _, html = saidas.montar_aviso(lead, {"page_slug": "<p>"}, "http://x/?a=1&b=2")
    assert "<script>" not in html and "&lt;script&gt;" in html
    assert "<img" not in html and "<b>chave" not in html and "<i>v" not in html
    assert "A&amp;B" in html
    assert "&lt;p&gt;" in html


def test_aviso_sem_conversao_nem_extras():
    lead = {"id": "x", "nome": None, "email": "a@b.invalid", "campos_extras": {}}
    assunto, html = saidas.montar_aviso(lead, None, "http://x")
    assert "a@b.invalid" in assunto
    assert "a@b.invalid" in html


def test_webhook_payload():
    run = {"run_id": "r1", "journey_id": "j1", "lead_id": LEAD["id"]}
    corpo = saidas.montar_webhook(LEAD, CONVERSAO, run, {"id": "n7"})
    assert corpo["evento"] == "journey.webhook"
    assert (corpo["journey_id"], corpo["run_id"], corpo["node_id"]) == ("j1", "r1", "n7")
    assert corpo["lead"]["email"] == "maria@cliente.invalid"
    assert corpo["lead"]["campos_extras"]["mensagem"] == "Quero 3 etilômetros"
    assert corpo["conversao"]["form_id"] == "prova_cap_phoebus"
    assert corpo["gerado_em"]
    json.dumps(corpo)  # serializável


@pytest.mark.parametrize("t,minutos", [(1, 1), (2, 2), (3, 4), (7, 60), (20, 60)])
def test_espera_dobra_ate_uma_hora(t, minutos):
    assert saidas.espera(t).total_seconds() == minutos * 60


# ── O nó no executor (transação revertida) ───────────────────────────────────

async def _jornada_e_run(conexao, email="aviso@exemplo.invalid"):
    lead = await conexao.fetchval(
        "INSERT INTO leads (nome, email, empresa, tipo, campos_extras) "
        "VALUES ('Lead Aviso', $1, 'Empresa Aviso', 'teste', $2::jsonb) RETURNING id::text",
        email, {"mensagem": "olá"})
    nos = [{"id": "n1", "type": "notify_email",
            "config": {"emails": ["comercial@exemplo.invalid"]}, "next": "n2"},
           {"id": "n2", "type": "webhook",
            "config": {"url": "https://exemplo.invalid/gancho"}, "next": None}]
    jornada = await conexao.fetchval(
        """INSERT INTO journeys (name, status, entry_type, entry_config, entry_node_id, nodes)
           VALUES ('prova-saidas', 'active', 'event', '{"event_type": "form_submitted",
                   "page_slug": "prova-saidas"}', 'n1', $1::jsonb) RETURNING id::text""",
        nos)
    linha = await conexao.fetchrow(
        "INSERT INTO journey_runs (journey_id, lead_id, state, current_node_id, lock_token, "
        "locked_until) VALUES ($1::uuid, $2::uuid, 'active', 'n1', gen_random_uuid(), "
        "now() + interval '5 minutes') RETURNING id::text, lock_token::text", jornada, lead)
    run = {"run_id": linha["id"], "journey_id": jornada, "lead_id": lead,
           "current_node_id": "n1", "state": "active", "waiting_event": None,
           "context": {}, "lock_token": linha["lock_token"], "nodes": nos}
    return run, nos


async def _saidas_do_run(conexao, run):
    return [dict(l) for l in await conexao.fetch(
        "SELECT * FROM journey_saidas WHERE journey_run_id = $1::uuid ORDER BY id",
        run["run_id"])]


async def test_notify_email_enfileira_uma_vez_por_run_e_no(conexao):
    await _exigir_027(conexao)
    run, nos = await _jornada_e_run(conexao)

    for _ in range(2):
        saida = await executor.executar_no(conexao, run, nos[0])
        assert saida == {"tipo": "avancar", "proximo": "n2"}

    [linha] = await _saidas_do_run(conexao, run)
    assert (linha["tipo"], linha["destino"], linha["status"]) == (
        "aviso_email", "comercial@exemplo.invalid", "pendente")
    assert linha["lead_id"] is not None and str(linha["journey_id"]) == run["journey_id"]
    payload = linha["payload"]
    assert "Lead Aviso" in payload["assunto"]
    assert f"/contacts?contato={run['lead_id']}" in payload["html"]
    assert "olá" in payload["texto"]


async def test_rodar_cadeia_com_os_dois_nos(conexao):
    await _exigir_027(conexao)
    run, _ = await _jornada_e_run(conexao)
    await executor.rodar_cadeia(conexao, run)
    linhas = await _saidas_do_run(conexao, run)
    assert [l["tipo"] for l in linhas] == ["aviso_email", "webhook"]
    assert linhas[1]["destino"] == "https://exemplo.invalid/gancho"
    assert linhas[1]["payload"]["evento"] == "journey.webhook"
    assert await conexao.fetchval(
        "SELECT state FROM journey_runs WHERE id = $1::uuid", run["run_id"]) == "done"


@pytest.mark.parametrize("url", ["http://exemplo.invalid", "", "ftp://x", "javascript:x"])
async def test_webhook_sem_https_e_erro_definitivo(conexao, url):
    await _exigir_027(conexao)
    run, _ = await _jornada_e_run(conexao)
    no = {"id": "n2", "type": "webhook", "config": {"url": url}, "next": None}
    with pytest.raises(executor.ErroDefinitivo):
        await executor.executar_no(conexao, run, no)
    assert await _saidas_do_run(conexao, run) == []


async def test_notify_email_sem_emails_e_erro_definitivo(conexao):
    await _exigir_027(conexao)
    run, _ = await _jornada_e_run(conexao)
    no = {"id": "n1", "type": "notify_email", "config": {"emails": ["  "]}, "next": None}
    with pytest.raises(executor.ErroDefinitivo):
        await executor.executar_no(conexao, run, no)


async def test_aviso_conta_no_teto(conexao):
    await _exigir_027(conexao)
    antes = await ritmo.medir(conexao)
    await conexao.execute(
        "INSERT INTO journey_saidas (journey_run_id, journey_node_id, tipo, destino, payload, "
        "status, resend_email_id, enviado_em) VALUES (gen_random_uuid(), 'n1', 'aviso_email', "
        "'a@exemplo.invalid', '{}'::jsonb, 'enviado', 're_teste_saida', now())")
    # Webhook não passa pelo Resend: não conta.
    await conexao.execute(
        "INSERT INTO journey_saidas (journey_run_id, journey_node_id, tipo, destino, payload, "
        "status, enviado_em) VALUES (gen_random_uuid(), 'n1', 'webhook', "
        "'https://exemplo.invalid', '{}'::jsonb, 'enviado', now())")
    depois = await ritmo.medir(conexao)
    assert depois.enviados_hora == antes.enviados_hora + 1
    assert depois.enviados_dia == antes.enviados_dia + 1


async def test_aviso_para_dois_conta_dois(conexao):
    await _exigir_027(conexao)
    antes = await ritmo.medir(conexao)
    await conexao.execute(
        "INSERT INTO journey_saidas (journey_run_id, journey_node_id, tipo, destino, payload, "
        "status, resend_email_id, enviado_em) VALUES (gen_random_uuid(), 'n1', 'aviso_email', "
        "'a@exemplo.invalid,b@exemplo.invalid', '{}'::jsonb, 'enviado', 're_1,re_2', now())")
    assert (await ritmo.medir(conexao)).enviados_dia == antes.enviados_dia + 2


# ── O laço (grava fora de `conexao`; limpa por id) ───────────────────────────

@pytest_asyncio.fixture
async def saida():
    await db.init_db()
    if db._pool is None:
        pytest.skip("sem DATABASE_URL")
    async with db.sessao(role="service_role") as conn:
        await _exigir_027(conn)
    ids = []

    async def criar(tipo, destino, payload=None, **colunas):
        nomes = ["journey_run_id", "journey_node_id", "tipo", "destino", "payload", *colunas]
        marcas = ["gen_random_uuid()", "'n1'", "$1", "$2", "$3::jsonb"] + [
            f"${i}" for i in range(4, 4 + len(colunas))]
        async with db.sessao(role="service_role") as conn:
            novo = await conn.fetchval(
                f"INSERT INTO journey_saidas ({', '.join(nomes)}) "
                f"VALUES ({', '.join(marcas)}) RETURNING id",
                tipo, destino, payload or {"assunto": "Oi", "html": "<p>x</p>", "texto": "x"},
                *colunas.values())
        ids.append(novo)
        return novo

    yield criar
    async with db.sessao(role="service_role") as conn:
        await conn.execute("DELETE FROM journey_saidas WHERE id = ANY($1::bigint[])", ids)
    await db.close_db()


async def _linha(saida_id):
    async with db.sessao(role="service_role") as conn:
        return dict(await conn.fetchrow("SELECT * FROM journey_saidas WHERE id = $1", saida_id))


def _transporte(status, chamadas):
    def responder(pedido):
        chamadas.append(pedido)
        return httpx.Response(status, json={"ok": status < 300})
    return httpx.MockTransport(responder)


@pytest.fixture
def resend_falso(monkeypatch):
    """Resend com chave falsa; `enviados` guarda quem receberia."""
    estado = {"enviados": [], "levantar": None}

    async def segredo(nome):
        return {"RESEND_API_KEY": "re_falsa", "EMAIL_FROM": "MHS <a@exemplo.invalid>"}.get(nome)

    async def enviar(**kw):
        if estado["levantar"] is not None:
            raise estado["levantar"]
        estado["enviados"].append(kw)
        return f"re_teste_{len(estado['enviados'])}"
    monkeypatch.setattr(saidas.integracoes, "ler_segredo", segredo)
    monkeypatch.setattr(saidas.resend, "enviar", enviar)
    return estado


async def test_webhook_2xx_marca_enviado(saida):
    sid = await saida("webhook", "https://exemplo.invalid/gancho", {"evento": "journey.webhook"})
    chamadas = []
    r = await saidas.rodar_saidas(transporte=_transporte(204, chamadas), somente=[sid])
    assert r["enviados"] == 1
    assert len(chamadas) == 1
    assert str(chamadas[0].url) == f"https://{IP_PUBLICO}/gancho"
    assert chamadas[0].headers["host"] == "exemplo.invalid"
    assert json.loads(chamadas[0].content) == {"evento": "journey.webhook"}
    linha = await _linha(sid)
    assert linha["status"] == "enviado" and linha["enviado_em"] is not None


async def test_webhook_5xx_reagenda_e_4xx_falha(saida):
    s5 = await saida("webhook", "https://exemplo.invalid/a")
    r = await saidas.rodar_saidas(transporte=_transporte(503, []), somente=[s5])
    assert r["reagendados"] == 1
    linha = await _linha(s5)
    assert linha["status"] == "pendente" and linha["tentativas"] == 1
    assert "503" in linha["erro"]

    s4 = await saida("webhook", "https://exemplo.invalid/b")
    r = await saidas.rodar_saidas(transporte=_transporte(400, []), somente=[s4])
    assert r["falhos"] == 1
    assert (await _linha(s4))["status"] == "falhou"

    s3 = await saida("webhook", "https://exemplo.invalid/d")
    r = await saidas.rodar_saidas(transporte=_transporte(302, []), somente=[s3])
    assert r["falhos"] == 1  # redirecionamento não é seguido nem re-tentado

    for status in (408, 429):
        sx = await saida("webhook", "https://exemplo.invalid/c")
        r = await saidas.rodar_saidas(transporte=_transporte(status, []), somente=[sx])
        assert r["reagendados"] == 1, status


async def test_webhook_sem_resposta_reagenda(saida):
    sid = await saida("webhook", "https://exemplo.invalid/a")

    def cair(pedido):
        raise httpx.ConnectError("fora do ar", request=pedido)
    r = await saidas.rodar_saidas(transporte=httpx.MockTransport(cair), somente=[sid])
    assert r["reagendados"] == 1


async def test_webhook_desiste_na_quinta(saida):
    sid = await saida("webhook", "https://exemplo.invalid/a", tentativas=4)
    r = await saidas.rodar_saidas(transporte=_transporte(500, []), somente=[sid])
    assert r["falhos"] == 1
    linha = await _linha(sid)
    assert linha["status"] == "falhou" and linha["tentativas"] == 5


async def test_webhook_sem_https_na_saida_falha_sem_chamar(saida):
    sid = await saida("webhook", "http://exemplo.invalid/a")
    chamadas = []
    r = await saidas.rodar_saidas(transporte=_transporte(200, chamadas), somente=[sid])
    assert r["falhos"] == 1 and chamadas == []


async def test_saida_reivindicada_nao_volta_antes_do_prazo(saida):
    sid = await saida("webhook", "https://exemplo.invalid/a")
    async with db.sessao(role="service_role") as conn:
        pegas = await saidas.reivindicar(conn, "webhook", 10, somente=[sid])
        assert [p["id"] for p in pegas] == [sid]
    async with db.sessao(role="service_role") as conn:
        assert await saidas.reivindicar(conn, "webhook", 10, somente=[sid]) == []
    linha = await _linha(sid)
    assert linha["tentativas"] == 1
    async with db.sessao(role="service_role") as conn:
        segundos = await conn.fetchval(
            "SELECT extract(epoch FROM visivel_em - now()) FROM journey_saidas WHERE id = $1", sid)
    assert 240 < segundos <= 300


async def test_aviso_sai_pelo_resend_sem_descadastro(saida, resend_falso):
    sid = await saida("aviso_email", "comercial@exemplo.invalid,outro@exemplo.invalid")
    r = await saidas.rodar_saidas(somente=[sid])
    assert r["enviados"] == 1
    assert [e["para"] for e in resend_falso["enviados"]] == [
        "comercial@exemplo.invalid", "outro@exemplo.invalid"]
    assert all(e["cabecalhos"] == {} for e in resend_falso["enviados"])
    assert resend_falso["enviados"][0]["assunto"] == "Oi"
    linha = await _linha(sid)
    assert linha["status"] == "enviado"
    assert linha["resend_email_id"] == "re_teste_1,re_teste_2"


async def test_aviso_nao_sai_com_cota_zero(saida, resend_falso, monkeypatch):
    monkeypatch.setattr(saidas.ritmo, "cota", lambda *a, **k: 0)
    sid = await saida("aviso_email", "comercial@exemplo.invalid")
    r = await saidas.rodar_saidas(somente=[sid])
    assert r["enviados"] == 0 and resend_falso["enviados"] == []
    linha = await _linha(sid)
    assert linha["status"] == "pendente" and linha["tentativas"] == 0


async def test_aviso_sem_chave_do_resend_nao_reivindica(saida, monkeypatch):
    async def sem(nome):
        return None
    monkeypatch.setattr(saidas.integracoes, "ler_segredo", sem)
    sid = await saida("aviso_email", "comercial@exemplo.invalid")
    await saidas.rodar_saidas(somente=[sid])
    assert (await _linha(sid))["tentativas"] == 0


async def test_aviso_429_devolve_sem_gastar_tentativa(saida, resend_falso):
    from app.email import resend
    resend_falso["levantar"] = resend.LimiteDoResend(30)
    sid = await saida("aviso_email", "comercial@exemplo.invalid")
    r = await saidas.rodar_saidas(somente=[sid])
    assert r["enviados"] == 0
    linha = await _linha(sid)
    assert linha["status"] == "pendente" and linha["tentativas"] == 0


async def test_aviso_retomado_nao_reenvia_a_quem_ja_recebeu(saida, resend_falso):
    """Dois destinatários, o segundo falha: na volta, só o segundo recebe."""
    sid = await saida("aviso_email", "a@exemplo.invalid,b@exemplo.invalid")
    original = saidas.resend.enviar
    vezes = {"n": 0}

    async def segundo_falha(**kw):
        vezes["n"] += 1
        if vezes["n"] == 2:
            raise httpx.ConnectError("caiu")
        return await original(**kw)
    saidas.resend.enviar = segundo_falha
    r = await saidas.rodar_saidas(somente=[sid])
    assert r["reagendados"] == 1
    async with db.sessao(role="service_role") as conn:
        await conn.execute("UPDATE journey_saidas SET visivel_em = now() WHERE id = $1", sid)
    saidas.resend.enviar = original
    r = await saidas.rodar_saidas(somente=[sid])
    assert r["enviados"] == 1
    assert [e["para"] for e in resend_falso["enviados"]] == [
        "a@exemplo.invalid", "b@exemplo.invalid"]
    assert (await _linha(sid))["resend_email_id"] == "re_teste_1,re_teste_2"


# ── SSRF: o webhook nunca chama a rede interna ───────────────────────────────

@pytest.mark.parametrize("url", [
    "http://exemplo.com/gancho",            # sem https
    "https://127.0.0.1/x", "https://localhost/x", "https://api.localhost/x",
    "https://10.0.0.5/x", "https://192.168.1.10/x", "https://172.16.0.1/x",
    "https://169.254.169.254/latest/meta-data", "https://[::1]/x",
    "https://[fd00::1]/x", "https://100.64.0.1/x", "https://0.0.0.0/x",
    "https://224.0.0.1/x", "https://[::ffff:127.0.0.1]/x",
    "https://marketinghs-api/x",            # nome de serviço interno, sem ponto
    "https://usuario:senha@exemplo.com/x",  # credencial na URL
    "https:///sem-host", "", "javascript:alert(1)",
])
def test_forma_da_url_recusada(url):
    with pytest.raises(saidas.DestinoRecusado):
        saidas.conferir_forma_da_url(url)


def test_forma_da_url_publica_passa():
    assert saidas.conferir_forma_da_url("https://gancho.exemplo.com:8443/a?b=1") == (
        "gancho.exemplo.com", 8443)


@pytest.mark.parametrize("ips", [["10.1.2.3"], ["127.0.0.1"], ["169.254.169.254"],
                                 ["::1"], [IP_PUBLICO, "192.168.0.9"], []])
async def test_nome_que_resolve_para_dentro_e_recusado(dns_publico, ips):
    dns_publico["interno.exemplo.com"] = ips
    with pytest.raises(saidas.DestinoRecusado):
        await saidas.conferir_destino("https://interno.exemplo.com/x")


async def test_nome_publico_passa(dns_publico):
    await saidas.conferir_destino("https://gancho.exemplo.com/x")


async def test_webhook_para_dentro_falha_sem_chamar_e_sem_nova_tentativa(saida, dns_publico):
    dns_publico["rebind.exemplo.com"] = ["10.0.0.7"]
    ids = [await saida("webhook", "https://rebind.exemplo.com/x"),
           await saida("webhook", "https://169.254.169.254/latest/meta-data"),
           await saida("webhook", "https://marketinghs-api/x")]
    chamadas = []
    r = await saidas.rodar_saidas(transporte=_transporte(200, chamadas), somente=ids)
    assert r["falhos"] == 3 and chamadas == []
    for sid in ids:
        linha = await _linha(sid)
        assert linha["status"] == "falhou" and "recusado" in linha["erro"]


async def test_dns_fora_do_ar_reagenda(saida, monkeypatch):
    import socket

    async def cair(host, porta):
        raise socket.gaierror("sem DNS")
    monkeypatch.setattr(saidas, "_resolver", cair)
    sid = await saida("webhook", "https://gancho.exemplo.com/x")
    r = await saidas.rodar_saidas(transporte=_transporte(200, []), somente=[sid])
    assert r["reagendados"] == 1


async def test_no_webhook_para_dentro_e_erro_definitivo(conexao):
    await _exigir_027(conexao)
    run, _ = await _jornada_e_run(conexao)
    no = {"id": "n2", "type": "webhook",
          "config": {"url": "https://169.254.169.254/x"}, "next": None}
    with pytest.raises(executor.ErroDefinitivo, match="recusado"):
        await executor.executar_no(conexao, run, no)


async def test_rota_recusa_webhook_para_dentro_na_hora(cliente, token_admin):
    nos = [{"id": "n1", "type": "webhook", "config": {"url": "https://10.0.0.1/x"},
            "next": None}]
    r = await cliente.post(
        "/jornadas", headers={"Authorization": f"Bearer {token_admin}"},
        json={"name": "prova-saidas ssrf", "entry_type": "event",
              "entry_config": {"event_type": "form_submitted"},
              "entry_node_id": "n1", "nodes": nos})
    assert r.status_code == 400
    assert "recusado" in r.json()["detail"]


# ── DNS rebinding: o POST vai para o IP conferido, não para o nome ───────────

async def test_webhook_sai_para_o_ip_conferido_com_host_e_sni(saida, monkeypatch):
    """O resolvedor responde IP público na conferência e IP interno em
    qualquer consulta seguinte (o truque do rebinding). O pedido sai para o
    IP da conferência, com Host e SNI do nome — e o nome é resolvido UMA vez."""
    consultas = []

    async def rebinding(host, porta):
        consultas.append((host, porta))
        return [IP_PUBLICO] if len(consultas) == 1 else ["10.0.0.9"]
    monkeypatch.setattr(saidas, "_resolver", rebinding)
    sid = await saida("webhook", "https://gancho.exemplo.com:8443/a/b?c=1")
    chamadas = []

    r = await saidas.rodar_saidas(transporte=_transporte(200, chamadas), somente=[sid])

    assert r["enviados"] == 1
    assert consultas == [("gancho.exemplo.com", 8443)]
    [pedido] = chamadas
    assert str(pedido.url) == f"https://{IP_PUBLICO}:8443/a/b?c=1"
    assert pedido.headers["host"] == "gancho.exemplo.com:8443"
    assert pedido.extensions["sni_hostname"] == "gancho.exemplo.com"


async def test_webhook_ipv6_vai_entre_colchetes(saida, dns_publico):
    dns_publico["v6.exemplo.com"] = ["2606:2800:220:1:248:1893:25c8:1946"]
    sid = await saida("webhook", "https://v6.exemplo.com/x")
    chamadas = []
    await saidas.rodar_saidas(transporte=_transporte(200, chamadas), somente=[sid])
    assert str(chamadas[0].url) == "https://[2606:2800:220:1:248:1893:25c8:1946]/x"
    assert chamadas[0].headers["host"] == "v6.exemplo.com"
    assert chamadas[0].extensions["sni_hostname"] == "v6.exemplo.com"


async def test_conferir_destino_devolve_o_ip_permitido(dns_publico):
    dns_publico["gancho.exemplo.com"] = [IP_PUBLICO, IP_PUBLICO]
    assert await saidas.conferir_destino("https://gancho.exemplo.com/x") == IP_PUBLICO
    assert await saidas.conferir_destino(f"https://{IP_PUBLICO}/x") == IP_PUBLICO


# ── Revisão 1: tentativas esgotadas não voltam ───────────────────────────────

async def test_pendente_que_esgotou_vira_falhou_sem_sair(saida, resend_falso):
    """A falha DEPOIS do envio (ex.: `_marcar_enviado` estourando) deixa a
    linha pendente com o prazo vencendo: sem o teto na reivindicação ela
    voltaria para sempre, mandando de novo a cada 5 min."""
    w = await saida("webhook", "https://exemplo.invalid/a", tentativas=5)
    a = await saida("aviso_email", "comercial@exemplo.invalid", tentativas=7)
    chamadas = []
    await saidas.rodar_saidas(transporte=_transporte(200, chamadas), somente=[w, a])
    assert chamadas == [] and resend_falso["enviados"] == []
    for sid in (w, a):
        linha = await _linha(sid)
        assert linha["status"] == "falhou" and "tentativas" in linha["erro"]


async def test_falha_ao_marcar_enviado_nao_reenvia_sem_fim(saida, monkeypatch):
    sid = await saida("webhook", "https://exemplo.invalid/a")
    chamadas = []

    async def quebra(saida_id, *a, **k):
        raise RuntimeError("banco caiu depois do 2xx")
    monkeypatch.setattr(saidas, "_marcar_enviado", quebra)
    for _ in range(saidas.MAX_TENTATIVAS + 2):
        async with db.sessao(role="service_role") as conn:
            await conn.execute("UPDATE journey_saidas SET visivel_em = now() WHERE id = $1", sid)
        await saidas.rodar_saidas(transporte=_transporte(200, chamadas), somente=[sid])
    assert len(chamadas) == saidas.MAX_TENTATIVAS
    assert (await _linha(sid))["status"] == "falhou"
