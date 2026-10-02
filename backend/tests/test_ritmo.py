"""O controle de volume do worker (R1, 02/10/2026). Sem banco.

Domínio novo + disparo para a base inteira no dia 1 é o pior cenário de
reputação. O worker passa a respeitar: envios por segundo, teto por hora, teto
por dia e a rampa de aquecimento (dia 1 = 50, dobra por dia até o teto). O que
excede o teto fica NA FILA — a cota limita o que se reivindica, nada vira
'failed'.
"""

from datetime import date

import httpx
import pytest

from app import ritmo
from app.email import resend


R = ritmo.Ritmo(por_segundo=2.0, teto_hora=500, teto_dia=2000,
                aquecimento_dia1=50, aquecimento_inicio=None)


# ── A rampa ──────────────────────────────────────────────────────────────────

def test_rampa_dobra_por_dia_a_partir_do_primeiro_envio():
    inicio = date(2026, 10, 2)
    tetos = [ritmo.teto_de_hoje(R, date(2026, 10, 2 + n), inicio) for n in range(8)]
    assert tetos == [50, 100, 200, 400, 800, 1600, 2000, 2000]


def test_sem_envio_nenhum_hoje_e_o_dia_1():
    assert ritmo.teto_de_hoje(R, date(2026, 10, 2), None) == 50


def test_inicio_configurado_vence_o_primeiro_envio():
    r = ritmo.Ritmo(**{**R.__dict__, "aquecimento_inicio": date(2026, 10, 1)})
    # Primeiro envio em setembro, mas o domínio novo começou em 01/10.
    assert ritmo.teto_de_hoje(r, date(2026, 10, 2), date(2026, 9, 1)) == 100


def test_aquecimento_zero_desliga_a_rampa():
    r = ritmo.Ritmo(**{**R.__dict__, "aquecimento_dia1": 0})
    assert ritmo.teto_de_hoje(r, date(2026, 10, 2), None) == 2000


def test_rampa_nao_estoura_em_dias_demais():
    # 2 ** 400 não pode virar problema: o teto do dia corta.
    assert ritmo.teto_de_hoje(R, date(2027, 11, 6), date(2026, 10, 2)) == 2000


# ── A cota da passada ────────────────────────────────────────────────────────

def test_cota_e_o_menor_dos_limites():
    hoje, inicio = date(2026, 10, 2), date(2026, 10, 2)
    # Dia 1 = 50, já foram 45: sobram 5, mesmo com lote de 20.
    assert ritmo.cota(R, hoje, inicio, enviados_hora=45, enviados_dia=45,
                      lote=20, visibilidade=120) == 5
    # Teto da hora no limite.
    r = ritmo.Ritmo(**{**R.__dict__, "aquecimento_dia1": 0})
    assert ritmo.cota(r, hoje, inicio, enviados_hora=498, enviados_dia=600,
                      lote=20, visibilidade=120) == 2
    # Nada atingido: o lote.
    assert ritmo.cota(r, hoje, inicio, enviados_hora=0, enviados_dia=0,
                      lote=20, visibilidade=120) == 20


def test_cota_estourada_e_zero_nunca_negativa():
    hoje = date(2026, 10, 2)
    assert ritmo.cota(R, hoje, hoje, enviados_hora=80, enviados_dia=80,
                      lote=20, visibilidade=120) == 0


def test_cota_cabe_na_visibilidade():
    """Com ritmo lento, o lote inteiro não pode demorar mais que a
    visibilidade — senão a mensagem reaparece na fila enquanto ainda está
    sendo enviada."""
    r = ritmo.Ritmo(**{**R.__dict__, "por_segundo": 0.1, "aquecimento_dia1": 0})
    hoje = date(2026, 10, 2)
    # 120 s × 0,1/s = 12 envios; com folga de metade, 6.
    assert ritmo.cota(r, hoje, hoje, enviados_hora=0, enviados_dia=0,
                      lote=20, visibilidade=120) == 6


# ── A leitura da configuração ────────────────────────────────────────────────

def test_configuracao_invalida_cai_no_padrao():
    r = ritmo.montar({"ENVIO_POR_SEGUNDO": "abc", "ENVIO_TETO_DIA": "-5",
                      "ENVIO_TETO_HORA": "300",
                      "ENVIO_AQUECIMENTO_INICIO": "02/10/2026"})
    assert r.por_segundo == ritmo.PADRAO.por_segundo
    assert r.teto_dia == ritmo.PADRAO.teto_dia
    assert r.teto_hora == 300
    assert r.aquecimento_inicio is None


