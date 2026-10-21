"""Migration 027 — o schema da prova de substituição do RD (frente prova-captura,
21/10/2026).

Dois tipos de teste:
- o de TEXTO lê o arquivo da migration e roda sem banco: reaplicável, sem
  `CREATE EXTENSION`, sem tocar nos três índices únicos de envio;
- os de BANCO rodam dentro da transação revertida da fixture `conexao` — nada
  é gravado em produção.

⚠️ Os testes de banco PULAM com o motivo enquanto a 027 não estiver aplicada
no banco do pytest (molde `_exigir_026` de `test_r5_jornadas.py`). Ela foi
provada num Postgres 17 local com as 28 migrations (000…027), aplicada duas
vezes: ver docs/frentes/prova-captura.md.
"""

import json
import pathlib
import re

import pytest

ARQUIVO = (pathlib.Path(__file__).resolve().parent.parent
           / "migrations" / "027_prova_substituir_rd.sql")

TABELAS_NOVAS = ("lead_consents", "sites", "visitas", "journey_saidas",
                 "growthhs_receptor_pedidos")


# ── Texto da migration (sem banco) ───────────────────────────────────────────

def test_027_reaplicavel_no_texto():
    sql = ARQUIVO.read_text(encoding="utf-8")
    assert "CREATE EXTENSION" not in sql
    assert not re.search(r"CREATE TABLE (?!IF NOT EXISTS)", sql)
    assert not re.search(r"ADD COLUMN (?!IF NOT EXISTS)", sql)
    assert not re.search(r"CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)", sql)
    assert not re.search(r"CREATE FUNCTION", sql)       # sempre OR REPLACE
    for nome in ("uniq_campaign_sends_email_campaign_lead",
                 "uniq_campaign_sends_journey_node", "uniq_journey_runs_open"):
        assert nome not in sql
    assert sql.count("CREATE POLICY") == sql.count("DROP POLICY IF EXISTS")
    # RLS ligado nas cinco tabelas novas.
    for tabela in TABELAS_NOVAS:
        assert f"ALTER TABLE public.{tabela} ENABLE ROW LEVEL SECURITY" in sql


# ── Banco (transação revertida) ──────────────────────────────────────────────

async def _tem_027(conexao) -> bool:
    return await conexao.fetchval(
        "SELECT to_regclass('public.journey_saidas') IS NOT NULL")


async def _exigir_027(conexao):
    if not await _tem_027(conexao):
        pytest.skip("migration 027 ainda não aplicada neste banco")


async def _lead(conexao, email="prova-027@exemplo.invalid", **colunas):
    colunas.setdefault("tipo", "teste")
    nomes = ["email", *colunas]
    valores = [email, *colunas.values()]
    marcas = ", ".join(f"${i}" for i in range(1, len(valores) + 1))
    return await conexao.fetchval(
        f"INSERT INTO leads ({', '.join(nomes)}) VALUES ({marcas}) RETURNING id::text",
        *valores)


async def _avaliar(conexao, lead, regras):
    return await conexao.fetchval(
        "SELECT evaluate_rules_for_lead($1::uuid, $2::jsonb, 'and')", lead, regras)


async def test_027_tabelas_e_colunas_novas(conexao):
    await _exigir_027(conexao)
    for tabela in TABELAS_NOVAS:
        assert await conexao.fetchval(
            "SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass($1)",
            f"public.{tabela}") is True, tabela
    colunas = {(l["table_name"], l["column_name"]) for l in await conexao.fetch(
        "SELECT table_name, column_name FROM information_schema.columns "
        "WHERE table_schema = 'public' AND table_name IN "
        "('leads', 'lead_conversions', 'journeys')")}
    for esperada in [("leads", "campos_extras"),
                     ("lead_conversions", "form_id"), ("lead_conversions", "site_id"),
                     ("lead_conversions", "visitor_id"), ("lead_conversions", "page_url"),
                     ("lead_conversions", "page_path"), ("lead_conversions", "canal"),
                     ("journeys", "allowed_emails")]:
        assert esperada in colunas, esperada


