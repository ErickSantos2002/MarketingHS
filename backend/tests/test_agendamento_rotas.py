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
    r2 = await cliente.post("/publico/agendamento/empresa",
                            json={"token": r.json()['token'], "fields": EMPRESA_GRANDE})
    assert r2.status_code == 404


async def test_dados_valida_campos(cenario, cliente, falso):
    r = await cliente.post("/publico/agendamento/dados",
                           json=_dados(cenario, cenario.email(), whatsapp="123"))
    assert r.status_code == 400 and "whatsapp" in r.json()["detail"]["campos"]


async def test_empresa_ate_400_vira_lead_comum(cenario, cliente, falso):
    email = cenario.email("pequena")
    token = (await cliente.post("/publico/agendamento/dados",
                                json=_dados(cenario, email))).json()["token"]
    r = await cliente.post("/publico/agendamento/empresa",
                           json={"token": token, "fields": {**EMPRESA_GRANDE, "funcionarios": "101 a 400"}})
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
    r = await cliente.post("/publico/agendamento/empresa",
                           json={"token": token, "fields": {"empresa": "Acme"}})
    assert r.status_code == 400
    assert {"cargo", "funcionarios"} <= set(r.json()["detail"]["campos"])


async def test_fluxo_completo_dados_empresa_horarios_confirmar(cenario, cliente, falso):
    await cenario.roleta(A, B)
    email = cenario.email("fluxo")
    token = (await cliente.post("/publico/agendamento/dados",
                                json=_dados(cenario, email))).json()["token"]
    r = await cliente.post("/publico/agendamento/empresa",
                           json={"token": token, "fields": EMPRESA_GRANDE})
    assert r.json() == {"pode_agendar": True}
    h = await cliente.post("/publico/agendamento/horarios/consultar", json={"token": token})
    assert h.status_code == 200 and h.json()["duracao_min"] == 60
    inicio = _proximo_util_as_14h()
    assert any(inicio in d["horarios"] for d in h.json()["dias"])
    c = await cliente.post("/publico/agendamento/confirmar", json={"token": token, "inicio": inicio})
    assert c.status_code == 200
    assert c.json()["status"] == "reservada" and c.json()["inicio"] == inicio
    assert "vendedor_nome" not in c.json()
    linha = (await _linhas(cenario))[0]
    assert (linha["status"], linha["vendedor_id"]) == ("reservada", A)
    # De novo (clique duplo): mesma reserva, sem dizer o horário.
    c2 = await cliente.post("/publico/agendamento/confirmar", json={"token": token, "inicio": inicio})
    assert c2.status_code == 200 and c2.json() == {"status": "ja_tem"}


async def test_empresa_valida_perguntas_so_do_agendamento(cenario, cliente, falso):
    """Landing phoebus (29/10): o porte, os testes por dia e as filiais saíram
    do formulário da página e ficam em `agendamento.campos` — o modal pergunta,
    a etapa 2 valida, e o `pode_agendar` passa com o porte vindo só dali."""
    from test_agendamento_regras import config_phoebus
    await cenario.trocar_config(config_phoebus())
    url = "/publico/agendamento/empresa"

    token = (await cliente.post("/publico/agendamento/dados",
                                json=_dados(cenario, cenario.email("so-ag")))).json()["token"]
    # Obrigatório só do agendamento faltando: 400 com erro no campo.
    r = await cliente.post(url, json={"token": token, "fields": {"empresa": "Acme"}})
    assert r.status_code == 400
    assert set(r.json()["detail"]["campos"]) == {"funcionarios"}
    # Opção fora da lista: recusada.
    r = await cliente.post(url, json={"token": token, "fields": {
        "empresa": "Acme", "funcionarios": "Mais de 1.000", "filiais": "Umas dez"}})
    assert r.status_code == 400 and set(r.json()["detail"]["campos"]) == {"filiais"}
    # Completo: aceito, e o porte do agendamento destrava a agenda.
    r = await cliente.post(url, json={"token": token, "fields": {
        "empresa": "Acme", "funcionarios": "Mais de 1.000",
        "testes_por_dia": "51 a 200", "filiais": "2 a 5"}})
    assert r.status_code == 200 and r.json() == {"pode_agendar": True}
    linha = await cenario.linha(token)
    dados = linha["dados"] if isinstance(linha["dados"], dict) else __import__(
        "json").loads(linha["dados"])
    assert dados["colunas"]["funcionarios"] == "Mais de 1.000"
    assert dados["extras"] == {"testes_por_dia": "51 a 200", "filiais": "2 a 5"}


async def test_confirmar_sem_fuso_422(cenario, cliente, falso):
    token = (await cliente.post("/publico/agendamento/dados",
                                json=_dados(cenario, cenario.email()))).json()["token"]
    r = await cliente.post("/publico/agendamento/confirmar",
                           json={"token": token, "inicio": "2026-10-29T15:00:00"})
    assert r.status_code == 422


