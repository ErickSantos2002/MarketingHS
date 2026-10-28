"""Migration 036 — agendamento de reunião (frente agendamento, 28/10/2026).

Mesmo molde da `test_migracao_028.py`:
- o de TEXTO lê o arquivo da migration e roda sem banco;
- os de BANCO rodam dentro da transação revertida da fixture `conexao` e
  PULAM enquanto a 036 não estiver aplicada no banco do pytest.

⚠️ A reaplicação DE VERDADE (o arquivo duas vezes) não cabe aqui: o
`marketinghs_app` não tem DDL. Ela foi provada com `psql -v ON_ERROR_STOP=1
-f` duas vezes no Postgres local (docs/frentes/agendamento.md).
"""

import json
import pathlib
import re

import asyncpg
import pytest

ARQUIVO = (pathlib.Path(__file__).resolve().parent.parent
           / "migrations" / "036_agendamento_reuniao.sql")


# ── Texto da migration (sem banco) ───────────────────────────────────────────

def test_036_reaplicavel():
    # Sem os comentários: o cabeçalho FALA de "CREATE TABLE / INDEX".
    sql = re.sub(r"--[^\n]*", "", ARQUIVO.read_text(encoding="utf-8"))
    assert "CREATE EXTENSION" not in sql
    assert not re.search(r"CREATE FUNCTION", sql)                    # sempre OR REPLACE
    assert not re.search(r"CREATE TABLE (?!IF NOT EXISTS)", sql)
    assert not re.search(r"CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)", sql)
    assert not re.search(r"ADD COLUMN (?!IF NOT EXISTS)", sql)
    assert not re.search(r"CREATE POLICY", sql)                      # tabelas só de máquina
    for nome in ("uniq_campaign_sends_email_campaign_lead",
                 "uniq_campaign_sends_journey_node", "uniq_journey_runs_open"):
        assert nome not in sql


# ── Banco (transação revertida) ──────────────────────────────────────────────

async def _exigir_036(conexao):
    if await conexao.fetchval("SELECT to_regclass('public.reuniao_agendamentos')") is None:
        pytest.skip("migration 036 ainda não aplicada neste banco")


async def _agendamento(conexao, *, email="a@exemplo.invalid", vendedor=19,
                       inicio="2026-10-29T15:00:00Z", status="reservada",
                       ambiente="homologacao"):
    import secrets
    from datetime import datetime
    ini = datetime.fromisoformat(inicio.replace("Z", "+00:00"))
    return await conexao.fetchval(
        """INSERT INTO reuniao_agendamentos (token, ambiente, page_slug, email, status,
                                             vendedor_id, inicio, fim)
           VALUES ($1, $2, 'teste-036', $3, $4, $5, $6::timestamptz, $6::timestamptz + interval '1 hour')
           RETURNING id""",
        secrets.token_urlsafe(12), ambiente, email, status, vendedor, ini)


async def test_um_vendedor_um_horario(conexao):
    await _exigir_036(conexao)
    await _agendamento(conexao, email="um@exemplo.invalid")
    with pytest.raises(asyncpg.UniqueViolationError):
        async with conexao.transaction():
            await _agendamento(conexao, email="dois@exemplo.invalid")
    # Outro ambiente, o mesmo id de vendedor: é outra pessoa.
    await _agendamento(conexao, email="dois@exemplo.invalid", ambiente="producao")
    # Cancelada (abandonada) não segura o horário.
    await conexao.execute(
        "UPDATE reuniao_agendamentos SET status = 'realizada' WHERE email = 'um@exemplo.invalid'")
    await _agendamento(conexao, email="tres@exemplo.invalid")


async def test_uma_reserva_por_email(conexao):
    await _exigir_036(conexao)
    await _agendamento(conexao, email="mesmo@exemplo.invalid", vendedor=1)
    with pytest.raises(asyncpg.UniqueViolationError):
        async with conexao.transaction():
            await _agendamento(conexao, email="mesmo@exemplo.invalid", vendedor=2)
    # Rascunho e abandonada não contam.
    await _agendamento(conexao, email="mesmo@exemplo.invalid", vendedor=3, status="abandonada")
    await _agendamento(conexao, email="mesmo@exemplo.invalid", vendedor=4, status="rascunho")


