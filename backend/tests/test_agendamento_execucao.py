"""A fila do agendamento: reserva → card, nota, tarefa, sala e e-mail (Task 7).

O modo de falhar: card duplicado (201 perdido, retry), card sem vendedor ou
sem a reunião, convite cortado em silêncio (`convidados_removidos`), reserva
falhada liberando o horário, e-mail ao vendedor com HTML do formulário
executando, alerta repetido a cada passada.

GrowthHS = `GrowthHSFalso`; Resend = falso (nada sai). Cada passada só pega
as reservas do próprio teste (`somente=`).
"""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx
import pytest

import app.database as db
from agendamento_banco import cenario  # noqa: F401 — fixture
from app.agendamento import execucao, reserva
from app.crm import growthhs
from app.crm.growthhs import Cliente, Config
from growthhs_falso import CARDS, TAREFAS, GrowthHSFalso

BRT = ZoneInfo("America/Sao_Paulo")
UTC = timezone.utc
# Relógio de verdade: a execução compara `inicio` com `now()` (reunião que já
# passou não é criada) — com data fixa a suíte quebraria no dia seguinte.
AGORA = datetime.now(BRT)


def _proximo_dia_util(dias: int = 2):
    dia = AGORA.date() + timedelta(days=dias)
    while dia.weekday() > 4:
        dia += timedelta(days=1)
    return dia


_DIA = _proximo_dia_util()
SLOT = datetime(_DIA.year, _DIA.month, _DIA.day, 12, tzinfo=BRT).astimezone(timezone.utc)
SLOT_Z = SLOT.strftime("%Y-%m-%dT%H:%M:%SZ")
DIA_BR, DIA_CURTO = _DIA.strftime("%d/%m/%Y"), _DIA.strftime("%d/%m")
CFG = Config(base_url="https://growthhs.exemplo.invalid", client_id="hsg_ag",
             client_secret="segredo", list_id=22, boards_conferidos=(6, 7),
             app_url="https://app.exemplo.invalid", ambiente="homologacao")
A, B = 9301, 9302


def _brt(dia, h, m=0):
    return datetime(2026, 10, dia, h, m, tzinfo=BRT).astimezone(UTC)


@pytest.fixture(autouse=True)
def _sem_token():
    growthhs.limpar_tokens()
    yield
    growthhs.limpar_tokens()


@pytest.fixture
def falso():
    f = GrowthHSFalso()
    f.vendedores = [{"id": i, "nome": f"Vendedor {i}", "email": f"v{i}@hs.invalid",
                     "ativo": True} for i in (A, B)]
    return f


@pytest.fixture
def resend_falso(monkeypatch):
    estado = {"enviados": [], "levantar": None}

    async def segredo(nome):
        return {"RESEND_API_KEY": "re_falsa",
                "EMAIL_FROM": "MHS <a@exemplo.invalid>"}.get(nome)

    async def enviar(**kw):
        if estado["levantar"] is not None:
            raise estado["levantar"]
        estado["enviados"].append(kw)
        return f"re_teste_{len(estado['enviados'])}"

    monkeypatch.setattr(execucao.integracoes, "ler_segredo", segredo)
    monkeypatch.setattr(execucao.resend, "enviar", enviar)
    return estado


async def _reservar(cenario, falso, email=None, inicio=None) -> str:
    """Rascunho + horários + confirmação pela `reserva`; devolve o id."""
    token = await cenario.rascunho(email)
    async with Cliente(CFG, transporte=falso.transporte()) as cli:
        await reserva.horarios(token, agora=AGORA, cliente=cli)
        r = await reserva.confirmar(token, inicio or SLOT, agora=AGORA, cliente=cli)
    assert r["status"] == "reservada"
    ag_id = str((await cenario.linha(token))["id"])
    # A confirmação deixa a reserva invisível por 30 s (M3); o teste não espera.
    await _liberar(ag_id)
    return ag_id


async def _rodar(falso, ag_id):
    return await execucao.rodar_agendamentos(cfg=CFG, transporte=falso.transporte(),
                                             somente=[ag_id])


async def _linha(ag_id):
    async with db.sessao(role="service_role") as conn:
        return await conn.fetchrow("SELECT * FROM reuniao_agendamentos WHERE id = $1::uuid",
                                   ag_id)


