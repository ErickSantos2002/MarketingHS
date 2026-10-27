"""Frente jornada-rd (27/10/2026): as duas regras da Nutrição do RD.

1. Espera em DIAS ÚTEIS no nó `delay` (`days` + `dias_uteis`), contada em
   `America/Sao_Paulo`, mantendo o horário do dia. Feriados ficam fora
   (pergunta aberta).
2. Saída da jornada por status do contato (`entry_config.saida_status`): quem
   vira "Venda realizada" no meio do fluxo não recebe o próximo e-mail.

Jornada e run são REAIS, dentro da transação revertida de `conexao` (o
`journey_step_log` e o `campaign_sends` têm FK para o run). Os testes de rota
usam o `cliente`, que COMITA — e apagam o que criaram.
"""

import json
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
import pytest_asyncio
from fastapi import HTTPException

import app.database as db
from app.jornadas import executor
from app.routers import jornadas as rota

SP = ZoneInfo("America/Sao_Paulo")


def _sp(ano, mes, dia, hora=10, minuto=30):
    return datetime(ano, mes, dia, hora, minuto, tzinfo=SP)


# ── 1. O cálculo, puro ───────────────────────────────────────────────────────
# Outubro/2026: 23 é sexta, 24 sábado, 25 domingo, 26 segunda.

def test_sexta_mais_um_dia_util_e_segunda():
    assert executor.somar_dias_uteis(_sp(2026, 10, 23), 1) == _sp(2026, 10, 26)


@pytest.mark.parametrize("dia", [24, 25])
def test_partida_no_fim_de_semana_conta_a_partir_da_segunda(dia):
    # Sábado ou domingo + 1 dia útil = segunda; + 2 = terça.
    assert executor.somar_dias_uteis(_sp(2026, 10, dia), 1) == _sp(2026, 10, 26)
    assert executor.somar_dias_uteis(_sp(2026, 10, dia), 2) == _sp(2026, 10, 27)


def test_cinco_dias_uteis_de_segunda_e_a_segunda_seguinte():
    assert executor.somar_dias_uteis(_sp(2026, 10, 26), 5) == _sp(2026, 11, 2)


def test_quatorze_dias_uteis():
    # seg 26/10 + 14 dias úteis: 4 (ter–sex) + 5 + 5 = sexta 13/11.
    assert executor.somar_dias_uteis(_sp(2026, 10, 26), 14) == _sp(2026, 11, 13)
    # de quarta 28/10: 2 + 5 + 5 + 2 = terça 17/11.
    assert executor.somar_dias_uteis(_sp(2026, 10, 28), 14) == _sp(2026, 11, 17)


def test_mantem_o_horario_do_dia_em_sao_paulo_vindo_de_utc():
    # 23:30 de sexta em SP é 02:30 UTC de sábado: conta como SEXTA, não sábado.
    inicio = datetime(2026, 10, 24, 2, 30, tzinfo=timezone.utc)
    fim = executor.somar_dias_uteis(inicio, 1)
    assert fim == _sp(2026, 10, 26, 23, 30)
    assert fim.astimezone(SP).hour == 23


def test_resultado_nunca_cai_no_fim_de_semana():
    for d in range(1, 40):
        for inicio in (_sp(2026, 10, 23), _sp(2026, 10, 24), _sp(2026, 10, 25)):
            assert executor.somar_dias_uteis(inicio, d).astimezone(SP).weekday() < 5


def test_despertar_so_minutos_e_o_de_hoje():
    agora = datetime(2026, 10, 23, 13, 0, tzinfo=timezone.utc)
    assert executor.instante_de_despertar({"minutes": 90}, agora) == agora + timedelta(minutes=90)
    # mínimo de 1 minuto, como antes
    assert executor.instante_de_despertar({}, agora) == agora + timedelta(minutes=1)


def test_despertar_dias_corridos_ignora_minutos():
    agora = _sp(2026, 10, 23)
    cfg = {"minutes": 1440 * 3, "days": 3}
    assert executor.instante_de_despertar(cfg, agora) == _sp(2026, 10, 26)
    assert executor.instante_de_despertar({**cfg, "dias_uteis": False}, agora) == _sp(2026, 10, 26)


def test_despertar_dias_uteis():
    agora = _sp(2026, 10, 23)
    cfg = {"minutes": 1440 * 3, "days": 3, "dias_uteis": True}
    assert executor.instante_de_despertar(cfg, agora) == _sp(2026, 10, 28)


# ── Helpers de banco ─────────────────────────────────────────────────────────