def test_configuracao_valida():
    r = ritmo.montar({"ENVIO_POR_SEGUNDO": "1.5",
                      "ENVIO_AQUECIMENTO_INICIO": "2026-10-05",
                      "ENVIO_AQUECIMENTO_DIA1": "0"})
    assert r.por_segundo == 1.5
    assert r.aquecimento_inicio == date(2026, 10, 5)
    assert r.aquecimento_dia1 == 0


# ── O compasso (envios por segundo) ──────────────────────────────────────────

class Relogio:
    def __init__(self):
        self.agora = 100.0
        self.dormidas = []

    def __call__(self):
        return self.agora

    async def dormir(self, s):
        self.dormidas.append(round(s, 6))
        self.agora += s


async def test_compasso_espaca_os_envios():
    rel = Relogio()
    c = ritmo.Compasso(relogio=rel, dormir=rel.dormir)
    for _ in range(4):
        await c.esperar_vez(por_segundo=2.0)
    # O primeiro sai na hora; os outros, a cada 0,5 s.
    assert rel.dormidas == [0.5, 0.5, 0.5]
    assert rel.agora == pytest.approx(101.5)


async def test_compasso_nao_acumula_credito_parado():
    """Ficar 10 s ocioso não dá direito a uma rajada de 20 envios."""
    rel = Relogio()
    c = ritmo.Compasso(relogio=rel, dormir=rel.dormir)
    await c.esperar_vez(por_segundo=2.0)
    rel.agora += 10
    await c.esperar_vez(por_segundo=2.0)
    await c.esperar_vez(por_segundo=2.0)
    assert rel.dormidas == [0.5]


async def test_compasso_segurado_pelo_retry_after():
    rel = Relogio()
    c = ritmo.Compasso(relogio=rel, dormir=rel.dormir)
    c.segurar(30)
    assert c.segurado()
    assert c.restante() == pytest.approx(30)
    rel.agora += 30
    assert not c.segurado()


# ── O 429 do Resend ──────────────────────────────────────────────────────────

def _resposta(codigo, cabecalhos=None, corpo=None):
    return httpx.Response(codigo, headers=cabecalhos or {}, json=corpo or {},
                          request=httpx.Request("POST", resend.API))


def test_429_vira_limite_com_retry_after():
    with pytest.raises(resend.LimiteDoResend) as e:
        resend.interpretar_envio(_resposta(429, {"retry-after": "7"}))
    assert e.value.espera == 7


def test_429_sem_retry_after_espera_um_segundo():
    with pytest.raises(resend.LimiteDoResend) as e:
        resend.interpretar_envio(_resposta(429))
    assert e.value.espera == 1


def test_429_com_retry_after_absurdo_e_limitado():
    with pytest.raises(resend.LimiteDoResend) as e:
        resend.interpretar_envio(_resposta(429, {"retry-after": "999999"}))
    assert e.value.espera == resend.ESPERA_MAXIMA


def test_outro_erro_continua_levantando_http():
    with pytest.raises(httpx.HTTPStatusError):
        resend.interpretar_envio(_resposta(422))


def test_sucesso_devolve_o_id():
    assert resend.interpretar_envio(_resposta(200, corpo={"id": "re_1"})) == "re_1"


# ── A medição (único teste com banco; transação revertida) ───────────────────

@pytest.mark.trava_global
async def test_medir_conta_o_que_saiu_pelo_resend(conexao, semear):
    antes = await ritmo.medir(conexao)
    [msg] = await semear(quantidade=1)
    # Pendente e suprimido não contam; só o que tem id do Resend.
    assert (await ritmo.medir(conexao)).enviados_dia == antes.enviados_dia
    await conexao.execute(
        "UPDATE campaign_sends SET status = 'delivered', sent_at = now(), "
        "resend_email_id = 're_teste_ritmo' WHERE id = $1::uuid", msg["send_id"])
    depois = await ritmo.medir(conexao)
    assert depois.enviados_dia == antes.enviados_dia + 1
    assert depois.enviados_hora == antes.enviados_hora + 1
    assert depois.hoje == antes.hoje