async def _liberar(ag_id):
    """Volta a reserva adiada para a fila agora (o retry sem esperar)."""
    async with db.sessao(role="service_role") as conn:
        await conn.execute(
            "UPDATE reuniao_agendamentos SET visivel_em = now() WHERE id = $1::uuid", ag_id)


async def test_cria_card_28_com_vendedor_nota_tarefa_sala_e_email(cenario, falso,
                                                                   resend_falso):
    await cenario.roleta(A, B)
    ag_id = await _reservar(cenario, falso)
    assert await _rodar(falso, ag_id) == {"criadas": 1, "adiadas": 0, "falhas": 0}
    linha = await _linha(ag_id)
    assert linha["status"] == "criada" and linha["email_vendedor_em"] is not None
    card = falso.cards[linha["card_id"]]
    assert card["list_id"] == 28 and card["assigned_to_id"] == A
    assert card["acquisition_channel"] == "Inbound"
    assert f"Pedido MarketingHS: {ag_id}" in card["description"]
    nota = falso.notas[0]["content"]
    assert nota.startswith(f"Reunião agendada pelo lead: {DIA_BR} às 12:00 (Brasília), 60 min.")
    tarefa = falso.tarefas[linha["task_id"]]
    assert tarefa["task_type"] == "meeting" and tarefa["meeting_kind"] == "apresentacao_phoebus"
    assert tarefa["assigned_to_id"] == A and tarefa["due_date"] == SLOT_Z
    assert tarefa["duration_minutes"] == 60 and tarefa["invited_emails"] == [linha["email"]]
    assert falso.salas == [linha["task_id"]] and linha["public_link"]
    (email,) = resend_falso["enviados"]
    assert email["para"] == f"v{A}@hs.invalid"
    assert email["assunto"] == f"Reunião agendada: Acme <b> — {DIA_CURTO} às 12:00"
    assert "https://app.exemplo.invalid/cards/" in email["html"]
    # Nada a fazer na passada seguinte.
    assert await _rodar(falso, ag_id) == {"criadas": 0, "adiadas": 0, "falhas": 0}


async def test_card_existente_recebe_nota_e_reuniao_sem_card_novo(cenario, falso,
                                                                  resend_falso):
    await cenario.roleta(A, B)
    email = cenario.email("existente")
    pessoa = falso.pessoa(email=email)
    card = falso.card(pessoa)
    falso.cards[card]["assigned_to_id"] = B
    ag_id = await _reservar(cenario, falso, email)
    await _rodar(falso, ag_id)
    linha = await _linha(ag_id)
    assert linha["status"] == "criada" and linha["card_id"] == card
    assert falso.de("POST", CARDS) == [] and falso.puts() == []
    assert falso.tarefas[linha["task_id"]]["card_id"] == card
    assert falso.tarefas[linha["task_id"]]["assigned_to_id"] == B


async def test_card_existente_sem_vendedor_ganha_o_da_roleta(cenario, falso, resend_falso):
    await cenario.roleta(A, B)
    email = cenario.email("semvendedor")
    card = falso.card(falso.pessoa(email=email))
    ag_id = await _reservar(cenario, falso, email)
    await _rodar(falso, ag_id)
    assert falso.cards[card]["assigned_to_id"] == A
    assert falso.de("POST", CARDS) == []


async def test_201_perdido_no_card_nao_duplica(cenario, falso, resend_falso):
    await cenario.roleta(A)
    ag_id = await _reservar(cenario, falso)
    falso.perder[("POST", CARDS)] = 1
    assert (await _rodar(falso, ag_id))["adiadas"] == 1
    assert (await _linha(ag_id))["card_id"] is None
    await _liberar(ag_id)
    assert (await _rodar(falso, ag_id))["criadas"] == 1
    assert len(falso.de("POST", CARDS)) == 1
    assert (await _linha(ag_id))["card_id"] in falso.cards


async def test_falha_na_sala_retoma_da_sala(cenario, falso, resend_falso):
    await cenario.roleta(A)
    ag_id = await _reservar(cenario, falso)
    falso.forcar[("POST", TAREFAS + "/")] = [httpx.Response(503, json={"detail": "Graph"})]
    assert (await _rodar(falso, ag_id))["adiadas"] == 1
    linha = await _linha(ag_id)
    assert linha["status"] == "reservada" and linha["task_id"] and linha["public_link"] is None
    await _liberar(ag_id)
    assert (await _rodar(falso, ag_id))["criadas"] == 1
    assert len(falso.de("POST", CARDS)) == 1 and len(falso.tarefas) == 1
    assert len(falso.notas) == 1