async def test_027_campo_extra_no_segmento(conexao):
    await _exigir_027(conexao)
    lead = await _lead(conexao, campos_extras={"ja_faz_testagem": "sim"})
    regra = [{"field": "campo_extra", "key": "ja_faz_testagem",
              "operator": "is", "value": "Sim"}]
    assert await _avaliar(conexao, lead, regra) is True          # sem caixa
    regra[0]["operator"] = "is_not"
    assert await _avaliar(conexao, lead, regra) is False
    regra[0]["operator"] = "contains"
    regra[0]["value"] = "I"
    assert await _avaliar(conexao, lead, regra) is True
    regra[0]["operator"] = "not_contains"
    assert await _avaliar(conexao, lead, regra) is False

    # Chave ausente: `is_not` e `not_contains` incluem; `is`/`contains` não.
    regra = [{"field": "campo_extra", "key": "outra_chave",
              "operator": "is_not", "value": "sim"}]
    assert await _avaliar(conexao, lead, regra) is True
    regra[0]["operator"] = "not_contains"
    assert await _avaliar(conexao, lead, regra) is True
    regra[0]["operator"] = "is"
    assert await _avaliar(conexao, lead, regra) is False

    # Chave fora do padrão vira FALSE — inclusive para `is_not`, que de outro
    # jeito pegaria todo mundo.
    for chave in ("x; DROP TABLE leads", "Maiuscula", "", None):
        for operador in ("is", "is_not"):
            regra = [{"field": "campo_extra", "key": chave,
                      "operator": operador, "value": "sim"}]
            assert await _avaliar(conexao, lead, regra) is False, (chave, operador)

    # Operador desconhecido também vira FALSE.
    regra = [{"field": "campo_extra", "key": "ja_faz_testagem",
              "operator": "gt", "value": "a"}]
    assert await _avaliar(conexao, lead, regra) is False


async def test_027_campo_extra_sem_valor_nao_some_da_regra(conexao):
    """`quote_literal(NULL)` é NULL, e condição NULL é DESCARTADA pelo
    `evaluate_rules_for_lead` — uma regra `is_not` sem valor sumiria do AND e
    alargaria o público. Valor ausente vale como texto vazio."""
    await _exigir_027(conexao)
    lead = await _lead(conexao, campos_extras={"ja_faz_testagem": "sim"})
    regra = [{"field": "campo_extra", "key": "ja_faz_testagem", "operator": "is"}]
    assert await conexao.fetchval(
        "SELECT build_segment_condition($1::jsonb)", regra[0]) is not None
    assert await _avaliar(conexao, lead, regra) is False


def _grafo(*nos):
    return list(nos)


async def test_027_grafo_aceita_notify_e_webhook(conexao):
    await _exigir_027(conexao)
    await conexao.execute(
        "SELECT validate_journey_graph($1::jsonb, 'a')",
        _grafo({"id": "a", "type": "notify_email",
                "config": {"emails": ["comercial@exemplo.invalid"]}, "next": "b"},
               {"id": "b", "type": "webhook",
                "config": {"url": "https://exemplo.invalid/gancho"}, "next": None}))


@pytest.mark.parametrize("no", [
    {"id": "a", "type": "webhook", "config": {"url": "http://exemplo.invalid"}, "next": None},
    {"id": "a", "type": "webhook", "config": {}, "next": None},
    {"id": "a", "type": "webhook", "config": {"url": "https://"}, "next": None},
])
async def test_027_grafo_recusa_webhook_sem_https(conexao, no):
    import asyncpg
    await _exigir_027(conexao)
    with pytest.raises(asyncpg.RaiseError, match="webhook"):
        async with conexao.transaction():
            await conexao.execute("SELECT validate_journey_graph($1::jsonb, 'a')", [no])


@pytest.mark.parametrize("no", [
    {"id": "a", "type": "notify_email", "config": {}, "next": None},
    {"id": "a", "type": "notify_email", "config": {"emails": []}, "next": None},
    {"id": "a", "type": "notify_email", "config": {"emails": "a@b.c"}, "next": None},
])
async def test_027_grafo_recusa_notify_sem_emails(conexao, no):
    import asyncpg
    await _exigir_027(conexao)
    with pytest.raises(asyncpg.RaiseError, match="notify_email"):
        async with conexao.transaction():
            await conexao.execute("SELECT validate_journey_graph($1::jsonb, 'a')", [no])


