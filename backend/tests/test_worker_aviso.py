"""O worker sem Resend avisa UMA vez, não a cada passada (rodada 7, 02/10/2026).

Em produção, desde 02/10, o worker sem `RESEND_API_KEY` escrevia
"RESEND_API_KEY ausente" a cada 2 s, para sempre. O aviso tem de sair quando a
falta é percebida e de novo só quando o estado muda (ausente → presente →
ausente). O comportamento da fila não muda: sem a chave, nada é reivindicado.

Nenhum caminho deste teste chega ao banco: o segredo falso nunca devolve as
duas chaves ao mesmo tempo, e `fila.reivindicar` explode se for chamado.
"""

import logging

import pytest

from app import worker


@pytest.fixture
def segredos(monkeypatch):
    """Troca `ler_segredo` por um dicionário que o teste altera entre passadas."""
    valores: dict[str, str | None] = {}

    async def falso(nome):
        return valores.get(nome)

    async def proibido(*a, **k):
        raise AssertionError("o worker reivindicou a fila sem as duas chaves")

    monkeypatch.setattr(worker.integracoes, "ler_segredo", falso)
    monkeypatch.setattr(worker.fila, "reivindicar", proibido)
    monkeypatch.setattr(worker, "_ausentes", set())
    return valores


def _avisos(caplog, chave):
    return [r for r in caplog.records
            if r.name == "worker" and chave in r.getMessage()]


async def test_resend_ausente_avisa_uma_vez_e_de_novo_so_quando_muda(segredos, caplog):
    caplog.set_level(logging.INFO, logger="worker")

    for _ in range(5):
        assert await worker._tick() == 0
    ausente = _avisos(caplog, "RESEND_API_KEY")
    assert len(ausente) == 1, [r.getMessage() for r in ausente]
    assert ausente[0].levelno == logging.WARNING

    # Chegou a chave (o descadastro ainda falta: nada vai ao banco).
    caplog.clear()
    segredos["RESEND_API_KEY"] = "re_falsa"
    for _ in range(3):
        assert await worker._tick() == 0
    voltou = _avisos(caplog, "RESEND_API_KEY")
    assert len(voltou) == 1 and voltou[0].levelno == logging.INFO, \
        [r.getMessage() for r in voltou]
    # O outro segredo segue a mesma regra: um aviso, não três.
    assert len(_avisos(caplog, "UNSUBSCRIBE_SECRET")) == 1

    # Sumiu de novo: avisa de novo, uma vez.
    caplog.clear()
    del segredos["RESEND_API_KEY"]
    for _ in range(4):
        assert await worker._tick() == 0
    de_novo = _avisos(caplog, "RESEND_API_KEY")
    assert len(de_novo) == 1 and de_novo[0].levelno == logging.WARNING, \
        [r.getMessage() for r in de_novo]