async def test_convite_cortado_falha_e_alerta(cenario, falso, resend_falso):
    await cenario.roleta(A)
    ag_id = await _reservar(cenario, falso)
    falso.convidados_removidos = 1
    assert (await _rodar(falso, ag_id))["falhas"] == 1
    linha = await _linha(ag_id)
    assert linha["status"] == "falhou" and "convite cortado" in linha["erro"]
    assert linha["alerta_em"] is not None and linha["public_link"]
    alertas = [e for e in resend_falso["enviados"] if "Agendamento com falha" in e["assunto"]]
    assert alertas and all(e["para"] != f"v{A}@hs.invalid" for e in alertas)


async def test_falhou_continua_bloqueando_o_horario(cenario, falso, resend_falso):
    await cenario.roleta(A)
    ag_id = await _reservar(cenario, falso)
    falso.forcar[("POST", CARDS)] = [httpx.Response(422, json={"detail": "x"})]
    assert (await _rodar(falso, ag_id))["falhas"] == 1
    assert (await _linha(ag_id))["status"] == "falhou"
    token = await cenario.rascunho()
    async with Cliente(CFG, transporte=falso.transporte()) as cli:
        h = await reserva.horarios(token, agora=AGORA, cliente=cli)
        assert SLOT_Z not in [x for d in h["dias"] for x in d["horarios"]]
        assert await reserva.confirmar(token, SLOT, agora=AGORA, cliente=cli) == {
            "status": "ocupado"}


def test_email_do_vendedor_escapa_html():
    ag = {"inicio": _brt(29, 12), "fim": _brt(29, 13), "email": "x@exemplo.invalid",
          "page_slug": "phoebus", "public_link": "https://g/s/1",
          "dados": {"colunas": {"nome": "<script>alert(1)</script>", "empresa": "A&B",
                                "funcionarios": "401 a 1.000"},
                    "extras": {"filiais": "2 a 5", "testes_por_dia": "<img src=x>"}}}
    lead = {"nome": "<script>alert(1)</script>", "empresa": "A&B\nLead score: 100",
            "email": "x@exemplo.invalid", "whatsapp": "+5581999990000"}
    assunto, corpo, texto = execucao.montar_email_vendedor(
        ag, lead, "https://app/cards/1\"><script>")
    assert assunto == "Reunião agendada: A&B Lead score: 100 — 29/10 às 12:00"
    assert "<script>" not in corpo and "<img" not in corpo
    assert "&lt;script&gt;" in corpo and "A&amp;B" in corpo
    assert "quinta-feira, 29/10/2026 às 12:00 (Brasília), 60 min" in corpo
    assert "Abrir no GrowthHS" in corpo and "2 a 5" in corpo and "phoebus" in corpo
    assert "Filiais: 2 a 5" in texto and "testes_por_dia: <img src=x>" in texto


ROTULO_TESTES = "Quantas pessoas passariam pelo teste por dia?"


def test_email_do_vendedor_usa_o_rotulo_do_campo_extra():
    """Ajuste da homologação (28/10): o vendedor lia `testes_por_dia`. Com a
    definição na config da página, vai o rótulo; sem ela, a chave."""
    ag = {"inicio": _brt(29, 12), "fim": _brt(29, 13), "email": "x@exemplo.invalid",
          "page_slug": "phoebus",
          "dados": {"colunas": {"nome": "Joana"},
                    "extras": {"testes_por_dia": "<b>40</b>", "outro": "sem definição"}}}
    _, corpo, texto = execucao.montar_email_vendedor(
        ag, {"email": "x@exemplo.invalid"}, None,
        rotulos={"testes_por_dia": ROTULO_TESTES})
    assert f"{ROTULO_TESTES}: <b>40</b>" in texto
    assert "testes_por_dia" not in texto and "testes_por_dia" not in corpo
    assert "outro: sem definição" in texto
    assert "&lt;b&gt;40&lt;/b&gt;" in corpo


def test_rotulos_da_config_da_pagina():
    from agendamento_banco import config_da_pagina
    config = config_da_pagina()
    config["campos"].append({"chave": "testes_por_dia", "rotulo": ROTULO_TESTES,
                             "tipo": "texto", "obrigatorio": False})
    rotulos = execucao.rotulos_dos_campos(config)
    assert rotulos["testes_por_dia"] == ROTULO_TESTES
    assert rotulos["filiais"] == "Quantas filiais?"
    assert execucao.rotulos_dos_campos(None).get("testes_por_dia") is None


