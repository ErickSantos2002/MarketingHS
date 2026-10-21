"""Segmento por campo personalizado (`campo_extra`, prova do RD).

O `RegraIn` de `routers/segmentos.py` só tinha field/operator/value: o
pydantic descartava `key`, e o segmento por `campo_extra` salvava e contava
sempre ZERO, sem erro (a prévia também) — o pior jeito de falhar num sistema
de marketing. O de banco roda na transação revertida da fixture `conexao`.
"""

import pytest

from app.routers.segmentos import PreviaIn, RegraIn, _regras

REGRA = {"field": "campo_extra", "key": "ja_faz_testagem", "operator": "is",
         "value": "sim"}


def test_regra_leva_a_chave_ate_o_banco():
    assert _regras([RegraIn(**REGRA)]) == [REGRA]


def test_regra_sem_chave_sai_como_antes():
    regra = {"field": "cargo", "operator": "contains", "value": "SESMT"}
    assert _regras([RegraIn(**regra)]) == [regra]


async def test_segmento_por_campo_extra_conta_o_lead(conexao):
    if not await conexao.fetchval("SELECT to_regclass('public.lead_consents') IS NOT NULL"):
        pytest.skip("migration 027 ainda não aplicada neste banco")
    lead = await conexao.fetchval(
        "INSERT INTO leads (email, tipo, campos_extras) VALUES ($1, 'teste', $2::jsonb) "
        "RETURNING id", "prova-segmento@exemplo.invalid", {"ja_faz_testagem": "sim"})
    outro = await conexao.fetchval(
        "INSERT INTO leads (email, tipo, campos_extras) VALUES ($1, 'teste', $2::jsonb) "
        "RETURNING id", "prova-segmento-nao@exemplo.invalid", {"ja_faz_testagem": "nao"})
    dados = PreviaIn(regras=[REGRA], logica="and")
    achados = {r["lead_id"] for r in await conexao.fetch(
        "SELECT lead_id FROM preview_segment_rules($1::jsonb, $2)",
        _regras(dados.regras), dados.logica)}
    assert lead in achados
    assert outro not in achados
