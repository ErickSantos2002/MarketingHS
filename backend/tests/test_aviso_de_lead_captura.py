"""Aviso de lead (frente aviso-de-lead, Task 1): a migration 038, a
configuração e o enfileirar no fim de `registrar_captura`.

Os de BANCO rodam na transação revertida da fixture `conexao` e pulam sem a
038 aplicada. ⚠️ `ler_config` abre outra sessão (lê segredo), por isso os
testes a trocam por um falso — nada de segredo real.
"""

import pathlib
import re
import uuid

import pytest

from app.avisos import config as config_aviso
from app.avisos import fila
from app.avisos.config import PARA_PADRAO, ConfigAviso, separar_enderecos
from app.captura.registro import Origem, registrar_captura

LER_CONFIG_REAL = config_aviso.ler_config  # a autouse abaixo a troca nos outros testes
ARQUIVO = (pathlib.Path(__file__).resolve().parent.parent
           / "migrations" / "038_avisos_de_lead.sql")


# ── Texto da migration e configuração (sem banco) ────────────────────────────

def test_038_reaplicavel():
    sql = re.sub(r"--[^\n]*", "", ARQUIVO.read_text(encoding="utf-8"))
    assert "CREATE EXTENSION" not in sql
    assert not re.search(r"CREATE TABLE (?!IF NOT EXISTS)", sql)
    assert not re.search(r"CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)", sql)
    assert not re.search(r"CREATE POLICY", sql)
    assert "ENABLE ROW LEVEL SECURITY" in sql
    for nome in ("uniq_campaign_sends_email_campaign_lead",
                 "uniq_campaign_sends_journey_node", "uniq_journey_runs_open"):
        assert nome not in sql


def test_separar_enderecos():
    assert separar_enderecos(" a@x.com, ,B@x.com,a@X.com ") == ["a@x.com", "B@x.com"]
    assert separar_enderecos(None) == []


@pytest.mark.asyncio
async def test_ler_config_padrao(monkeypatch):
    valores = {}

    async def falso(nome):
        return valores.get(nome)

    monkeypatch.setattr("app.integracoes.ler_segredo", falso)
    assert await LER_CONFIG_REAL() == ConfigAviso(True, PARA_PADRAO)
    assert PARA_PADRAO == ["vendas@healthsafetytech.com"]
    valores["AVISO_LEAD_LIGADO"] = "0"
    valores["AVISO_LEAD_PARA"] = "x@y.com, z@y.com"
    assert await LER_CONFIG_REAL() == ConfigAviso(False, ["x@y.com", "z@y.com"])
    valores["AVISO_LEAD_LIGADO"] = "1"
    assert (await LER_CONFIG_REAL()).ligado is True


# ── Banco (transação revertida) ──────────────────────────────────────────────

async def _ligada():
    return ConfigAviso(True, list(PARA_PADRAO))


@pytest.fixture(autouse=True)
def _config_ligada(monkeypatch):
    monkeypatch.setattr(config_aviso, "ler_config", _ligada)


async def _exigir_038(conexao):
    if await conexao.fetchval("SELECT to_regclass('public.avisos_de_lead')") is None:
        pytest.skip("migration 038 ainda não aplicada neste banco")


def _email():
    return f"aviso-{uuid.uuid4().hex[:10]}@exemplo.invalid"


async def _capturar(conexao, email, *, origem=None, **kw):
    return await registrar_captura(
        conexao, email=email, campos={"nome": "Lead Aviso"}, extras={},
        origem=origem or Origem(page_slug="aviso-pagina"), session_id=None,
        consentimento=None, tags=[], **kw)


async def _avisos(conexao, lead_id):
    # ⚠️ Em transação `now()` é fixo; `criado_em` e `visivel_em` usam o mesmo,
    # então a diferença é exatamente o atraso inicial.
    return await conexao.fetch(
        "SELECT *, visivel_em - criado_em AS espera FROM avisos_de_lead "
        "WHERE lead_id = $1::uuid ORDER BY id", lead_id)


@pytest.mark.asyncio
async def test_captura_da_landing_enfileira(conexao):
    await _exigir_038(conexao)
    lead = await _capturar(conexao, _email())
    (aviso,) = await _avisos(conexao, lead)
    assert aviso["status"] == "pendente"
    assert aviso["contato_novo"] is True and aviso["agendamento"] is False
    assert aviso["espera"].total_seconds() >= 59
    conversao = await conexao.fetchval(
        "SELECT id FROM lead_conversions WHERE lead_id = $1::uuid", lead)
    assert aviso["conversao_id"] == conversao


@pytest.mark.asyncio
async def test_conversao_do_site_enfileira(conexao):
    await _exigir_038(conexao)
    site_id = await conexao.fetchval(
        "INSERT INTO sites (nome, dominios, token) VALUES ('Sonda aviso', "
        "'{x.invalid}', 'pub_aviso_' || gen_random_uuid()) RETURNING id::text")
    lead = await _capturar(
        conexao, _email(), canal_origem="site",
        origem=Origem(site_id=site_id, form_id="contato", canal="site"))
    (aviso,) = await _avisos(conexao, lead)
    assert aviso["status"] == "pendente" and aviso["contato_novo"] is True


@pytest.mark.asyncio
async def test_agendamento_confirmado_enfileira(conexao):
    await _exigir_038(conexao)
    lead = await _capturar(conexao, _email(), agendamento=True)
    (aviso,) = await _avisos(conexao, lead)
    assert aviso["agendamento"] is True and aviso["contato_novo"] is True
    assert aviso["espera"].total_seconds() >= 59


@pytest.mark.asyncio
async def test_reconversao_enfileira_como_voltou(conexao):
    await _exigir_038(conexao)
    email = _email()
    lead = await _capturar(conexao, email)
    assert await _capturar(conexao, email) == lead
    avisos = await _avisos(conexao, lead)
    assert len(avisos) == 2
    assert sorted(a["contato_novo"] for a in avisos) == [False, True]


@pytest.mark.asyncio
async def test_desligado_nao_enfileira(conexao, monkeypatch):
    await _exigir_038(conexao)

    async def desligada():
        return ConfigAviso(False, list(PARA_PADRAO))

    monkeypatch.setattr(config_aviso, "ler_config", desligada)
    lead = await _capturar(conexao, _email())
    assert await _avisos(conexao, lead) == []


@pytest.mark.asyncio
async def test_falha_no_enfileirar_nao_derruba_captura(conexao, monkeypatch):
    await _exigir_038(conexao)
    monkeypatch.setattr(fila, "SQL_ENFILEIRAR",
                        "INSERT INTO tabela_que_nao_existe_aviso (x) VALUES ($1::uuid, "
                        "$2::uuid, $3, $4, $5)")
    lead = await _capturar(conexao, _email())
    assert lead
    assert await conexao.fetchval(
        "SELECT count(*) FROM lead_conversions WHERE lead_id = $1::uuid", lead) == 1
    assert await _avisos(conexao, lead) == []