def test_nota_so_acrescenta_o_que_a_nota_padrao_nao_mostra():
    ag = {"inicio": _brt(29, 12), "fim": _brt(29, 13), "email": "x@exemplo.invalid",
          "_rotulos": {"filiais": "Quantas filiais?", "novo": "Pergunta nova?"},
          "dados": {"colunas": {"empresa": "Acme"},
                    "extras": {"filiais": "2 a 5", "novo": "sim", "utm_source": "g"}}}
    lead = {"id": "x", "empresa": "Acme", "campos_extras": {"filiais": "2 a 5"}}
    nota = execucao._nota(ag, lead, None, None)
    assert nota[0].startswith("Reunião agendada pelo lead: 29/10/2026 às 12:00")
    texto = "\n".join(nota)
    assert texto.count("2 a 5") == 1 and "- Quantas filiais?: 2 a 5" in texto
    assert nota[-1] == "- Pergunta nova?: sim"
    assert "Filiais: 2 a 5" not in texto and "utm_source" not in texto


async def test_nota_e_email_com_rotulo_e_sem_filiais_repetida(cenario, falso, resend_falso):
    """A nota do card mostrava a chave do campo extra e repetia "Filiais: 2 a
    5" no fim (já estava em "Respostas do formulário")."""
    from agendamento_banco import DADOS_COMPLETOS, config_da_pagina
    config = config_da_pagina()
    config["campos"].append({"chave": "testes_por_dia", "rotulo": ROTULO_TESTES,
                             "tipo": "texto", "obrigatorio": False})
    await cenario.trocar_config(config)
    await cenario.roleta(A)
    dados = {"colunas": dict(DADOS_COMPLETOS["colunas"]),
             "extras": {"filiais": "2 a 5", "testes_por_dia": "40"}}
    token = await cenario.rascunho(dados=dados)
    async with Cliente(CFG, transporte=falso.transporte()) as cli:
        await reserva.horarios(token, agora=AGORA, cliente=cli)
        r = await reserva.confirmar(token, SLOT, agora=AGORA, cliente=cli)
    assert r["status"] == "reservada"
    ag_id = str((await cenario.linha(token))["id"])
    await _liberar(ag_id)
    assert (await _rodar(falso, ag_id))["criadas"] == 1
    nota = falso.notas[0]["content"]
    assert nota.startswith(f"Reunião agendada pelo lead: {DIA_BR} às 12:00")
    assert f"{ROTULO_TESTES}: 40" in nota and "testes_por_dia" not in nota
    assert nota.count("2 a 5") == 1 and "Quantas filiais?: 2 a 5" in nota
    assert "Filiais: 2 a 5" not in nota
    (email,) = resend_falso["enviados"]
    assert f"{ROTULO_TESTES}: 40" in email["texto"] and "testes_por_dia" not in email["texto"]


async def test_alerta_nao_repete(cenario, falso, resend_falso):
    await cenario.roleta(A)
    ag_id = await _reservar(cenario, falso)
    ag = dict(await _linha(ag_id))
    await execucao.alertar_admins(ag, "motivo 1")
    n = len(resend_falso["enviados"])
    assert n >= 1
    await execucao.alertar_admins(ag, "motivo 2")
    await execucao.alertar_admins(dict(await _linha(ag_id)), "motivo 3")
    assert len(resend_falso["enviados"]) == n


async def test_resend_fora_adia_so_o_email(cenario, falso, resend_falso):
    await cenario.roleta(A)
    ag_id = await _reservar(cenario, falso)
    resend_falso["levantar"] = RuntimeError("fora")
    assert (await _rodar(falso, ag_id))["adiadas"] == 1
    linha = await _linha(ag_id)
    assert linha["public_link"] and linha["email_vendedor_em"] is None
    resend_falso["levantar"] = None
    await _liberar(ag_id)
    assert (await _rodar(falso, ag_id))["criadas"] == 1
    assert len(falso.salas) == 1 and len(resend_falso["enviados"]) == 1