async def _jornada(conexao, nome, **filtro):
    config = {"event_type": "form_submitted", **filtro}
    return await conexao.fetchval(
        """INSERT INTO journeys (name, status, entry_type, entry_config,
                                 entry_node_id, nodes)
           VALUES ($1, 'active', 'event', $2::jsonb, 'n1', $3::jsonb)
           RETURNING id::text""",
        nome, config,
        [{"id": "n1", "type": "delay", "config": {"minutes": 60}, "next": None}])


async def _matriculas(conexao, lead, jornadas):
    linhas = await conexao.fetch(
        "SELECT journey_id::text AS j, context FROM journey_runs "
        "WHERE lead_id = $1::uuid AND journey_id = ANY($2::uuid[])", lead, jornadas)
    return {l["j"]: l["context"] if isinstance(l["context"], dict)
            else json.loads(l["context"]) for l in linhas}


async def _matricular(conexao, lead, metadata):
    return await conexao.fetchval(
        "SELECT journey_enroll_event($1::uuid, 'form_submitted', $2::jsonb)",
        lead, metadata)


async def test_027_matricula_por_form_id(conexao):
    """A conta de `journey_enroll_event` inclui as jornadas reais do banco
    (um fluxo ativo sem filtro também casa) — por isso a prova é pelo
    conjunto das três jornadas do teste, não pelo número devolvido."""
    await _exigir_027(conexao)
    a = await _jornada(conexao, "027 — form A", form_ids=["prova_cap_phoebus"])
    b = await _jornada(conexao, "027 — form B", form_ids=["outro"])
    c = await _jornada(conexao, "027 — página", page_slug="phoebus-prova")
    lead = await _lead(conexao)

    await _matricular(conexao, lead, {"form_id": "prova_cap_phoebus"})

    runs = await _matriculas(conexao, lead, [a, b, c])
    assert set(runs) == {a}
    assert runs[a]["form_id"] == "prova_cap_phoebus"


async def test_027_pagina_ou_formulario(conexao):
    """Fluxo com os dois filtros entra pela landing OU pelo form do site."""
    await _exigir_027(conexao)
    j = await _jornada(conexao, "027 — os dois", page_slug="phoebus-prova",
                       form_ids=["prova_cap_phoebus"])
    pela_pagina = await _lead(conexao, email="prova-027-pagina@exemplo.invalid")
    pelo_form = await _lead(conexao, email="prova-027-form@exemplo.invalid")
    nenhum = await _lead(conexao, email="prova-027-nenhum@exemplo.invalid")

    await _matricular(conexao, pela_pagina, {"page_slug": "phoebus-prova"})
    await _matricular(conexao, pelo_form, {"form_id": "prova_cap_phoebus"})
    await _matricular(conexao, nenhum, {"page_slug": "outra", "form_id": "outro"})

    assert set(await _matriculas(conexao, pela_pagina, [j])) == {j}
    assert set(await _matriculas(conexao, pelo_form, [j])) == {j}
    assert set(await _matriculas(conexao, nenhum, [j])) == set()


async def test_027_form_ids_malformado_nao_vira_qualquer_origem(conexao):
    """`form_ids` que não é lista NÃO pode cair em "sem filtro": o lado
    seguro é não casar com nada pelo formulário. Lista vazia = sem filtro."""
    await _exigir_027(conexao)
    torto = await _jornada(conexao, "027 — torto", form_ids="prova_cap_phoebus")
    vazio = await _jornada(conexao, "027 — vazio", form_ids=[])
    lead = await _lead(conexao)

    await _matricular(conexao, lead, {"form_id": "prova_cap_phoebus"})

    assert set(await _matriculas(conexao, lead, [torto, vazio])) == {vazio}


async def test_027_reconversao_por_form_so_em_fluxo_filtrado(conexao):
    await _exigir_027(conexao)
    a = await _jornada(conexao, "027 — form A", form_ids=["prova_cap_phoebus"])
    qualquer = await _jornada(conexao, "027 — qualquer origem")
    lead = await _lead(conexao)

    await _matricular(conexao, lead, {"form_id": "prova_cap_phoebus", "reconversao": True})

    assert set(await _matriculas(conexao, lead, [a, qualquer])) == {a}