async def _lead(conexao, email="jornada-rd@exemplo.invalid", status="Lead"):
    return await conexao.fetchval(
        "INSERT INTO leads (nome, email, tipo, status) VALUES ('Jornada RD', $1, 'teste', $2) "
        "RETURNING id::text", email, status)


async def _template(conexao):
    return await conexao.fetchval(
        "INSERT INTO email_templates (name, html) "
        "VALUES ('jornada-rd', '<p>Oi {{nome}}</p>') RETURNING id::text")


async def _jornada(conexao, nos, entry_config=None):
    return await conexao.fetchval(
        """INSERT INTO journeys (name, status, entry_type, entry_config,
                                 entry_node_id, nodes)
           VALUES ('jornada-rd', 'active', 'event', $1::jsonb, $2, $3::jsonb)
           RETURNING id::text""",
        {"event_type": "form_submitted", **(entry_config or {})}, nos[0]["id"], nos)


async def _run(conexao, jornada, lead, nos, no_atual=None):
    no_atual = no_atual or nos[0]["id"]
    linha = await conexao.fetchrow(
        "INSERT INTO journey_runs (journey_id, lead_id, state, current_node_id, "
        "lock_token, locked_until) "
        "VALUES ($1::uuid, $2::uuid, 'active', $3, gen_random_uuid(), "
        "now() + interval '5 minutes') RETURNING id::text, lock_token::text",
        jornada, lead, no_atual)
    return {"run_id": linha["id"], "journey_id": jornada, "lead_id": lead,
            "current_node_id": no_atual, "state": "active",
            "waiting_event": None, "context": {}, "lock_token": linha["lock_token"],
            "nodes": nos}


async def _estado(conexao, run):
    return await conexao.fetchrow(
        "SELECT state, current_node_id, wakeup_at, context FROM journey_runs "
        "WHERE id = $1::uuid", run["run_id"])


async def _envios(conexao, run):
    return await conexao.fetch(
        "SELECT journey_node_id FROM campaign_sends WHERE journey_run_id = $1::uuid",
        run["run_id"])


# ── 1b. O nó delay grava o despertar certo ───────────────────────────────────

@pytest.mark.parametrize("cfg,esperado", [
    ({"minutes": 30}, lambda a: a + timedelta(minutes=30)),
    ({"minutes": 2880, "days": 2}, lambda a: a + timedelta(days=2)),
    ({"minutes": 1440, "days": 1, "dias_uteis": True},
     lambda a: executor.somar_dias_uteis(a, 1)),
])
async def test_no_delay_grava_wakeup_conforme_a_config(conexao, monkeypatch, cfg, esperado):
    agora = datetime(2026, 10, 23, 15, 0, tzinfo=timezone.utc)  # sexta, 12h em SP
    monkeypatch.setattr(executor, "_agora", lambda: agora)
    nos = [{"id": "d1", "type": "delay", "config": cfg, "next": "fim"},
           {"id": "fim", "type": "apply_tag", "config": {"tag_name": "jornada-rd"}}]
    jid = await _jornada(conexao, nos)
    run = await _run(conexao, jid, await _lead(conexao), nos)

    await executor.rodar_cadeia(conexao, run)

    linha = await _estado(conexao, run)
    assert linha["state"] == "waiting"
    assert linha["current_node_id"] == "fim"
    assert linha["wakeup_at"] == esperado(agora)


# ── 2. Saída por status ──────────────────────────────────────────────────────

async def test_venda_no_meio_da_jornada_nao_recebe_o_proximo_email(conexao):
    tpl = await _template(conexao)
    nos = [{"id": "e1", "type": "send_email",
            "config": {"template_id": tpl, "subject": "Primeiro"}, "next": "d1"},
           {"id": "d1", "type": "delay", "config": {"minutes": 1440, "days": 1,
                                                    "dias_uteis": True}, "next": "e2"},
           {"id": "e2", "type": "send_email",
            "config": {"template_id": tpl, "subject": "Segundo"}}]
    jid = await _jornada(conexao, nos, {"event_type": "form_submitted",
                                        "saida_status": ["Venda realizada"]})
    lead = await _lead(conexao)
    run = await _run(conexao, jid, lead, nos)

    await executor.rodar_cadeia(conexao, run)
    assert [e["journey_node_id"] for e in await _envios(conexao, run)] == ["e1"]
    assert (await _estado(conexao, run))["current_node_id"] == "e2"

    # Durante a espera, o contato compra.
    await conexao.execute(
        "UPDATE leads SET status = 'Venda realizada' WHERE id = $1::uuid", lead)

    # O worker reivindica o run de novo quando a espera vence.
    novo_token = await conexao.fetchval(
        "UPDATE journey_runs SET state = 'active', lock_token = gen_random_uuid() "
        "WHERE id = $1::uuid RETURNING lock_token::text", run["run_id"])
    run2 = {**run, "current_node_id": "e2", "lock_token": novo_token, "context": {}}
    saida = await executor.rodar_cadeia(conexao, run2)

    assert saida["falhou"] is False
    assert [e["journey_node_id"] for e in await _envios(conexao, run)] == ["e1"]
    linha = await _estado(conexao, run)
    assert linha["state"] == "exited"
    ctx = linha["context"] if isinstance(linha["context"], dict) else json.loads(linha["context"])
    assert ctx["encerrado_por"] == "saida_status"
    assert ctx["status"] == "Venda realizada"
    passo = await conexao.fetchrow(
        "SELECT node_id, result FROM journey_step_log WHERE run_id = $1::uuid "
        "AND result = 'exited'", run["run_id"])
    assert passo["node_id"] == "e2"


