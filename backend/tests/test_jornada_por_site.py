"""Jornada por SITE — `entry_config.site_ids` (frente jornada-por-site, 23/11/2026).

O site da agência gera um `form_id` por página (`/#form1`, `/suporte#form1`,
`lp-contatos`…). Filtrar por lista de formulários deixa página nova sem card,
em silêncio. `site_ids` = qualquer formulário desses sites, inclusive o de
página que ainda não existe.

Mesmo molde da `test_migracao_028.py`:
- o de TEXTO lê o arquivo da migration e roda sem banco;
- os de BANCO rodam na transação revertida da fixture `conexao` e PULAM
  enquanto a 039 não estiver aplicada no banco do pytest;
- os da VALIDAÇÃO do router são puros.

⚠️ A reaplicação de verdade (o arquivo duas vezes) não cabe aqui — o
`marketinghs_app` não tem DDL. Foi provada com `psql -f` duas vezes no
Postgres local (docs/frentes/jornada-por-site.md).
"""

import json
import pathlib
import re

import pytest
from fastapi import HTTPException

from app.routers import jornadas as rota

ARQUIVO = (pathlib.Path(__file__).resolve().parent.parent
           / "migrations" / "039_jornada_por_site.sql")

SITE = "e42d5d70-4124-46b5-a937-a7299625d425"        # o formato do `sites.id::text`
OUTRO_SITE = "00000000-0000-0000-0000-000000000039"


# ── Texto da migration (sem banco) ───────────────────────────────────────────

def test_039_reaplicavel_no_texto():
    sql = re.sub(r"--[^\n]*", "", ARQUIVO.read_text(encoding="utf-8"))
    assert "CREATE EXTENSION" not in sql
    assert not re.search(r"CREATE FUNCTION", sql)       # sempre OR REPLACE
    assert not re.search(r"CREATE TABLE|ADD COLUMN|CREATE (UNIQUE )?INDEX|DROP ", sql)
    for nome in ("uniq_campaign_sends_email_campaign_lead",
                 "uniq_campaign_sends_journey_node", "uniq_journey_runs_open"):
        assert nome not in sql


# ── Banco (transação revertida) ──────────────────────────────────────────────

async def _exigir_039(conexao):
    tem = await conexao.fetchval(
        "SELECT position('f_site' in prosrc) > 0 FROM pg_proc "
        "WHERE proname = 'journey_enroll_event' AND pronargs = 3")
    if not tem:
        pytest.skip("migration 039 ainda não aplicada neste banco")


async def _lead(conexao, email):
    return await conexao.fetchval(
        "INSERT INTO leads (email, tipo) VALUES ($1, 'teste') RETURNING id::text", email)


DELAY = [{"id": "n1", "type": "delay", "config": {"minutes": 60}, "next": None}]
HANDOFF = [{"id": "n1", "type": "handoff_growthhs", "config": {}, "next": None}]


async def _jornada(conexao, nome, nos=None, **filtro):
    return await conexao.fetchval(
        """INSERT INTO journeys (name, status, entry_type, entry_config,
                                 entry_node_id, nodes)
           VALUES ($1, 'active', 'event', $2::jsonb, 'n1', $3::jsonb)
           RETURNING id::text""",
        nome, {"event_type": "form_submitted", **filtro}, nos or DELAY)


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


async def test_formulario_qualquer_do_site_casa(conexao):
    """Página nova da agência (form_id que ninguém listou) entra."""
    await _exigir_039(conexao)
    por_site = await _jornada(conexao, "039 — site", site_ids=[SITE])
    lead = await _lead(conexao, "jps-casa@exemplo.invalid")

    await _matricular(conexao, lead, {"form_id": "/pagina-nova#form1", "site_id": SITE})

    runs = await _matriculas(conexao, lead, [por_site])
    assert set(runs) == {por_site}
    assert runs[por_site]["form_id"] == "/pagina-nova#form1"


async def test_outro_site_nao_casa(conexao):
    await _exigir_039(conexao)
    por_site = await _jornada(conexao, "039 — site", site_ids=[SITE])
    lead = await _lead(conexao, "jps-outro@exemplo.invalid")

    await _matricular(conexao, lead, {"form_id": "/#form1", "site_id": OUTRO_SITE})

    assert await _matriculas(conexao, lead, [por_site]) == {}


async def test_landing_e_sem_origem_nao_entram_no_fluxo_por_site(conexao):
    await _exigir_039(conexao)
    por_site = await _jornada(conexao, "039 — site", site_ids=[SITE])
    da_landing = await _lead(conexao, "jps-landing@exemplo.invalid")
    sem_origem = await _lead(conexao, "jps-api@exemplo.invalid")

    await _matricular(conexao, da_landing, {"page_slug": "phoebus-prova"})
    await _matricular(conexao, sem_origem, {})

    assert await _matriculas(conexao, da_landing, [por_site]) == {}
    assert await _matriculas(conexao, sem_origem, [por_site]) == {}


