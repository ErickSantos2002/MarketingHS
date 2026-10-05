"""R5 sem decisão, parte das jornadas (frente r5-jornadas, 05/10/2026).

Nós "mudar status" e "remover tag", o filtro de página no gatilho por evento e
a página no evento de conversão. Tudo aqui roda dentro da transação revertida
da fixture `conexao` — nada é gravado em produção.

⚠️ Os testes que dependem da migration 026 PULAM com o motivo enquanto ela não
estiver aplicada no banco do pytest (o mesmo molde da 023). Ela foi provada
num Postgres 17 local com as 26 migrations: ver docs/frentes/r5-jornadas.md.
"""

import json

import pytest

from app.jornadas import executor

RUN_ID = "00000000-0000-0000-0000-0000000000c1"
JORNADA_ID = "00000000-0000-0000-0000-0000000000d1"


async def _lead(conexao, email="r5-jornadas@exemplo.invalid", **colunas):
    colunas.setdefault("tipo", "teste")
    nomes = ["email", *colunas]
    valores = [email, *colunas.values()]
    marcas = ", ".join(f"${i}" for i in range(1, len(valores) + 1))
    return await conexao.fetchval(
        f"INSERT INTO leads ({', '.join(nomes)}) VALUES ({marcas}) RETURNING id::text",
        *valores)


def _run(lead):
    return {"run_id": RUN_ID, "journey_id": JORNADA_ID, "lead_id": lead, "context": {}}


@pytest.fixture
def passos(monkeypatch):
    """`journey_step_log` tem FK para o run; aqui o run é de mentira."""
    registrados = []

    async def registrar(conn, run, no, resultado, detalhe=None):
        registrados.append((no.get("type"), resultado, detalhe))
    monkeypatch.setattr(executor, "registrar_passo", registrar)
    return registrados


async def _eventos(conexao, lead, tipo):
    linhas = await conexao.fetch(
        "SELECT metadata FROM contact_events WHERE lead_id = $1::uuid "
        "AND event_type = $2 ORDER BY occurred_at", lead, tipo)
    return [l["metadata"] if isinstance(l["metadata"], dict)
            else json.loads(l["metadata"] or "{}") for l in linhas]


async def _tem_026(conexao) -> bool:
    fonte = await conexao.fetchval(
        "SELECT prosrc FROM pg_proc WHERE proname = 'validate_journey_graph'")
    return "change_status" in (fonte or "")


async def _exigir_026(conexao):
    if not await _tem_026(conexao):
        pytest.skip("migration 026 ainda não aplicada neste banco")


# ── Nó "mudar status" ────────────────────────────────────────────────────────

async def test_mudar_status_grava_e_registra_como_o_painel(conexao, passos):
    lead = await _lead(conexao)
    anterior = await conexao.fetchval(
        "SELECT status FROM leads WHERE id = $1::uuid", lead)
    no = {"id": "n1", "type": "change_status",
          "config": {"status": "lead qualificado"}, "next": "n2"}

    saida = await executor.executar_no(conexao, _run(lead), no)

    assert saida == {"tipo": "avancar", "proximo": "n2"}
    # Nome canônico, mesmo vindo em caixa diferente (como o PATCH do painel).
    assert await conexao.fetchval(
        "SELECT status FROM leads WHERE id = $1::uuid", lead) == "Lead Qualificado"
    genericos = await _eventos(conexao, lead, "contact_updated")
    assert len(genericos) == 1
    assert genericos[0]["status_anterior"] == anterior
    assert genericos[0]["status_atual"] == "Lead Qualificado"
    assert genericos[0]["source"] == "jornada"
    assert genericos[0]["journey_id"] == JORNADA_ID
    # A transição que a listagem conta ganha o evento específico, como no painel.
    assert len(await _eventos(conexao, lead, "lead_qualified")) == 1
    assert passos[-1][:2] == ("change_status", "entered")