async def test_worker_sem_somente_nao_pega_agendamento_de_teste(cenario, falso,
                                                               resend_falso):
    await cenario.roleta(A)
    ag_id = await _reservar(cenario, falso)
    r = await execucao.rodar_agendamentos(cfg=CFG, transporte=falso.transporte())
    assert r.get("criadas", 0) == 0
    assert (await _linha(ag_id))["status"] == "reservada"


async def test_varrer_rascunho_de_31_min_vira_lead_comum(cenario):
    velho, novo = await cenario.rascunho(), await cenario.rascunho()
    async with db.sessao(role="service_role") as conn:
        await conn.execute(
            "UPDATE reuniao_agendamentos SET criado_em = now() - interval '31 minutes', "
            "atualizado_em = now() - interval '31 minutes' WHERE token = $1", velho)
        # Criado há muito, mas mexido agora (o lead está na etapa 3): fica.
        await conn.execute(
            "UPDATE reuniao_agendamentos SET criado_em = now() - interval '2 hours' "
            "WHERE token = $1", novo)
    r = await execucao.varrer(datetime.now(UTC), somente_paginas=[cenario.slug])
    assert r["lead_comum"] == 1
    assert (await cenario.linha(velho))["status"] == "lead_comum"
    assert (await cenario.linha(novo))["status"] == "rascunho"


async def test_varrer_reuniao_passada_vira_realizada(cenario, falso):
    await cenario.roleta(A)
    ag_id = await _reservar(cenario, falso)
    async with db.sessao(role="service_role") as conn:
        await conn.execute(
            "UPDATE reuniao_agendamentos SET status = 'criada' WHERE id = $1::uuid", ag_id)
    r = await execucao.varrer(SLOT + timedelta(minutes=61), somente_paginas=[cenario.slug])
    assert r["realizadas"] == 1
    assert (await _linha(ag_id))["status"] == "realizada"
    # Saiu dos índices: o mesmo e-mail pode agendar de novo.
    r2 = await execucao.varrer(SLOT - timedelta(days=1),
                               somente_paginas=[cenario.slug])
    assert r2["realizadas"] == 0



# ── Revisão final da branch (28/10) ──────────────────────────────────────────

async def _alertas(resend_falso):
    return [e for e in resend_falso["enviados"] if "Agendamento" in e["assunto"]]


async def test_c1_card_aberto_criado_depois_da_reserva_e_usado(cenario, falso, resend_falso):
    """Outro handoff (a jornada da captura normal, uma regra) criou o card A
    entre a reserva e a execução: a execução usa A, não cria B. O dono de A é
    outro vendedor: o card não muda de dono, a reunião fica com o da reserva,
    a nota diz isso e os admins são avisados."""
    await cenario.roleta(A)
    email = cenario.email("paralelo")
    ag_id = await _reservar(cenario, falso, email)
    card_a = falso.card(falso.pessoa(email=email))
    falso.cards[card_a]["assigned_to_id"] = B
    assert (await _rodar(falso, ag_id))["criadas"] == 1
    linha = await _linha(ag_id)
    assert linha["card_id"] == card_a
    assert falso.de("POST", CARDS) == []
    assert falso.cards[card_a]["assigned_to_id"] == B          # dono não trocado
    assert falso.tarefas[linha["task_id"]]["assigned_to_id"] == A
    nota = falso.notas[0]["content"]
    assert f"com Vendedor {A}; o card é de Vendedor {B}" in nota
    alertas = await _alertas(resend_falso)
    assert len(alertas) == 1 and "o card é de" in alertas[0]["html"]


async def test_c1_card_aberto_sem_vendedor_ganha_o_da_reserva(cenario, falso, resend_falso):
    await cenario.roleta(A)
    email = cenario.email("paralelo2")
    ag_id = await _reservar(cenario, falso, email)
    card_a = falso.card(falso.pessoa(email=email))
    await _rodar(falso, ag_id)
    assert (await _linha(ag_id))["card_id"] == card_a
    assert falso.cards[card_a]["assigned_to_id"] == A
    assert falso.de("POST", CARDS) == [] and await _alertas(resend_falso) == []


async def test_m7_card_existente_ganho_cai_no_card_novo(cenario, falso, resend_falso):
    await cenario.roleta(A)
    email = cenario.email("ganho")
    antigo = falso.card(falso.pessoa(email=email))
    falso.cards[antigo]["assigned_to_id"] = A
    ag_id = await _reservar(cenario, falso, email)
    assert (await _linha(ag_id))["card_existente_id"] == antigo
    falso.cards[antigo]["is_won"] = True
    assert (await _rodar(falso, ag_id))["criadas"] == 1
    linha = await _linha(ag_id)
    assert linha["card_id"] != antigo and len(falso.de("POST", CARDS)) == 1
    assert falso.cards[linha["card_id"]]["assigned_to_id"] == A