async def test_028_continua_site_nao_entra_em_fluxo_sem_filtro(conexao):
    """"Qualquer origem" continua NÃO incluindo site de fora."""
    await _exigir_039(conexao)
    qualquer = await _jornada(conexao, "039 — qualquer origem")
    por_site = await _jornada(conexao, "039 — site", site_ids=[SITE])
    lead = await _lead(conexao, "jps-028@exemplo.invalid")

    await _matricular(conexao, lead, {"form_id": "/#form1", "site_id": SITE})

    assert set(await _matriculas(conexao, lead, [qualquer, por_site])) == {por_site}


async def test_reconversao_entra_em_fluxo_por_site(conexao):
    await _exigir_039(conexao)
    qualquer = await _jornada(conexao, "039 — qualquer origem")
    por_site = await _jornada(conexao, "039 — site", site_ids=[SITE])
    lead = await _lead(conexao, "jps-reconv@exemplo.invalid")

    await _matricular(conexao, lead, {"form_id": "/suporte#form1", "site_id": SITE,
                                      "reconversao": True})

    assert set(await _matriculas(conexao, lead, [qualquer, por_site])) == {por_site}


async def test_agendamento_continua_fora_do_handoff_por_site(conexao):
    await _exigir_039(conexao)
    handoff = await _jornada(conexao, "039 — site → comercial", HANDOFF, site_ids=[SITE])
    nutricao = await _jornada(conexao, "039 — site nutrição", site_ids=[SITE])
    lead = await _lead(conexao, "jps-agenda@exemplo.invalid")

    await _matricular(conexao, lead, {"form_id": "/#form1", "site_id": SITE,
                                      "agendamento": "true"})

    assert set(await _matriculas(conexao, lead, [handoff, nutricao])) == {nutricao}


async def test_handoff_por_site_sem_agendamento_entra(conexao):
    await _exigir_039(conexao)
    handoff = await _jornada(conexao, "039 — site → comercial", HANDOFF, site_ids=[SITE])
    lead = await _lead(conexao, "jps-handoff@exemplo.invalid")

    await _matricular(conexao, lead, {"form_id": "lp-contatos", "site_id": SITE})

    assert set(await _matriculas(conexao, lead, [handoff])) == {handoff}


async def test_fluxo_so_com_form_ids_continua_igual(conexao):
    await _exigir_039(conexao)
    do_form = await _jornada(conexao, "039 — form", form_ids=["/#form1"])
    casa = await _lead(conexao, "jps-form1@exemplo.invalid")
    nao_casa = await _lead(conexao, "jps-form2@exemplo.invalid")

    await _matricular(conexao, casa, {"form_id": "/#form1", "site_id": SITE})
    await _matricular(conexao, nao_casa, {"form_id": "/suporte#form1", "site_id": SITE})

    assert set(await _matriculas(conexao, casa, [do_form])) == {do_form}
    assert await _matriculas(conexao, nao_casa, [do_form]) == {}


async def test_site_e_formulario_juntos_sao_ou(conexao):
    """Como página/formulário já são: casa por um OU pelo outro."""
    await _exigir_039(conexao)
    combinado = await _jornada(conexao, "039 — site ou form",
                               site_ids=[SITE], form_ids=["prova_cap_phoebus"])
    pelo_form = await _lead(conexao, "jps-ou1@exemplo.invalid")
    pelo_site = await _lead(conexao, "jps-ou2@exemplo.invalid")
    nenhum = await _lead(conexao, "jps-ou3@exemplo.invalid")

    await _matricular(conexao, pelo_form, {"form_id": "prova_cap_phoebus",
                                           "site_id": OUTRO_SITE})
    await _matricular(conexao, pelo_site, {"form_id": "/#form1", "site_id": SITE})
    await _matricular(conexao, nenhum, {"form_id": "/#form1", "site_id": OUTRO_SITE})

    assert set(await _matriculas(conexao, pelo_form, [combinado])) == {combinado}
    assert set(await _matriculas(conexao, pelo_site, [combinado])) == {combinado}
    assert await _matriculas(conexao, nenhum, [combinado]) == {}


