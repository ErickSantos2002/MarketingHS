"""As rotas públicas do agendamento (Task 6).

O modo de falhar: página sem agendamento aceitando rascunho, robô gravando
(honeypot), lead de até 400 funcionários parado num rascunho em vez de virar
lead comum, horário sem fuso aceito, ocupado devolvido como sucesso, ou o
lead navegando pelos dias e levando 429 no formulário.

GrowthHS = `GrowthHSFalso` pelo `TRANSPORTE` da rota; `growthhs.ler_config`
trocado pela config de teste (nenhum teste lê `growthhs_config`).
"""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

import app.database as db
from agendamento_banco import cenario  # noqa: F401 — fixture
from app.crm import growthhs
from app.crm.growthhs import Config
from app.routers import agendamento as rota
from growthhs_falso import GrowthHSFalso

BRT = ZoneInfo("America/Sao_Paulo")
CFG = Config(base_url="https://growthhs.exemplo.invalid", client_id="hsg_ag",
             client_secret="segredo", list_id=22, boards_conferidos=(6, 7),
             app_url="https://app.exemplo.invalid", ambiente="homologacao")
A, B = 9201, 9202


@pytest.fixture
def falso(monkeypatch):
    from app.captura import email as vemail

    async def sempre_tem_mx(_dominio):
        return True

    monkeypatch.setattr(vemail, "_tem_mx", sempre_tem_mx)
    vemail._limpar_cache()
    f = GrowthHSFalso()
    f.vendedores = [{"id": i, "nome": f"V{i}", "email": f"v{i}@hs.invalid", "ativo": True}
                    for i in (A, B)]
    monkeypatch.setattr(rota, "TRANSPORTE", f.transporte())

    async def config_de_teste():
        return CFG

    monkeypatch.setattr(growthhs, "ler_config", config_de_teste)
    growthhs.limpar_tokens()
    yield f
    growthhs.limpar_tokens()
    vemail._limpar_cache()


def _dados(cenario, email, **kw):
    corpo = {"page_slug": cenario.slug, "email": email, "nome": "Joana",
             "whatsapp": "(81) 99999-0000"}
    corpo.update(kw)
    return corpo


EMPRESA_GRANDE = {"empresa": "Acme", "cargo": "Diretora", "funcionarios": "401 a 1.000",
                  "filiais": "2 a 5"}


def _proximo_util_as_14h() -> str:
    """Um horário da grade de verdade (a rota usa o relógio): 14:00 em
    Brasília do próximo dia útil depois de amanhã."""
    dia = datetime.now(BRT).date() + timedelta(days=2)
    while dia.weekday() > 4:
        dia += timedelta(days=1)
    inicio = datetime(dia.year, dia.month, dia.day, 14, tzinfo=BRT)
    return inicio.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


async def _linhas(cenario):
    async with db.sessao(role="service_role") as conn:
        return await conn.fetch(
            "SELECT * FROM reuniao_agendamentos WHERE page_slug = $1", cenario.slug)


async def test_pagina_sem_agendamento_da_404(cenario, cliente, falso):
    from agendamento_banco import config_da_pagina
    await cenario.trocar_config(config_da_pagina(ativo=False))
    r = await cliente.post("/publico/agendamento/dados", json=_dados(cenario, cenario.email()))
    assert r.status_code == 404
    r = await cliente.post("/publico/agendamento/dados",
                           json={**_dados(cenario, cenario.email()), "page_slug": "nao-existe"})
    assert r.status_code == 404


async def test_honeypot_responde_token_e_nao_grava(cenario, cliente, falso):
    r = await cliente.post("/publico/agendamento/dados",
                           json=_dados(cenario, cenario.email(), website="http://spam"))
    assert r.status_code == 200 and r.json()["token"]
    assert await _linhas(cenario) == []
    r2 = await cliente.post(f"/publico/agendamento/{r.json()['token']}/empresa",
                            json={"fields": EMPRESA_GRANDE})
    assert r2.status_code == 404


async def test_dados_valida_campos(cenario, cliente, falso):
    r = await cliente.post("/publico/agendamento/dados",
                           json=_dados(cenario, cenario.email(), whatsapp="123"))
    assert r.status_code == 400 and "whatsapp" in r.json()["detail"]["campos"]


async def test_empresa_ate_400_vira_lead_comum(cenario, cliente, falso):
    email = cenario.email("pequena")
    token = (await cliente.post("/publico/agendamento/dados",
                                json=_dados(cenario, email))).json()["token"]
    r = await cliente.post(f"/publico/agendamento/{token}/empresa",
                           json={"fields": {**EMPRESA_GRANDE, "funcionarios": "101 a 400"}})
    assert r.status_code == 200 and r.json() == {"pode_agendar": False}
    linha = (await _linhas(cenario))[0]
    assert linha["status"] == "lead_comum" and linha["lead_id"] is not None
    async with db.sessao(role="service_role") as conn:
        lead = await conn.fetchrow(
            "SELECT nome, whatsapp, funcionarios, campos_extras FROM leads WHERE email = $1",
            email)
    assert (lead["nome"], lead["whatsapp"], lead["funcionarios"]) == (
        "Joana", "+5581999990000", "101 a 400")