async def test_m7_card_existente_sumido_cai_no_card_novo(cenario, falso, resend_falso):
    await cenario.roleta(A)
    email = cenario.email("sumido")
    antigo = falso.card(falso.pessoa(email=email))
    falso.cards[antigo]["assigned_to_id"] = A
    ag_id = await _reservar(cenario, falso, email)
    del falso.cards[antigo]
    assert (await _rodar(falso, ag_id))["criadas"] == 1
    assert len(falso.de("POST", CARDS)) == 1


async def test_i2_reuniao_que_ja_passou_nao_e_criada(cenario, falso, resend_falso):
    await cenario.roleta(A)
    ag_id = await _reservar(cenario, falso)
    async with db.sessao(role="service_role") as conn:
        await conn.execute(
            "UPDATE reuniao_agendamentos SET inicio = now() - interval '1 hour', "
            "fim = now() WHERE id = $1::uuid", ag_id)
    falso.pedidos.clear()
    assert (await _rodar(falso, ag_id))["falhas"] == 1
    linha = await _linha(ag_id)
    assert linha["status"] == "falhou" and "antes do horário" in linha["erro"]
    assert falso.pedidos == [] and falso.tarefas == {} and falso.salas == []
    assert len(await _alertas(resend_falso)) == 1
    assert all("Reunião agendada" not in e["assunto"] for e in resend_falso["enviados"])


async def test_i2_segunda_falha_alerta_e_continua_tentando(cenario, falso, resend_falso):
    await cenario.roleta(A)
    ag_id = await _reservar(cenario, falso)
    falso.forcar[("POST", TAREFAS + "/")] = [httpx.Response(503, json={"detail": "x"})] * 2
    assert (await _rodar(falso, ag_id))["adiadas"] == 1
    assert await _alertas(resend_falso) == []                  # 1ª falha, longe do horário
    await _liberar(ag_id)
    assert (await _rodar(falso, ag_id))["adiadas"] == 1
    assert len(await _alertas(resend_falso)) == 1              # 2ª seguida: avisa
    linha = await _linha(ag_id)
    assert linha["status"] == "reservada" and linha["alerta_em"] is not None
    await _liberar(ag_id)
    assert (await _rodar(falso, ag_id))["criadas"] == 1
    assert len(await _alertas(resend_falso)) == 1              # uma vez só


async def test_i2_perto_do_horario_alerta_na_primeira_falha(cenario, falso, resend_falso):
    await cenario.roleta(A)
    ag_id = await _reservar(cenario, falso)
    async with db.sessao(role="service_role") as conn:
        await conn.execute(
            "UPDATE reuniao_agendamentos SET inicio = now() + interval '2 hours', "
            "fim = now() + interval '3 hours' WHERE id = $1::uuid", ag_id)
    falso.forcar[("POST", TAREFAS + "/")] = [httpx.Response(503, json={"detail": "x"})]
    assert (await _rodar(falso, ag_id))["adiadas"] == 1
    assert len(await _alertas(resend_falso)) == 1
    assert (await _linha(ag_id))["status"] == "reservada"


async def test_titulo_da_tarefa_cortado(cenario, falso, resend_falso):
    await cenario.roleta(A)
    token = await cenario.rascunho(dados={"colunas": {
        "nome": "N" * 400, "empresa": "E" * 400, "funcionarios": "401 a 1.000",
        "whatsapp": "+5581999990000", "cargo": "x"}})
    async with Cliente(CFG, transporte=falso.transporte()) as cli:
        await reserva.horarios(token, agora=AGORA, cliente=cli)
        assert (await reserva.confirmar(token, SLOT, agora=AGORA, cliente=cli))["status"] \
            == "reservada"
    ag_id = str((await cenario.linha(token))["id"])
    await _liberar(ag_id)
    await _rodar(falso, ag_id)
    tarefa = next(iter(falso.tarefas.values()))
    assert len(tarefa["title"]) <= 255
    assert len(falso.cards[(await _linha(ag_id))["card_id"]]["title"]) <= growthhs.MAX_TITULO