async def test_saida_compara_sem_caixa(conexao):
    nos = [{"id": "t1", "type": "apply_tag", "config": {"tag_name": "jornada-rd"}}]
    jid = await _jornada(conexao, nos, {"saida_status": ["venda REALIZADA"]})
    run = await _run(conexao, jid, await _lead(conexao, status="Venda realizada"), nos)
    await executor.rodar_cadeia(conexao, run)
    assert (await _estado(conexao, run))["state"] == "exited"


async def test_status_que_nao_esta_na_lista_segue(conexao):
    tpl = await _template(conexao)
    nos = [{"id": "e1", "type": "send_email",
            "config": {"template_id": tpl, "subject": "Oi"}}]
    jid = await _jornada(conexao, nos, {"saida_status": ["Venda realizada"]})
    run = await _run(conexao, jid, await _lead(conexao, status="Lead Qualificado"), nos)
    await executor.rodar_cadeia(conexao, run)
    assert (await _estado(conexao, run))["state"] == "done"
    assert len(await _envios(conexao, run)) == 1


async def test_mudar_status_para_venda_no_proprio_fluxo_encerra_antes_do_proximo(conexao):
    tpl = await _template(conexao)
    nos = [{"id": "s1", "type": "change_status",
            "config": {"status": "Venda realizada"}, "next": "e1"},
           {"id": "e1", "type": "send_email",
            "config": {"template_id": tpl, "subject": "Oi"}}]
    jid = await _jornada(conexao, nos, {"saida_status": ["Venda realizada"]})
    run = await _run(conexao, jid, await _lead(conexao), nos)
    await executor.rodar_cadeia(conexao, run)
    assert (await _estado(conexao, run))["state"] == "exited"
    assert await _envios(conexao, run) == []


@pytest.mark.parametrize("entry", [None, {"saida_status": []}])
async def test_jornada_sem_saida_continua_igual(conexao, entry):
    """Sem `saida_status` (ou lista vazia), quem já comprou segue recebendo —
    o comportamento de antes desta frente."""
    tpl = await _template(conexao)
    nos = [{"id": "e1", "type": "send_email",
            "config": {"template_id": tpl, "subject": "Oi"}, "next": "d1"},
           {"id": "d1", "type": "delay", "config": {"minutes": 60}, "next": "e2"},
           {"id": "e2", "type": "send_email",
            "config": {"template_id": tpl, "subject": "De novo"}}]
    jid = await _jornada(conexao, nos, entry)
    run = await _run(conexao, jid, await _lead(conexao, status="Venda realizada"), nos)
    antes = datetime.now(timezone.utc)

    await executor.rodar_cadeia(conexao, run)

    linha = await _estado(conexao, run)
    assert linha["state"] == "waiting"
    assert [e["journey_node_id"] for e in await _envios(conexao, run)] == ["e1"]
    # Espera em minutos corridos, como sempre foi.
    assert timedelta(minutes=59) < linha["wakeup_at"] - antes < timedelta(minutes=61)


async def test_lista_de_saida_lida_uma_vez_por_run(conexao, monkeypatch):
    nos = [{"id": "t1", "type": "apply_tag", "config": {"tag_name": "a"}, "next": "t2"},
           {"id": "t2", "type": "apply_tag", "config": {"tag_name": "b"}}]
    jid = await _jornada(conexao, nos, {"saida_status": ["Venda realizada"]})
    run = await _run(conexao, jid, await _lead(conexao), nos)
    await executor.rodar_cadeia(conexao, run)
    assert run["_saida_status"] == ["venda realizada"]


# ── 3. Validação na rota ─────────────────────────────────────────────────────

