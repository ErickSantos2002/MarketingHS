"""Rascunho, horários e confirmação do agendamento (Task 5).

O modo de falhar: oferecer horário em que ninguém está livre, dar dois leads
ao mesmo vendedor no mesmo horário (clique duplo, duas abas, dois leads ao
mesmo tempo), a roleta andar errado, ou o lead confirmado entrar também na
jornada que entrega ao comercial (o segundo card).

GrowthHS = `GrowthHSFalso` (tests/growthhs_falso.py). `agora` fixo: quarta,
28/10/2026, 10:00 em Brasília.
"""

import asyncio
import json
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

import httpx
import pytest

import app.database as db
from agendamento_banco import DADOS_COMPLETOS, cenario  # noqa: F401 — fixture
from app.agendamento import reserva
from app.crm import growthhs
from app.crm.growthhs import Cliente, Config
from growthhs_falso import GrowthHSFalso

BRT = ZoneInfo("America/Sao_Paulo")
UTC = timezone.utc
AGORA = datetime(2026, 10, 28, 10, tzinfo=BRT)
CFG = Config(base_url="https://growthhs.exemplo.invalid", client_id="hsg_ag",
             client_secret="segredo", list_id=22, boards_conferidos=(6, 7),
             app_url="https://app.exemplo.invalid", ambiente="homologacao")
A, B, C, D, E = 9101, 9102, 9103, 9104, 9105


def _brt(dia, h, m=0):
    return datetime(2026, 10, dia, h, m, tzinfo=BRT).astimezone(UTC)