async def test_mudar_status_para_o_mesmo_nao_grava_evento(conexao, passos):
    lead = await _lead(conexao, status="Lead Qualificado")
    no = {"id": "n1", "type": "change_status",
          "config": {"status": "Lead Qualificado"}, "next": None}

    saida = await executor.executar_no(conexao, _run(lead), no)

    assert saida == {"tipo": "avancar", "proximo": None}
    assert await _eventos(conexao, lead, "contact_updated") == []
    assert await _eventos(conexao, lead, "lead_qualified") == []
    assert passos[-1][:2] == ("change_status", "skipped")


async def test_mudar_status_desconhecido_falha_a_vista(conexao, passos):
    """Status que não existe em `lead_statuses` levanta: o `rodar_cadeia`
    re-tenta e depois põe o run em `failed` com o motivo — nunca segue
    calado como se tivesse mudado."""
    lead = await _lead(conexao)
    no = {"id": "n1", "type": "change_status",
          "config": {"status": "Status Que Não Existe"}, "next": None}
    with pytest.raises(ValueError, match="Status Que Não Existe"):
        await executor.executar_no(conexao, _run(lead), no)
    assert await _eventos(conexao, lead, "contact_updated") == []


# ── Nó "remover tag" ─────────────────────────────────────────────────────────

async def test_remover_tag_tira_so_aquela(conexao, passos):
    lead = await _lead(conexao)
    for nome in ("r5-remover", "r5-fica"):
        tag = await conexao.fetchval(
            "INSERT INTO tags (name) VALUES ($1) ON CONFLICT (name) "
            "DO UPDATE SET name = EXCLUDED.name RETURNING id", nome)
        await conexao.execute(
            "INSERT INTO lead_tags (lead_id, tag_id) VALUES ($1::uuid, $2)", lead, tag)
    no = {"id": "n1", "type": "remove_tag",
          "config": {"tag_name": "/R5-Remover "}, "next": "n2"}

    saida = await executor.executar_no(conexao, _run(lead), no)

    assert saida == {"tipo": "avancar", "proximo": "n2"}
    restantes = [r["name"] for r in await conexao.fetch(
        "SELECT t.name FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id "
        "WHERE lt.lead_id = $1::uuid", lead)]
    assert restantes == ["r5-fica"]
    assert passos[-1][0] == "remove_tag"
    assert passos[-1][2]["removida"] is True
    # A tag continua existindo: outros contatos podem usá-la.
    assert await conexao.fetchval(
        "SELECT count(*) FROM tags WHERE name = 'r5-remover'") == 1


@pytest.mark.parametrize("tag", ["r5-nao-tem", "r5-tag-que-nao-existe-em-lugar-nenhum"])
async def test_remover_tag_que_o_contato_nao_tem_nao_e_erro(conexao, passos, tag):
    lead = await _lead(conexao)
    await conexao.execute(
        "INSERT INTO tags (name) VALUES ('r5-nao-tem') ON CONFLICT (name) DO NOTHING")
    no = {"id": "n1", "type": "remove_tag", "config": {"tag_name": tag}, "next": None}

    saida = await executor.executar_no(conexao, _run(lead), no)

    assert saida == {"tipo": "avancar", "proximo": None}
    assert passos[-1][2]["removida"] is False


async def test_remover_tag_vazia_levanta(conexao, passos):
    lead = await _lead(conexao)
    no = {"id": "n1", "type": "remove_tag", "config": {"tag_name": "// "}, "next": None}
    with pytest.raises(ValueError):
        await executor.executar_no(conexao, _run(lead), no)


# ── O banco aceita os dois nós (026) ─────────────────────────────────────────

async def test_grafo_aceita_os_dois_nos_novos(conexao):
    await _exigir_026(conexao)
    await conexao.execute(
        "SELECT validate_journey_graph($1::jsonb, 'a')",
        [{"id": "a", "type": "change_status", "config": {"status": "Lead"}, "next": "b"},
         {"id": "b", "type": "remove_tag", "config": {"tag_name": "x"}, "next": None}])