def _delay(**cfg):
    return [{"id": "d1", "type": "delay", "config": cfg}]


def test_delay_com_dias_preenche_minutos_para_o_trigger():
    nos = rota._normalizar_delays(_delay(days=5, dias_uteis=True))
    assert nos[0]["config"] == {"days": 5, "dias_uteis": True, "minutes": 5 * 1440}


def test_delay_com_dias_corrige_minutos_divergentes():
    nos = rota._normalizar_delays(_delay(days=2, minutes=10))
    assert nos[0]["config"]["minutes"] == 2880


def test_delay_so_com_minutos_fica_como_esta():
    nos = rota._normalizar_delays(_delay(minutes=30))
    assert nos[0]["config"] == {"minutes": 30}


@pytest.mark.parametrize("cfg", [
    {"days": 0}, {"days": 366}, {"days": "5"}, {"days": True}, {"days": 2.5},
    {"days": 3, "dias_uteis": "sim"}, {"minutes": 30, "dias_uteis": True},
    {"minutes": 0}, {"minutes": "x"}, {},
])
def test_delay_invalido_e_400(cfg):
    with pytest.raises(HTTPException) as e:
        rota._normalizar_delays(_delay(**cfg))
    assert e.value.status_code == 400
    assert "d1" in e.value.detail


def test_outros_nos_nao_sao_tocados():
    nos = [{"id": "x", "type": "apply_tag", "config": {"tag_name": "a"}}]
    assert rota._normalizar_delays(nos) == nos
    assert rota._normalizar_delays(None) is None


async def test_saida_status_canonica_e_recusa_desconhecido(conexao):
    entry = await rota._normalizar_saida(conexao, {"event_type": "x",
                                                   "saida_status": [" venda realizada "]})
    assert entry == {"event_type": "x", "saida_status": ["Venda realizada"]}

    with pytest.raises(HTTPException) as e:
        await rota._normalizar_saida(conexao, {"saida_status": ["Comprou"]})
    assert e.value.status_code == 400
    assert "Comprou" in e.value.detail and "Venda realizada" in e.value.detail


@pytest.mark.parametrize("valor", ["Venda realizada", [1], [""], {"a": 1}])
async def test_saida_status_forma_errada_e_400(conexao, valor):
    with pytest.raises(HTTPException) as e:
        await rota._normalizar_saida(conexao, {"saida_status": valor})
    assert e.value.status_code == 400


async def test_saida_status_vazio_ou_ausente_passa(conexao):
    assert await rota._normalizar_saida(conexao, {"event_type": "x"}) == {"event_type": "x"}
    assert await rota._normalizar_saida(conexao, {"saida_status": []}) == {"saida_status": []}
    assert await rota._normalizar_saida(conexao, None) is None


@pytest_asyncio.fixture
async def jornadas_criadas():
    """O `cliente` COMITA: apaga as jornadas criadas pela rota, por id."""
    ids = []
    yield ids
    if ids:
        async with db.sessao(role="service_role") as conn:
            await conn.execute("DELETE FROM journeys WHERE id = ANY($1::uuid[])", ids)


async def test_rota_aceita_e_normaliza(cliente, token_admin, jornadas_criadas):
    auth = {"Authorization": f"Bearer {token_admin}"}
    r = await cliente.post("/jornadas", headers=auth, json={
        "name": f"jornada-rd {uuid.uuid4().hex[:6]}", "entry_type": "event",
        "entry_config": {"event_type": "form_submitted",
                         "saida_status": ["venda realizada"]},
        "entry_node_id": "d1",
        "nodes": [{"id": "d1", "type": "delay",
                   "config": {"days": 5, "dias_uteis": True}}]})
    assert r.status_code == 201, r.text
    jid = r.json()["journey"]["id"]
    jornadas_criadas.append(jid)

    lida = (await cliente.get(f"/jornadas/{jid}", headers=auth)).json()["data"]
    assert lida["entry_config"]["saida_status"] == ["Venda realizada"]
    assert lida["nodes"][0]["config"] == {"days": 5, "dias_uteis": True, "minutes": 7200}

    r = await cliente.patch(f"/jornadas/{jid}", headers=auth, json={
        "entry_config": {"event_type": "form_submitted", "saida_status": ["Comprou"]}})
    assert r.status_code == 400
    assert "Comprou" in r.json()["detail"]

    r = await cliente.patch(f"/jornadas/{jid}", headers=auth, json={
        "nodes": [{"id": "d1", "type": "delay", "config": {"days": 400}}]})
    assert r.status_code == 400
    assert "365" in r.json()["detail"]