async def test_empresa_valida_obrigatorios(cenario, cliente, falso):
    token = (await cliente.post("/publico/agendamento/dados",
                                json=_dados(cenario, cenario.email()))).json()["token"]
    r = await cliente.post(f"/publico/agendamento/{token}/empresa",
                           json={"fields": {"empresa": "Acme"}})
    assert r.status_code == 400
    assert {"cargo", "funcionarios"} <= set(r.json()["detail"]["campos"])


async def test_fluxo_completo_dados_empresa_horarios_confirmar(cenario, cliente, falso):
    await cenario.roleta(A, B)
    email = cenario.email("fluxo")
    token = (await cliente.post("/publico/agendamento/dados",
                                json=_dados(cenario, email))).json()["token"]
    r = await cliente.post(f"/publico/agendamento/{token}/empresa",
                           json={"fields": EMPRESA_GRANDE})
    assert r.json() == {"pode_agendar": True}
    h = await cliente.get(f"/publico/agendamento/horarios/{token}")
    assert h.status_code == 200 and h.json()["duracao_min"] == 60
    inicio = _proximo_util_as_14h()
    assert any(inicio in d["horarios"] for d in h.json()["dias"])
    c = await cliente.post(f"/publico/agendamento/{token}/confirmar", json={"inicio": inicio})
    assert c.status_code == 200
    assert c.json()["status"] == "reservada" and c.json()["inicio"] == inicio
    assert "vendedor_nome" not in c.json()
    linha = (await _linhas(cenario))[0]
    assert (linha["status"], linha["vendedor_id"]) == ("reservada", A)
    # De novo (clique duplo): mesma reserva, sem dizer o horário.
    c2 = await cliente.post(f"/publico/agendamento/{token}/confirmar", json={"inicio": inicio})
    assert c2.status_code == 200 and c2.json() == {"status": "ja_tem"}


async def test_confirmar_sem_fuso_422(cenario, cliente, falso):
    token = (await cliente.post("/publico/agendamento/dados",
                                json=_dados(cenario, cenario.email()))).json()["token"]
    r = await cliente.post(f"/publico/agendamento/{token}/confirmar",
                           json={"inicio": "2026-10-29T15:00:00"})
    assert r.status_code == 422


async def test_ocupado_409(cenario, cliente, falso):
    await cenario.roleta(A)
    inicio = _proximo_util_as_14h()
    tokens = []
    for nome in ("primeiro", "segundo"):
        t = (await cliente.post("/publico/agendamento/dados",
                                json=_dados(cenario, cenario.email(nome)))).json()["token"]
        await cliente.post(f"/publico/agendamento/{t}/empresa", json={"fields": EMPRESA_GRANDE})
        tokens.append(t)
    assert (await cliente.post(f"/publico/agendamento/{tokens[0]}/confirmar",
                               json={"inicio": inicio})).status_code == 200
    r = await cliente.post(f"/publico/agendamento/{tokens[1]}/confirmar",
                           json={"inicio": inicio})
    assert r.status_code == 409 and r.json()["status"] == "ocupado"


async def test_ligar_vira_lead_comum(cenario, cliente, falso):
    token = (await cliente.post("/publico/agendamento/dados",
                                json=_dados(cenario, cenario.email("ligar")))).json()["token"]
    r = await cliente.post(f"/publico/agendamento/{token}/ligar")
    assert r.json() == {"ok": True}
    assert (await _linhas(cenario))[0]["status"] == "lead_comum"


async def test_horarios_tem_balde_proprio(cenario, cliente, falso):
    token = (await cliente.post("/publico/agendamento/dados",
                                json=_dados(cenario, cenario.email("balde")))).json()["token"]
    for _ in range(31):
        r = await cliente.get(f"/publico/agendamento/horarios/{token}")
        assert r.status_code == 200
    # O balde comum (30/min) segue valendo para o resto do /publico.
    codigos = [(await cliente.post(f"/publico/agendamento/{token}/ligar")).status_code
               for _ in range(31)]
    assert 429 in codigos


async def test_token_desconhecido_404(cenario, cliente, falso):
    for metodo, caminho, corpo in (
            ("post", "/publico/agendamento/xyz/empresa", {"fields": EMPRESA_GRANDE}),
            ("get", "/publico/agendamento/horarios/xyz", None),
            ("post", "/publico/agendamento/xyz/confirmar", {"inicio": _proximo_util_as_14h()}),
            ("post", "/publico/agendamento/xyz/ligar", None)):
        kw = {"json": corpo} if corpo is not None else {}
        r = await getattr(cliente, metodo)(caminho, **kw)
        assert r.status_code == 404, caminho
        assert r.json() == {"detail": "Não encontrado."}