def _z(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


@pytest.fixture(autouse=True)
def _sem_token():
    growthhs.limpar_tokens()
    yield
    growthhs.limpar_tokens()


@pytest.fixture
def falso():
    f = GrowthHSFalso()
    f.vendedores = [{"id": i, "nome": f"Vendedor {i}", "email": f"v{i}@hs.invalid",
                     "ativo": True} for i in (A, B, C, D, E)]
    return f


async def _horarios(falso, token):
    async with Cliente(CFG, transporte=falso.transporte()) as cli:
        return await reserva.horarios(token, agora=AGORA, cliente=cli)


async def _confirmar(falso, token, inicio):
    async with Cliente(CFG, transporte=falso.transporte()) as cli:
        return await reserva.confirmar(token, inicio, agora=AGORA, cliente=cli)


def _do_dia(resp, dia):
    for d in resp["dias"]:
        if d["data"] == dia:
            return d["horarios"]
    return []


# ── Rascunho ─────────────────────────────────────────────────────────────────

async def test_rascunho_normaliza_email_e_completar_diz_se_pode(cenario):
    token = await cenario.rascunho(" Joao.Ag@Exemplo.INVALID ", dados={
        "colunas": {"nome": "João"}})
    linha = await cenario.linha(token)
    assert linha["email"] == "joao.ag@exemplo.invalid" and linha["status"] == "rascunho"
    async with db.sessao(role="service_role") as conn:
        r = await reserva.completar_rascunho(conn, token, {"colunas": {
            "empresa": "X", "funcionarios": "101 a 400"}})
    assert r == {"pode_agendar": False}
    async with db.sessao(role="service_role") as conn:
        r = await reserva.completar_rascunho(conn, token, {"colunas": {
            "funcionarios": "Mais de 1.000"}, "extras": {"filiais": "Só a matriz"}})
    assert r == {"pode_agendar": True}
    dados = json.loads(l) if isinstance(l := (await cenario.linha(token))["dados"], str) else l
    assert dados["colunas"] == {"nome": "João", "empresa": "X", "funcionarios": "Mais de 1.000"}


async def test_virar_lead_comum_e_idempotente(cenario):
    email = cenario.email("comum")
    token = await cenario.rascunho(email)
    await reserva.virar_lead_comum(token)
    await reserva.virar_lead_comum(token)
    linha = await cenario.linha(token)
    assert linha["status"] == "lead_comum" and linha["lead_id"] is not None
    async with db.sessao(role="service_role") as conn:
        assert await conn.fetchval("SELECT count(*) FROM leads WHERE email = $1", email) == 1


# ── Horários ─────────────────────────────────────────────────────────────────

async def test_horarios_formato_e_brasilia(cenario, falso):
    await cenario.roleta(A)
    resp = await _horarios(falso, await cenario.rascunho())
    assert resp["duracao_min"] == 60
    assert resp["dias"][0]["data"] == "2026-10-28"
    assert resp["dias"][0]["horarios"][0] == "2026-10-28T15:00:00Z"   # 12:00 BRT
    assert "2026-10-31" not in [d["data"] for d in resp["dias"]]


async def test_horarios_descontam_reserva_propria(cenario, falso):
    await cenario.roleta(A)
    outra = await cenario.rascunho()
    assert (await _confirmar(falso, outra, _brt(29, 12)))["status"] == "reservada"
    resp = await _horarios(falso, await cenario.rascunho())
    dia = _do_dia(resp, "2026-10-29")
    assert _z(_brt(29, 12)) not in dia and _z(_brt(29, 11, 30)) not in dia
    assert _z(_brt(29, 11)) in dia and _z(_brt(29, 13)) in dia


async def test_vendedor_em_erros_nao_aparece_livre(cenario, falso):
    await cenario.roleta(A, B)
    falso.erros_agenda.add(A)
    falso.ocupar(B, _z(_brt(29, 0)), _z(_brt(30, 0)))
    resp = await _horarios(falso, await cenario.rascunho())
    assert _do_dia(resp, "2026-10-29") == []
    assert _do_dia(resp, "2026-10-30")


async def test_so_um_em_erros_e_ninguem_mais_e_indisponivel(cenario, falso):
    await cenario.roleta(A)
    falso.erros_agenda.add(A)
    assert await _horarios(falso, await cenario.rascunho()) == {"indisponivel": True}


async def test_roleta_vazia_e_indisponivel(cenario, falso):
    assert await _horarios(falso, await cenario.rascunho()) == {"indisponivel": True}


async def test_growthhs_fora_devolve_indisponivel(cenario, falso):
    await cenario.roleta(A)
    falso.forcar[("GET", "/api/v1/integration/agenda")] = [
        httpx.Response(503, json={"detail": "token da Microsoft"})]
    assert await _horarios(falso, await cenario.rascunho()) == {"indisponivel": True}


async def test_quem_nao_pode_agendar_nao_ve_horario(cenario, falso):
    await cenario.roleta(A)
    token = await cenario.rascunho(dados={"colunas": {"funcionarios": "101 a 400"}})
    assert await _horarios(falso, token) == {"indisponivel": True}


async def test_card_aberto_mostra_so_o_vendedor_dele_e_nao_anda_a_fila(cenario, falso):
    await cenario.roleta(A, B)
    email = cenario.email("card")
    pessoa = falso.pessoa(email=email)
    card = falso.card(pessoa)
    falso.cards[card]["assigned_to_id"] = C
    falso.ocupar(C, _z(_brt(29, 12)), _z(_brt(29, 13)))
    token = await cenario.rascunho(email.upper())
    resp = await _horarios(falso, token)
    assert _z(_brt(29, 12)) not in _do_dia(resp, "2026-10-29")
    pedido = [p for p in falso.pedidos if p.url.path.endswith("/integration/agenda")][-1]
    assert dict(pedido.url.params)["user_ids"] == str(C)
    linha = await cenario.linha(token)
    assert (linha["card_existente_id"], linha["vendedor_id"]) == (card, C)

    r = await _confirmar(falso, token, _brt(29, 14))
    assert r["status"] == "reservada" and "vendedor_nome" not in r
    assert await cenario.fila() == [A, B]
    linha = await cenario.linha(token)
    assert (linha["vendedor_id"], linha["vendedor_email"]) == (C, f"v{C}@hs.invalid")


async def test_card_aberto_sem_vendedor_segue_a_roleta(cenario, falso):
    await cenario.roleta(A, B)
    email = cenario.email("semvend")
    falso.card(falso.pessoa(email=email))
    token = await cenario.rascunho(email)
    await _horarios(falso, token)
    r = await _confirmar(falso, token, _brt(29, 14))
    assert r["status"] == "reservada"
    linha = await cenario.linha(token)
    assert linha["card_existente_id"] is not None and linha["vendedor_id"] == A
    assert await cenario.fila() == [B, A]


# ── Confirmação ──────────────────────────────────────────────────────────────

async def test_confirmar_escolhe_primeiro_livre_e_pulado_guarda_vez(cenario, falso):
    await cenario.roleta(A, B, C, D, E)
    for v in (A, B, C):
        falso.ocupar(v, _z(_brt(29, 11)), _z(_brt(29, 13)))
    r = await _confirmar(falso, await cenario.rascunho(), _brt(29, 12))
    assert r == {"status": "reservada", "inicio": _z(_brt(29, 12)),
                 "fim": _z(_brt(29, 13))}
    assert "vendedor_nome" not in r
    assert await cenario.fila() == [A, B, C, E, D]


async def test_confirmar_duas_vezes_mesma_reserva(cenario, falso):
    await cenario.roleta(A, B)
    token = await cenario.rascunho()
    primeira = await _confirmar(falso, token, _brt(29, 12))
    segunda = await _confirmar(falso, token, _brt(29, 15))
    assert primeira["status"] == "reservada"
    assert segunda == {"status": "ja_tem"}
    async with db.sessao(role="service_role") as conn:
        assert await conn.fetchval(
            "SELECT count(*) FROM reuniao_agendamentos WHERE page_slug = $1 "
            "AND status = 'reservada'", cenario.slug) == 1
    assert await cenario.fila() == [B, A]


async def test_email_com_maiuscula_e_espaco_e_o_mesmo(cenario, falso):
    await cenario.roleta(A, B)
    email = cenario.email("caixa")
    await _confirmar(falso, await cenario.rascunho(email), _brt(29, 12))
    outra_aba = await cenario.rascunho(f"  {email.upper()} ")
    r = await _confirmar(falso, outra_aba, _brt(30, 9))
    assert r == {"status": "ja_tem"}


async def test_duas_confirmacoes_simultaneas_vendedores_diferentes(cenario, falso):
    await cenario.roleta(A, B)
    t1, t2 = await cenario.rascunho(), await cenario.rascunho()
    r1, r2 = await asyncio.gather(_confirmar(falso, t1, _brt(29, 12)),
                                  _confirmar(falso, t2, _brt(29, 12)))
    assert r1["status"] == r2["status"] == "reservada"
    assert {(await cenario.linha(t))["vendedor_id"] for t in (t1, t2)} == {A, B}


async def test_ultimo_livre_tomado_devolve_ocupado(cenario, falso):
    await cenario.roleta(A, B)
    falso.ocupar(B, _z(_brt(29, 12)), _z(_brt(29, 13)))
    assert (await _confirmar(falso, await cenario.rascunho(), _brt(29, 12)))["status"] \
        == "reservada"
    token = await cenario.rascunho()
    assert await _confirmar(falso, token, _brt(29, 12)) == {"status": "ocupado"}
    assert (await cenario.linha(token))["status"] == "rascunho"
    # E o mesmo rascunho consegue outro horário depois.
    assert (await _confirmar(falso, token, _brt(29, 15)))["status"] == "reservada"


async def test_horario_fora_da_grade_e_recusado(cenario, falso):
    await cenario.roleta(A)
    token = await cenario.rascunho()
    for inicio in (_brt(29, 7), _brt(29, 12, 15), _brt(28, 11), _brt(31, 10),
                   _brt(29, 17, 30)):
        with pytest.raises(reserva.HorarioInvalido):
            await _confirmar(falso, token, inicio)
    with pytest.raises(reserva.HorarioInvalido):
        await _confirmar(falso, token, datetime(2026, 10, 29, 12))  # sem fuso


async def test_growthhs_fora_na_confirmacao_e_indisponivel(cenario, falso):
    await cenario.roleta(A)
    falso.forcar[("GET", "/api/v1/integration/agenda")] = [
        httpx.Response(503, json={"detail": "x"})]
    token = await cenario.rascunho()
    assert await _confirmar(falso, token, _brt(29, 12)) == {"status": "indisponivel"}
    assert (await cenario.linha(token))["status"] == "rascunho"


async def test_token_desconhecido(cenario, falso):
    with pytest.raises(reserva.TokenDesconhecido):
        await _horarios(falso, "nao-existe")
    with pytest.raises(reserva.TokenDesconhecido):
        await _confirmar(falso, "nao-existe", _brt(29, 12))


async def test_confirmado_grava_lead_com_marca_e_sem_handoff(cenario, falso):
    await cenario.roleta(A)
    email = cenario.email("marca")
    token = await cenario.rascunho(email)
    assert (await _confirmar(falso, token, _brt(29, 12)))["status"] == "reservada"
    linha = await cenario.linha(token)
    assert linha["lead_id"] is not None
    async with db.sessao(role="service_role") as conn:
        lead = await conn.fetchrow(
            "SELECT id, nome, empresa, funcionarios, campos_extras FROM leads "
            "WHERE email = $1", email)
        assert lead["id"] == linha["lead_id"]
        assert (lead["nome"], lead["funcionarios"]) == ("Joana Lead", "401 a 1.000")
        meta = await conn.fetchval(
            "SELECT metadata FROM contact_events WHERE lead_id = $1 "
            "AND event_type = 'form_submitted'", lead["id"])
        meta = meta if isinstance(meta, dict) else json.loads(meta)
        assert meta["agendamento"] == "true" and meta["page_slug"] == cenario.slug
        assert await conn.fetchval(
            "SELECT count(*) FROM crm_handoffs WHERE lead_id = $1", lead["id"]) == 0


async def test_ja_tem_nao_devolve_horario(cenario, falso):
    """Revisão de segurança (28/10): o e-mail não é verificado — quem digita o
    e-mail de outra pessoa não pode descobrir quando é a reunião dela, nem
    com qual vendedor."""
    await cenario.roleta(A)
    email = cenario.email("alvo")
    dono = await _confirmar(falso, await cenario.rascunho(email), _brt(29, 12))
    assert set(dono) == {"status", "inicio", "fim"}
    intruso = await cenario.rascunho(email)
    r = await _confirmar(falso, intruso, _brt(30, 9))
    assert r == {"status": "ja_tem"}
    assert "2026-10-29" not in json.dumps(r) and "Vendedor" not in json.dumps(r)