async def test_falhou_continua_no_indice(conexao):
    await _exigir_036(conexao)
    await _agendamento(conexao, email="f@exemplo.invalid", status="falhou")
    with pytest.raises(asyncpg.UniqueViolationError):
        async with conexao.transaction():
            await _agendamento(conexao, email="g@exemplo.invalid")


async def _jornada(conexao, nome, nos):
    return await conexao.fetchval(
        """INSERT INTO journeys (name, status, entry_type, entry_config,
                                 entry_node_id, nodes)
           VALUES ($1, 'active', 'event', $2::jsonb, 'n1', $3::jsonb)
           RETURNING id::text""",
        nome, {"event_type": "form_submitted", "page_slug": "teste-036"}, nos)


HANDOFF = [{"id": "n1", "type": "handoff_growthhs", "config": {}, "next": None}]
EMAIL = [{"id": "n1", "type": "delay", "config": {"minutes": 60}, "next": None}]


async def _inserir_lead_e_matricular(conexao, email, *, agendamento: bool):
    """O caminho de verdade: INSERT do lead com a página (e a marca)
    marcadas na transação → gatilho → `journey_events` → a matrícula que o
    worker faz com o metadata do evento."""
    await conexao.execute(
        "SELECT set_config('marketinghs.page_slug', 'teste-036', true), "
        "set_config('marketinghs.agendamento', $1, true)",
        "true" if agendamento else "")
    lead = await conexao.fetchval(
        "INSERT INTO leads (email, tipo) VALUES ($1, 'teste') RETURNING id::text", email)
    await conexao.execute(
        "SELECT set_config('marketinghs.page_slug', '', true), "
        "set_config('marketinghs.agendamento', '', true)")
    eventos = await conexao.fetch(
        "SELECT event_type, metadata FROM journey_events WHERE lead_id = $1::uuid", lead)
    assert eventos
    for e in eventos:
        meta = e["metadata"] if isinstance(e["metadata"], dict) else json.loads(e["metadata"])
        await conexao.fetchval("SELECT journey_enroll_event($1::uuid, $2, $3::jsonb)",
                               lead, e["event_type"], meta)
    return lead


async def _runs(conexao, lead, jornadas):
    return {r["j"] for r in await conexao.fetch(
        "SELECT journey_id::text AS j FROM journey_runs "
        "WHERE lead_id = $1::uuid AND journey_id = ANY($2::uuid[])", lead, jornadas)}


async def test_marca_agendamento_nao_matricula_em_jornada_de_handoff(conexao):
    await _exigir_036(conexao)
    a = await _jornada(conexao, "036 — handoff", HANDOFF)
    b = await _jornada(conexao, "036 — só e-mail", EMAIL)
    lead = await _inserir_lead_e_matricular(conexao, "agendou-036@exemplo.invalid",
                                            agendamento=True)
    assert await _runs(conexao, lead, [a, b]) == {b}


async def test_sem_marca_matricula_nas_duas(conexao):
    await _exigir_036(conexao)
    a = await _jornada(conexao, "036 — handoff", HANDOFF)
    b = await _jornada(conexao, "036 — só e-mail", EMAIL)
    lead = await _inserir_lead_e_matricular(conexao, "comum-036@exemplo.invalid",
                                            agendamento=False)
    assert await _runs(conexao, lead, [a, b]) == {a, b}


async def test_reconversao_com_marca_boolean_tambem_nao(conexao):
    await _exigir_036(conexao)
    a = await _jornada(conexao, "036 — handoff", HANDOFF)
    b = await _jornada(conexao, "036 — só e-mail", EMAIL)
    lead = await conexao.fetchval(
        "INSERT INTO leads (email, tipo) VALUES ('reconv-036@exemplo.invalid', 'teste') "
        "RETURNING id::text")
    await conexao.fetchval(
        "SELECT journey_enroll_event($1::uuid, 'form_submitted', $2::jsonb)", lead,
        {"page_slug": "teste-036", "reconversao": True, "agendamento": True})
    assert await _runs(conexao, lead, [a, b]) == {b}
