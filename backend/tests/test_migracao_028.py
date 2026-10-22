"""Migration 028 — ajustes da prova do RD (frente ajustes-prova, 22/10/2026).

Mesmo molde da `test_migracao_027.py`:
- o de TEXTO lê o arquivo da migration e roda sem banco;
- os de BANCO rodam dentro da transação revertida da fixture `conexao` e
  PULAM enquanto a 028 não estiver aplicada no banco do pytest. Foram
  rodados contra um Postgres 17 local com 000…028 (ver
  docs/frentes/ajustes-prova.md).
"""

import json
import pathlib
import re

import pytest

ARQUIVO = (pathlib.Path(__file__).resolve().parent.parent
           / "migrations" / "028_ajustes_prova.sql")


# ── Texto da migration (sem banco) ───────────────────────────────────────────

def test_028_reaplicavel_no_texto():
    sql = ARQUIVO.read_text(encoding="utf-8")
    assert "CREATE EXTENSION" not in sql
    assert not re.search(r"CREATE FUNCTION", sql)       # sempre OR REPLACE
    assert not re.search(r"CREATE TABLE|ADD COLUMN|CREATE (UNIQUE )?INDEX|DROP ", sql)
    for nome in ("uniq_campaign_sends_email_campaign_lead",
                 "uniq_campaign_sends_journey_node", "uniq_journey_runs_open"):
        assert nome not in sql


# ── Banco (transação revertida) ──────────────────────────────────────────────

async def _exigir_028(conexao):
    tem = await conexao.fetchval(
        "SELECT position('v_site' in prosrc) > 0 FROM pg_proc "
        "WHERE proname = 'journey_enroll_event' AND pronargs = 3")
    if not tem:
        pytest.skip("migration 028 ainda não aplicada neste banco")


async def _lead(conexao, email):
    return await conexao.fetchval(
        "INSERT INTO leads (email, tipo) VALUES ($1, 'teste') RETURNING id::text", email)


async def _jornada(conexao, nome, **filtro):
    return await conexao.fetchval(
        """INSERT INTO journeys (name, status, entry_type, entry_config,
                                 entry_node_id, nodes)
           VALUES ($1, 'active', 'event', $2::jsonb, 'n1', $3::jsonb)
           RETURNING id::text""",
        nome, {"event_type": "form_submitted", **filtro},
        [{"id": "n1", "type": "delay", "config": {"minutes": 60}, "next": None}])


async def _matricular(conexao, lead, metadata):
    await conexao.fetchval(
        "SELECT journey_enroll_event($1::uuid, 'form_submitted', $2::jsonb)",
        lead, metadata)


async def _matriculas(conexao, lead, jornadas):
    linhas = await conexao.fetch(
        "SELECT journey_id::text AS j, context FROM journey_runs "
        "WHERE lead_id = $1::uuid AND journey_id = ANY($2::uuid[])", lead, jornadas)
    return {l["j"]: l["context"] if isinstance(l["context"], dict)
            else json.loads(l["context"]) for l in linhas}


SITE = "00000000-0000-0000-0000-0000000028a4"


async def test_028_sem_filtro_nao_matricula_conversao_de_site(conexao):
    """A4 (pergunta 62): o snippet no site institucional não pode pôr todo
    cliente que pede cotação num "boas-vindas" sem filtro."""
    await _exigir_028(conexao)
    qualquer = await _jornada(conexao, "028 — qualquer origem")
    do_form = await _jornada(conexao, "028 — form", form_ids=["prova_cap_phoebus"])
    lead = await _lead(conexao, "prova-028-site@exemplo.invalid")

    await _matricular(conexao, lead, {"form_id": "prova_cap_phoebus", "site_id": SITE})

    runs = await _matriculas(conexao, lead, [qualquer, do_form])
    assert set(runs) == {do_form}
    assert runs[do_form]["form_id"] == "prova_cap_phoebus"


async def test_028_site_sem_form_id_nao_entra_em_nada_sem_filtro(conexao):
    await _exigir_028(conexao)
    qualquer = await _jornada(conexao, "028 — qualquer origem")
    lead = await _lead(conexao, "prova-028-site2@exemplo.invalid")

    await _matricular(conexao, lead, {"site_id": SITE})

    assert await _matriculas(conexao, lead, [qualquer]) == {}


async def test_028_landing_e_sem_origem_continuam_como_hoje(conexao):
    await _exigir_028(conexao)
    qualquer = await _jornada(conexao, "028 — qualquer origem")
    pagina = await _jornada(conexao, "028 — página", page_slug="phoebus-prova")
    da_landing = await _lead(conexao, "prova-028-landing@exemplo.invalid")
    sem_origem = await _lead(conexao, "prova-028-api@exemplo.invalid")

    await _matricular(conexao, da_landing, {"page_slug": "phoebus-prova"})
    await _matricular(conexao, sem_origem, {})

    assert set(await _matriculas(conexao, da_landing, [qualquer, pagina])) == {qualquer, pagina}
    assert set(await _matriculas(conexao, sem_origem, [qualquer, pagina])) == {qualquer}


async def _exigir_028_grafo(conexao):
    tem = await conexao.fetchval(
        "SELECT position('coalesce(jsonb_typeof(v_node#>''{config,rules}'')' in prosrc) > 0 "
        "FROM pg_proc WHERE proname = 'validate_journey_graph'")
    if not tem:
        pytest.skip("migration 028 (grafo) ainda não aplicada neste banco")


@pytest.mark.parametrize("config", [{}, {"rules": None}, {"rules": []}, {"rules": "x"}])
async def test_028_branch_attribute_sem_regras_recusado(conexao, config):
    """A7: sem `rules`, `jsonb_typeof(NULL) <> 'array'` dava NULL e o nó
    passava calado — um ramo que nunca decide nada."""
    import asyncpg
    await _exigir_028_grafo(conexao)
    no = {"id": "a", "type": "branch_attribute", "config": config, "next": None}
    with pytest.raises(asyncpg.RaiseError, match="branch_attribute"):
        async with conexao.transaction():
            await conexao.execute("SELECT validate_journey_graph($1::jsonb, 'a')", [no])


async def test_028_branch_attribute_com_regra_passa(conexao):
    await _exigir_028_grafo(conexao)
    regra = {"field": "etiqueta", "operator": "is", "value": "quente"}
    await conexao.execute(
        "SELECT validate_journey_graph($1::jsonb, 'a')",
        [{"id": "a", "type": "branch_attribute", "config": {"rules": [regra]}, "next": None}])


async def test_028_site_id_em_branco_nao_conta_como_site(conexao):
    await _exigir_028(conexao)
    qualquer = await _jornada(conexao, "028 — qualquer origem")
    lead = await _lead(conexao, "prova-028-branco@exemplo.invalid")

    await _matricular(conexao, lead, {"site_id": "  "})

    assert set(await _matriculas(conexao, lead, [qualquer])) == {qualquer}