async def test_site_ids_vazio_e_fluxo_sem_filtro(conexao):
    """`site_ids: []` não filtra: o fluxo é "qualquer origem" (que não inclui
    site, 028) — a landing entra, a conversão de site não."""
    await _exigir_039(conexao)
    vazio = await _jornada(conexao, "039 — lista vazia", site_ids=[])
    da_landing = await _lead(conexao, "jps-vazio1@exemplo.invalid")
    do_site = await _lead(conexao, "jps-vazio2@exemplo.invalid")

    await _matricular(conexao, da_landing, {"page_slug": "phoebus-prova"})
    await _matricular(conexao, do_site, {"form_id": "/#form1", "site_id": SITE})

    assert set(await _matriculas(conexao, da_landing, [vazio])) == {vazio}
    assert await _matriculas(conexao, do_site, [vazio]) == {}


async def test_site_id_chega_no_metadata_da_conversao_nova_e_da_reconversao(conexao):
    """O caminho real: o gatilho de INSERT (lead novo) e o
    `publicar_conversao` (contato que já existia) põem o `site_id` no
    metadata, e esse metadata casa com o fluxo por site."""
    from app.captura.evento import marcar_pagina, publicar_conversao

    await _exigir_039(conexao)
    por_site = await _jornada(conexao, "039 — site", site_ids=[SITE])

    await marcar_pagina(conexao, None, form_id="/#form1", site_id=SITE)
    novo = await _lead(conexao, "jps-meta-novo@exemplo.invalid")
    await marcar_pagina(conexao, None)
    existente = await _lead(conexao, "jps-meta-velho@exemplo.invalid")
    await publicar_conversao(conexao, existente, None, origem="site",
                             form_id="/suporte#form1", site_id=SITE)

    for lead in (novo, existente):
        bruto = await conexao.fetchval(
            "SELECT metadata FROM contact_events WHERE lead_id = $1::uuid "
            "AND event_type = 'form_submitted' AND metadata->>'site_id' IS NOT NULL",
            lead)
        assert bruto is not None, lead
        meta = bruto if isinstance(bruto, dict) else json.loads(bruto)
        assert meta["site_id"] == SITE
        await _matricular(conexao, lead, meta)
        assert set(await _matriculas(conexao, lead, [por_site])) == {por_site}


# ── Validação do router (sem banco) ──────────────────────────────────────────

def test_site_ids_validos_saem_normalizados():
    saida = rota._normalizar_sites({"event_type": "form_submitted",
                                    "site_ids": [SITE.upper(), f" {SITE} ", OUTRO_SITE]})
    assert saida["site_ids"] == [SITE, OUTRO_SITE]
    assert saida["event_type"] == "form_submitted"


@pytest.mark.parametrize("entrada", [None, {}, {"page_slug": "x"}, {"site_ids": []}])
def test_sem_site_ids_fica_como_esta(entrada):
    assert rota._normalizar_sites(entrada) == entrada


@pytest.mark.parametrize("valor", [SITE, "nao-e-uuid", ["nao-e-uuid"], [123], [None],
                                   {"a": SITE}, [SITE, ""], True])
def test_site_ids_invalido_e_400(valor):
    with pytest.raises(HTTPException) as exc:
        rota._normalizar_sites({"event_type": "form_submitted", "site_ids": valor})
    assert exc.value.status_code == 400
    assert "uuid" in exc.value.detail.lower()


# ── Correções da revisão ─────────────────────────────────────────────────────

async def test_contexto_da_matricula_diz_o_site(conexao):
    await _exigir_039(conexao)
    por_site = await _jornada(conexao, "039 — site", site_ids=[SITE])
    lead = await _lead(conexao, "jps-contexto@exemplo.invalid")

    await _matricular(conexao, lead, {"form_id": "/#form1", "site_id": SITE})

    assert (await _matriculas(conexao, lead, [por_site]))[por_site]["site_id"] == SITE


async def test_site_id_maiusculo_no_metadata_casa(conexao):
    await _exigir_039(conexao)
    por_site = await _jornada(conexao, "039 — site", site_ids=[SITE])
    lead = await _lead(conexao, "jps-maiusculo@exemplo.invalid")

    await _matricular(conexao, lead, {"form_id": "/#form1", "site_id": SITE.upper()})

    assert set(await _matriculas(conexao, lead, [por_site])) == {por_site}


@pytest.mark.parametrize("cfg", [{"event_type": "email_opened"}, {"segment_ids": ["x"]}])
def test_site_ids_fora_do_formulario_enviado_e_400(cfg):
    """Só o `form_submitted` traz `site_id`: em outro evento o filtro nunca
    casaria, e o fluxo ficaria vazio em silêncio."""
    with pytest.raises(HTTPException) as exc:
        rota._normalizar_sites({**cfg, "site_ids": [SITE]})
    assert exc.value.status_code == 400
    assert "formulário enviado" in exc.value.detail.lower()