@pytest.mark.parametrize("no", [
    {"id": "a", "type": "change_status", "config": {}, "next": None},
    {"id": "a", "type": "remove_tag", "config": {"tag_name": ""}, "next": None},
])
async def test_grafo_recusa_no_novo_sem_config(conexao, no):
    import asyncpg
    await _exigir_026(conexao)
    with pytest.raises(asyncpg.RaiseError, match="exige config"):
        async with conexao.transaction():
            await conexao.execute(
                "SELECT validate_journey_graph($1::jsonb, 'a')", [no])


# ── Gatilho por evento com filtro de página (026) ────────────────────────────

async def _jornada(conexao, nome, pagina=None):
    config = {"event_type": "form_submitted"}
    if pagina is not None:
        config["page_slug"] = pagina
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
    return {l["j"]: l["context"] for l in linhas}


async def test_conversao_na_pagina_a_dispara_a_jornada_de_a_e_nao_a_de_b(conexao):
    await _exigir_026(conexao)
    a = await _jornada(conexao, "r5 — demo A", "r5-pagina-a")
    b = await _jornada(conexao, "r5 — demo B", "r5-pagina-b")
    qualquer = await _jornada(conexao, "r5 — qualquer página")
    lead = await _lead(conexao)

    await conexao.fetchval(
        "SELECT journey_enroll_event($1::uuid, 'form_submitted', $2::jsonb)",
        lead, {"page_slug": "r5-pagina-a"})

    runs = await _matriculas(conexao, lead, [a, b, qualquer])
    assert set(runs) == {a, qualquer}
    ctx = runs[a] if isinstance(runs[a], dict) else json.loads(runs[a])
    assert ctx["page_slug"] == "r5-pagina-a"


async def test_evento_sem_pagina_nao_entra_em_jornada_filtrada(conexao):
    """O lado seguro: importação, DataCore, painel e worker antigo (2
    argumentos) não carregam página — e não podem matricular em fluxo que
    pediu uma página específica."""
    await _exigir_026(conexao)
    a = await _jornada(conexao, "r5 — demo A", "r5-pagina-a")
    qualquer = await _jornada(conexao, "r5 — qualquer página")
    lead = await _lead(conexao)

    await conexao.fetchval(
        "SELECT journey_enroll_event($1::uuid, 'form_submitted', '{}'::jsonb)", lead)
    assert set(await _matriculas(conexao, lead, [a, qualquer])) == {qualquer}

    outro = await _lead(conexao, email="r5-jornadas-2@exemplo.invalid")
    await conexao.fetchval(
        "SELECT journey_enroll_event($1::uuid, 'form_submitted')", outro)
    assert set(await _matriculas(conexao, outro, [a, qualquer])) == {qualquer}


# ── A captura publica o evento COM a página ──────────────────────────────────

async def test_lead_novo_da_captura_leva_a_pagina_no_evento(conexao):
    await _exigir_026(conexao)
    from app.routers import captura

    lead = await captura._inserir(conexao, "r5-captura-nova@exemplo.invalid", None,
                                  {"nome": "Nova"}, "r5-pagina-a")
    eventos = await _eventos(conexao, lead, "form_submitted")
    assert [e["page_slug"] for e in eventos] == ["r5-pagina-a"]

    # A marca é da transação, mas não vaza para o INSERT seguinte dela.
    outro = await _lead(conexao, email="r5-sem-pagina@exemplo.invalid")
    assert [e["page_slug"] for e in await _eventos(conexao, outro, "form_submitted")] == [None]