async def test_027_filtro_de_pagina_da_026_continua(conexao):
    await _exigir_027(conexao)
    c = await _jornada(conexao, "027 — página", page_slug="phoebus-prova")
    qualquer = await _jornada(conexao, "027 — qualquer origem")
    lead = await _lead(conexao)

    await _matricular(conexao, lead, {"page_slug": "phoebus-prova"})

    runs = await _matriculas(conexao, lead, [c, qualquer])
    assert set(runs) == {c, qualquer}
    assert runs[c]["page_slug"] == "phoebus-prova"
    assert "form_id" not in runs[c]


async def _eventos(conexao, lead):
    linhas = await conexao.fetch(
        "SELECT metadata FROM contact_events WHERE lead_id = $1::uuid "
        "AND event_type = 'form_submitted'", lead)
    return [l["metadata"] if isinstance(l["metadata"], dict)
            else json.loads(l["metadata"] or "{}") for l in linhas]


async def test_027_evento_de_insert_leva_form_id(conexao):
    await _exigir_027(conexao)
    site = "00000000-0000-0000-0000-0000000027a1"
    await conexao.execute("SELECT set_config('marketinghs.form_id', 'prova_cap_phoebus', true)")
    await conexao.execute("SELECT set_config('marketinghs.site_id', $1, true)", site)
    lead = await _lead(conexao)
    [meta] = await _eventos(conexao, lead)
    assert meta["form_id"] == "prova_cap_phoebus"
    assert meta["site_id"] == site

    # Marca apagada (string vazia) vira null, como a page_slug da 026.
    await conexao.execute("SELECT set_config('marketinghs.form_id', '', true)")
    await conexao.execute("SELECT set_config('marketinghs.site_id', '', true)")
    outro = await _lead(conexao, email="prova-027-sem-form@exemplo.invalid")
    [meta] = await _eventos(conexao, outro)
    assert meta["form_id"] is None and meta["site_id"] is None
    assert "page_slug" in meta                                  # a da 026 fica


async def test_027_source_app_growthhs_aceito(conexao):
    import asyncpg
    await _exigir_027(conexao)
    lead = await _lead(conexao)
    await conexao.execute(
        "INSERT INTO contact_events (lead_id, source_app, event_type, title) "
        "VALUES ($1::uuid, 'growthhs', 'meeting_scheduled', 'Reunião agendada')", lead)
    with pytest.raises(asyncpg.RaiseError, match="Invalid source_app"):
        async with conexao.transaction():
            await conexao.execute(
                "INSERT INTO contact_events (lead_id, source_app, event_type, title) "
                "VALUES ($1::uuid, 'inventado', 'x', 'x')", lead)


async def test_027_receptor_e_saidas_unicos(conexao):
    """`journey_saidas` tem uma saída por (run, nó) — a mesma garantia de não
    duplicar que o índice único de (run, nó) dá ao e-mail."""
    import asyncpg
    await _exigir_027(conexao)
    run = "00000000-0000-0000-0000-0000000027b1"
    sql = ("INSERT INTO journey_saidas (journey_run_id, journey_node_id, tipo, destino, payload) "
           "VALUES ($1::uuid, 'n1', 'webhook', 'https://exemplo.invalid', '{}'::jsonb)")
    await conexao.execute(sql, run)
    with pytest.raises(asyncpg.UniqueViolationError):
        async with conexao.transaction():
            await conexao.execute(sql, run)
    with pytest.raises(asyncpg.CheckViolationError):
        async with conexao.transaction():
            await conexao.execute(
                "INSERT INTO journey_saidas (journey_run_id, journey_node_id, tipo, destino, payload) "
                "VALUES ($1::uuid, 'n2', 'sms', 'x', '{}'::jsonb)", run)
    with pytest.raises(asyncpg.CheckViolationError):
        async with conexao.transaction():
            await conexao.execute(
                "INSERT INTO visitas (visitor_id, canal) VALUES ('v1', 'direto')")
