"""O `_tick` com controle de volume (R1, 02/10/2026). Sem banco e sem rede.

A sessão, a fila, a medição e o envio são todos falsos: nenhum caminho deste
arquivo fala com o Postgres nem com o Resend. Um teste de worker não pode
enfileirar e-mail de verdade para endereço de verdade.
"""

import contextlib
from datetime import date

import pytest

from app import fila, ritmo, worker
from app.email import resend


class Conn:
    """Conexão falsa: só o que `_processar` pergunta no caminho da pausa."""

    def __init__(self, envio=None):
        self.envio = envio
        self.execs = []

    async def fetchrow(self, sql, *a):
        return self.envio

    async def fetchval(self, sql, *a):
        return None

    async def execute(self, sql, *a):
        self.execs.append((sql, a))


def _msg(n):
    return fila.Mensagem(fila_id=n, send_id=f"s{n}", campaign_id=None,
                         lead_id=f"l{n}", tentativas=1)


@pytest.fixture
def mundo(monkeypatch):
    estado = {"reivindicar": [], "adiados": [], "devolvidos": [], "processados": [],
              "uso": ritmo.Uso(hoje=date(2026, 10, 2), enviados_hora=0,
                               enviados_dia=0, primeiro_dia=date(2026, 10, 2)),
              "fila": [_msg(1), _msg(2), _msg(3)], "falha_em": None,
              "ha_pronta": True}

    async def segredo(nome):
        return {"RESEND_API_KEY": "re_falsa", "UNSUBSCRIBE_SECRET": "x",
                "EMAIL_FROM": "a@exemplo.invalid"}.get(nome)

    @contextlib.asynccontextmanager
    async def sessao(**_):
        yield Conn()

    async def ha_pronta(conn):
        return estado["ha_pronta"]

    async def medir(conn):
        return estado["uso"]

    async def reivindicar(conn, limite, visibilidade):
        estado["reivindicar"].append(limite)
        return estado["fila"][:limite]

    async def adiar(conn, fila_id, segundos):
        estado["adiados"].append((fila_id, segundos))

    async def devolver(conn, fila_id, erro, max_tentativas):
        estado["devolvidos"].append(fila_id)
        return "reagendada"

    async def processar(conn, m, chave, de, segredo, por_segundo):
        if estado["falha_em"] == m.fila_id:
            raise resend.LimiteDoResend(12)
        estado["processados"].append(m.fila_id)

    async def ler_ritmo():
        return ritmo.Ritmo()

    monkeypatch.setattr(worker.integracoes, "ler_segredo", segredo)
    monkeypatch.setattr(worker, "sessao", sessao)
    monkeypatch.setattr(worker.fila, "ha_pronta", ha_pronta)
    monkeypatch.setattr(worker.fila, "reivindicar", reivindicar)
    monkeypatch.setattr(worker.fila, "adiar", adiar)
    monkeypatch.setattr(worker.fila, "devolver", devolver)
    monkeypatch.setattr(worker.ritmo, "medir", medir)
    monkeypatch.setattr(worker.ritmo, "ler", ler_ritmo)
    monkeypatch.setattr(worker, "_processar", processar)
    monkeypatch.setattr(worker, "_compasso", ritmo.Compasso())
    monkeypatch.setattr(worker, "_ausentes", set())
    monkeypatch.setattr(worker, "_no_teto", False)
    return estado


async def test_teto_do_dia_atingido_nao_reivindica_nada(mundo):
    # Dia 1 da rampa = 50; já saíram 50 hoje.
    mundo["uso"] = ritmo.Uso(hoje=date(2026, 10, 2), enviados_hora=50,
                             enviados_dia=50, primeiro_dia=date(2026, 10, 2))
    assert await worker._tick() == 0
    # Nada reivindicado = nada some da fila nem vira 'failed'. Amanhã sai.
    assert mundo["reivindicar"] == []


async def test_reivindica_so_a_cota(mundo):
    mundo["uso"] = ritmo.Uso(hoje=date(2026, 10, 2), enviados_hora=48,
                             enviados_dia=48, primeiro_dia=date(2026, 10, 2))
    assert await worker._tick() == 2
    assert mundo["reivindicar"] == [2]
    assert mundo["processados"] == [1, 2]


async def test_fila_vazia_nem_mede(mundo, monkeypatch):
    mundo["ha_pronta"] = False

    async def proibido(conn):
        raise AssertionError("mediu com a fila vazia")

    monkeypatch.setattr(worker.ritmo, "medir", proibido)
    assert await worker._tick() == 0
    assert mundo["reivindicar"] == []


async def test_429_adia_o_resto_sem_gastar_tentativa(mundo):
    mundo["falha_em"] = 2
    await worker._tick()
    assert mundo["processados"] == [1]
    # A que levou 429 e as que vinham atrás voltam para a fila pelo `adiar`
    # (sem contar tentativa), com a espera do `retry-after`.
    assert mundo["adiados"] == [(2, 12), (3, 12)]
    assert mundo["devolvidos"] == []
    assert worker._compasso.segurado()


async def test_segurado_pelo_429_nao_reivindica(mundo):
    worker._compasso.segurar(30)
    assert await worker._tick() == 0
    assert mundo["reivindicar"] == []


async def test_campanha_pausada_no_meio_do_lote_volta_para_a_fila(monkeypatch):
    """Reivindicada antes da pausa, processada depois: não envia, não falha."""
    adiados = []

    async def adiar(conn, fila_id, segundos):
        adiados.append(fila_id)

    async def enviar(**_):
        raise AssertionError("enviou e-mail de campanha pausada")

    monkeypatch.setattr(worker.fila, "adiar", adiar)
    monkeypatch.setattr(worker.resend, "enviar", enviar)
    conn = Conn(envio={"status": "pending", "journey_node_id": None,
                       "journey_run_id": None, "campanha": "paused",
                       "subject": "", "body": "", "email": "x@exemplo.invalid",
                       "nome": "", "empresa": ""})
    m = fila.Mensagem(fila_id=9, send_id="s9", campaign_id="c9", lead_id="l9",
                      tentativas=1)
    await worker._processar(conn, m, "re_falsa", "a@b", "x", 2.0)
    assert adiados == [9]
    assert conn.execs == []  # nada de 'failed'