async def test_reconversao_publica_form_submitted_com_a_pagina(conexao):
    """Quem já é contato e pede demonstração TEM que poder disparar a jornada
    na hora. Antes o `form_submitted` só existia no INSERT do lead — a segunda
    conversão não publicava nada."""
    from app.routers import captura

    lead = await _lead(conexao)
    antes = len(await _eventos(conexao, lead, "form_submitted"))

    await captura.publicar_conversao(conexao, lead, "r5-pagina-b", origem="captura")

    eventos = await _eventos(conexao, lead, "form_submitted")
    assert len(eventos) == antes + 1
    # `occurred_at` é now() — igual para tudo na transação; acha pela página.
    novo = [e for e in eventos if e.get("page_slug") == "r5-pagina-b"]
    assert len(novo) == 1
    assert novo[0]["reconversao"] is True
    assert novo[0]["origem"] == "captura"
    # E chega à fila de jornada, que é quem o worker lê.
    fila = await conexao.fetch(
        "SELECT metadata FROM journey_events WHERE lead_id = $1::uuid "
        "AND event_type = 'form_submitted'", lead)
    paginas = [(m["metadata"] if isinstance(m["metadata"], dict)
                else json.loads(m["metadata"])).get("page_slug") for m in fila]
    assert "r5-pagina-b" in paginas


# ── POST /publico/conversao não sobrescreve a origem (pergunta 50) ───────────

async def test_conversao_da_api_nao_troca_utm_ja_gravado(conexao):
    from app.routers.publico import ConversaoIn, _carimbar_lead

    lead = await _lead(conexao, utm_source="google", utm_medium="cpc",
                       source="landing")
    await _carimbar_lead(conexao, lead, ConversaoIn(
        lead_id=lead, tipo="demonstracao", page_slug="r5-pagina-a",
        utm_source="facebook", utm_medium="social", utm_campaign="remarketing",
        source="api-externa"))
    linha = await conexao.fetchrow(
        "SELECT utm_source, utm_medium, utm_campaign, source, tipo FROM leads "
        "WHERE id = $1::uuid", lead)
    assert dict(linha) == {"utm_source": "google", "utm_medium": "cpc",
                           "utm_campaign": None, "source": "landing",
                           "tipo": "demonstracao"}


async def test_conversao_da_api_grava_o_bloco_quando_nao_ha_origem(conexao):
    from app.routers.publico import ConversaoIn, _carimbar_lead

    lead = await _lead(conexao, utm_source="")
    await _carimbar_lead(conexao, lead, ConversaoIn(
        lead_id=lead, tipo="demonstracao", page_slug="r5-pagina-a",
        utm_source="linkedin", utm_campaign="sipat", source="api-externa"))
    linha = await conexao.fetchrow(
        "SELECT utm_source, utm_campaign, utm_medium, source FROM leads "
        "WHERE id = $1::uuid", lead)
    assert dict(linha) == {"utm_source": "linkedin", "utm_campaign": "sipat",
                           "utm_medium": None, "source": "api-externa"}


# ── O worker passa o metadata, com ou sem a 026 ──────────────────────────────

async def test_worker_matricula_com_ou_sem_a_026_sem_envenenar_a_transacao(
        conexao, monkeypatch):
    """Sem a 026, a chamada de 3 argumentos falha — num SAVEPOINT próprio, e o
    worker cai na de 2. Com a 026, usa a de 3. Nos dois casos a transação do
    lote segue viva (a consulta seguinte funciona)."""
    from app import worker

    monkeypatch.setattr(worker, "_ENROLL_COM_METADATA", None)
    lead = await _lead(conexao)
    evento = {"lead_id": lead, "event_type": "r5_evento_que_ninguem_escuta",
              "metadata": {"page_slug": "r5-pagina-a"}}
    assert await worker._matricular_por_evento(conexao, evento) == 0
    assert worker._ENROLL_COM_METADATA is await _tem_026(conexao)
    assert await worker._matricular_por_evento(conexao, evento) == 0
    assert await conexao.fetchval("SELECT 1") == 1