async def test_ocupado_409(cenario, cliente, falso):
    await cenario.roleta(A)
    inicio = _proximo_util_as_14h()
    tokens = []
    for nome in ("primeiro", "segundo"):
        t = (await cliente.post("/publico/agendamento/dados",
                                json=_dados(cenario, cenario.email(nome)))).json()["token"]
        await cliente.post("/publico/agendamento/empresa", json={"token": t, "fields": EMPRESA_GRANDE})
        tokens.append(t)
    assert (await cliente.post("/publico/agendamento/confirmar",
                               json={"token": tokens[0], "inicio": inicio})).status_code == 200
    r = await cliente.post("/publico/agendamento/confirmar",
                           json={"token": tokens[1], "inicio": inicio})
    assert r.status_code == 409 and r.json()["status"] == "ocupado"


async def test_ligar_vira_lead_comum(cenario, cliente, falso):
    token = (await cliente.post("/publico/agendamento/dados",
                                json=_dados(cenario, cenario.email("ligar")))).json()["token"]
    r = await cliente.post("/publico/agendamento/ligar", json={"token": token})
    assert r.json() == {"ok": True}
    assert (await _linhas(cenario))[0]["status"] == "lead_comum"


async def test_horarios_tem_balde_proprio(cenario, cliente, falso):
    token = (await cliente.post("/publico/agendamento/dados",
                                json=_dados(cenario, cenario.email("balde")))).json()["token"]
    for _ in range(31):
        r = await cliente.post("/publico/agendamento/horarios/consultar", json={"token": token})
        assert r.status_code == 200
    # O balde comum (30/min) segue valendo para o resto do /publico.
    codigos = [(await cliente.post("/publico/agendamento/ligar",
                                   json={"token": token})).status_code
               for _ in range(31)]
    assert 429 in codigos


async def test_token_desconhecido_404(cenario, cliente, falso):
    for caminho, corpo in (
            ("/publico/agendamento/empresa", {"fields": EMPRESA_GRANDE}),
            ("/publico/agendamento/horarios/consultar", {}),
            ("/publico/agendamento/confirmar", {"inicio": _proximo_util_as_14h()}),
            ("/publico/agendamento/ligar", {})):
        r = await cliente.post(caminho, json={"token": "xyz", **corpo})
        assert r.status_code == 404, caminho
        assert r.json() == {"detail": "Não encontrado."}
        # Sem token no corpo: 422, nada tocado.
        assert (await cliente.post(caminho, json=corpo)).status_code == 422, caminho


# ── M6: o token fora do caminho (frente agendamento-robustez, 29/10) ──────────
# O token do rascunho é a única chave dele; no CAMINHO, ele fica no log de
# acesso do proxy (EasyPanel/Traefik, nginx). As rotas novas o levam no corpo.

async def test_m6_fluxo_inteiro_sem_token_no_caminho(cenario, cliente, falso):
    await cenario.roleta(A)
    token = (await cliente.post("/publico/agendamento/dados",
                                json=_dados(cenario, cenario.email("m6")))).json()["token"]
    caminhos = []

    async def post(caminho, corpo):
        caminhos.append(caminho)
        return await cliente.post(caminho, json=corpo)

    assert (await post("/publico/agendamento/empresa",
                       {"token": token, "fields": EMPRESA_GRANDE})).json() == {
        "pode_agendar": True}
    assert (await post("/publico/agendamento/horarios/consultar",
                       {"token": token})).status_code == 200
    c = await post("/publico/agendamento/confirmar",
                   {"token": token, "inicio": _proximo_util_as_14h()})
    assert c.json()["status"] == "reservada"
    assert all(token not in caminho for caminho in caminhos)


async def test_m6_rotas_antigas_com_token_no_caminho_sairam(cenario, cliente, falso):
    """As quatro rotas com o token no caminho saíram no deploy seguinte ao das
    novas (29/10). Com token VÁLIDO: um 404 com token inventado não provaria
    nada (a rota antiga também dava 404 para token desconhecido)."""
    await cenario.roleta(A)
    token = (await cliente.post("/publico/agendamento/dados",
                                json=_dados(cenario, cenario.email("antiga")))).json()["token"]
    for metodo, caminho, corpo in (
            ("POST", f"/publico/agendamento/{token}/empresa", {"fields": EMPRESA_GRANDE}),
            ("GET", f"/publico/agendamento/horarios/{token}", None),
            ("POST", f"/publico/agendamento/{token}/confirmar",
             {"inicio": _proximo_util_as_14h()}),
            ("POST", f"/publico/agendamento/{token}/ligar", None)):
        r = await cliente.request(metodo, caminho, json=corpo)
        assert r.status_code in (404, 405), (metodo, caminho, r.status_code)
    caminhos = {r.path for r in rota.router.routes}
    assert not any("{token}" in c for c in caminhos), caminhos
    # O rascunho continua inteiro: nenhuma das chamadas acima andou com ele.
    assert (await cliente.post("/publico/agendamento/empresa",
                               json={"token": token, "fields": EMPRESA_GRANDE})).json() == {
        "pode_agendar": True}


def test_m6_horarios_novos_no_balde_proprio():
    """O balde próprio e a isenção do comum casam por PREFIXO
    (`/publico/agendamento/horarios/`, em `main.py`): a rota nova precisa
    começar com ele — senão a navegação entre dias gasta a cota do
    formulário."""
    caminhos = {r.path for r in rota.router.routes}
    assert "/publico/agendamento/horarios/consultar" in caminhos
    assert "/publico/agendamento/horarios/consultar".startswith("/publico/agendamento/horarios/")
