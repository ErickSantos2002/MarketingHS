"""A fusão de contatos leva TODO o histórico (decisão 23+24 do Erick, 01/10/2026).

O modo de falhar é o calado: a fusão responde 200, o descartado some, e com ele
somem (CASCADE) os runs de jornada e as entregas ao comercial dele, ou ficam
órfãos (`lead_id` NULL) os eventos de e-mail e a supressão. Ninguém vê; o
relatório do contato mantido só fica mais pobre.

Tudo na fixture `conexao` (transação revertida), chamando o MESMO
`fundir_leads` que a rota chama — sob `service_role` E sob `authenticated`
com um admin de verdade, que é o papel da rota desde a migration 022
(rodada 5). Sob `authenticated` o modo de falhar é pior que o 500: tabela sem
política de UPDATE afeta 0 linhas sem erro, e o DELETE do descartado leva o
que não foi movido pelo CASCADE. Por isso a semeadura cobre as 15 tabelas e o
teste exige que CADA uma tenha movido pelo menos uma linha.
"""

import json
from uuid import uuid4

import pytest

from app.routers.escrita_contatos import _TABELAS_FILHAS, fundir_leads


async def _lead(conexao, rotulo) -> str:
    return str(await conexao.fetchval(
        "INSERT INTO leads (nome, email, tipo) VALUES ($1, $2, 'teste') RETURNING id",
        f"Fusão {rotulo}", f"fusao-{rotulo}-{uuid4().hex[:8]}@exemplo.invalid"))


async def _jornada(conexao, nome) -> str:
    return str(await conexao.fetchval(
        "INSERT INTO journeys (name, entry_type) VALUES ($1, 'event') RETURNING id", nome))


async def _run(conexao, jornada, lead, estado="waiting") -> str:
    return str(await conexao.fetchval(
        "INSERT INTO journey_runs (journey_id, lead_id, state, current_node_id) "
        "VALUES ($1::uuid, $2::uuid, $3, 'n1') RETURNING id", jornada, lead, estado))


async def _campanha(conexao, nome) -> str:
    return str(await conexao.fetchval(
        "INSERT INTO campaigns (name, channel, status) VALUES ($1, 'email', 'draft') "
        "RETURNING id", nome))


async def _envio(conexao, campanha, lead) -> str:
    return str(await conexao.fetchval(
        "INSERT INTO campaign_sends (campaign_id, lead_id, channel, status) "
        "VALUES ($1::uuid, $2::uuid, 'email', 'sent') RETURNING id", campanha, lead))


@pytest.fixture
def marca():
    return uuid4().hex[:10]


@pytest.fixture(params=["service_role", "authenticated"])
def papel(request):
    return request.param


async def _fundir(conexao, papel, manter, descartar) -> dict:
    """Chama `fundir_leads` no papel pedido e volta a `service_role` para as
    conferências (BYPASSRLS: vê o que o admin não visse)."""
    if papel == "service_role":
        return await fundir_leads(conexao, manter, descartar)
    admin = await conexao.fetchval(
        "SELECT user_id::text FROM user_roles WHERE role = 'admin' LIMIT 1")
    if admin is None:
        pytest.skip("nenhum admin em user_roles")
    await conexao.execute("SELECT set_config('app.current_user_id', $1, true)", admin)
    await conexao.execute("SET LOCAL ROLE authenticated")
    try:
        return await fundir_leads(conexao, manter, descartar)
    finally:
        await conexao.execute("SET LOCAL ROLE service_role")
        await conexao.execute("SELECT set_config('app.current_user_id', '', true)")


async def test_fusao_reatribui_todo_o_historico(conexao, marca, papel):
    m = await _lead(conexao, "mantido")
    d = await _lead(conexao, "descartado")

    # Jornadas: J1 os dois abertos (colidiria no uniq_journey_runs_open),
    # J2 só o descartado aberto, J3 o descartado já concluído.
    j1, j2, j3 = [await _jornada(conexao, f"fusão {n} {marca}") for n in (1, 2, 3)]
    run_m_j1 = await _run(conexao, j1, m)
    run_d_j1 = await _run(conexao, j1, d)
    run_d_j2 = await _run(conexao, j2, d, "active")
    run_d_j3 = await _run(conexao, j3, d, "done")
    await conexao.execute(
        "INSERT INTO journey_step_log (run_id, journey_id, lead_id, node_id, node_type, result) "
        "VALUES ($1::uuid, $2::uuid, $3::uuid, 'n1', 'send_email', 'ok')", run_d_j3, j3, d)

    # Comercial: os dois com 'criar' pendente (colidiria no
    # uniq_crm_handoffs_pendente); o descartado ainda tem um 'criar' entregue e
    # um 'mover' pendente (que não colidem).
    pend_m = await conexao.fetchval(
        "INSERT INTO crm_handoffs (lead_id, acao, origem) VALUES ($1::uuid, 'criar', 'manual') "
        "RETURNING id", m)
    await conexao.execute(
        "INSERT INTO crm_handoffs (lead_id, acao, origem) VALUES ($1::uuid, 'criar', 'regra')", d)
    await conexao.execute(
        "INSERT INTO crm_handoffs (lead_id, acao, origem, status, card_id) "
        "VALUES ($1::uuid, 'criar', 'manual', 'entregue', 4821)", d)
    await conexao.execute(
        "INSERT INTO crm_handoffs (lead_id, acao, origem) VALUES ($1::uuid, 'mover', 'regra')", d)

    # Campanhas: C1 os dois receberam (colidiria no
    # uniq_campaign_sends_email_campaign_lead); C2 só o descartado.
    c1, c2 = await _campanha(conexao, f"fusão C1 {marca}"), await _campanha(conexao, f"fusão C2 {marca}")
    await _envio(conexao, c1, m)
    envio_d_c1 = await _envio(conexao, c1, d)
    envio_d_c2 = await _envio(conexao, c2, d)
    await conexao.execute(
        "INSERT INTO email_send_queue (send_id, campaign_id, lead_id) "
        "VALUES ($1::uuid, $2::uuid, $3::uuid)", envio_d_c2, c2, d)
    await conexao.execute(
        "INSERT INTO email_send_dead (send_id, campaign_id, lead_id, tentativas) "
        "VALUES ($1::uuid, $2::uuid, $3::uuid, 5)", envio_d_c2, c2, d)
    await conexao.execute(
        "INSERT INTO email_events (svix_id, event_type, payload, occurred_at, campaign_id, lead_id) "
        "VALUES ($1, 'email.opened', '{}'::jsonb, now(), $2::uuid, $3::uuid)",
        f"teste-fusao-{marca}", c2, d)
    await conexao.execute(
        "INSERT INTO email_suppressions (email, reason, source, lead_id) "
        "VALUES ($1, 'unsubscribe', 'teste', $2::uuid)",
        f"fusao-supressao-{marca}@exemplo.invalid", d)
    await conexao.execute(
        "INSERT INTO ab_events (ab_test, ab_var, ab_vid, event_type, lead_id) "
        "VALUES ($1, 'A', $2, 'conversion', $3::uuid)", f"teste-fusao-{marca}",
        f"v_teste-fusao-{marca}", d)
    await conexao.execute(
        "INSERT INTO ab_identities (ab_vid, lead_id) VALUES ($1, $2::uuid)",
        f"v_teste-fusao-{marca}", d)
    await conexao.execute(
        "INSERT INTO lead_conversions (lead_id, tipo) VALUES ($1::uuid, 'diagnostico')", d)
    # Etiqueta, segmento e nota: uma do descartado sozinho (vai) e uma que os
    # dois têm (a repetida sai).
    t1, t2 = [await conexao.fetchval(
        "INSERT INTO tags (name) VALUES ($1) RETURNING id", f"teste-fusao-{n}-{marca}")
        for n in (1, 2)]
    s1, s2 = [await conexao.fetchval(
        "INSERT INTO segments (name) VALUES ($1) RETURNING id", f"teste-fusao-{n}-{marca}")
        for n in (1, 2)]
    for lead, tag, seg in ((m, t1, s1), (d, t1, s1), (d, t2, s2)):
        await conexao.execute(
            "INSERT INTO lead_tags (lead_id, tag_id) VALUES ($1::uuid, $2)", lead, tag)
        await conexao.execute(
            "INSERT INTO segment_contacts (segment_id, lead_id) VALUES ($1, $2::uuid)", seg, lead)
    await conexao.execute(
        "INSERT INTO lead_notes (lead_id, content) VALUES ($1::uuid, 'nota do descartado')", d)

    resultado = await _fundir(conexao, papel, m, d)

    # Nenhuma tabela "andou" zero: sob `authenticated`, 0 aqui é a política
    # que falta, não a ausência de histórico (as 15 foram semeadas).
    parados = [t for t in _TABELAS_FILHAS if resultado["movidos"][t] < 1]
    assert parados == [], parados
    assert resultado["resolvidos"]["lead_tags_repetidos"] == 1
    assert resultado["resolvidos"]["segment_contacts_repetidos"] == 1

    assert await conexao.fetchval("SELECT count(*) FROM leads WHERE id = $1::uuid", d) == 0
    # Nada do histórico ficou com o id do descartado (as tabelas sem FK
    # ficariam apontando para um contato que não existe mais).
    for tabela in _TABELAS_FILHAS:
        assert await conexao.fetchval(
            f"SELECT count(*) FROM {tabela} WHERE lead_id = $1::uuid", d) == 0, tabela

    # Jornadas: o run do mantido segue intacto; o do descartado no MESMO fluxo
    # veio encerrado; os outros vieram como estavam.
    runs = {str(r["id"]): r for r in await conexao.fetch(
        "SELECT id, lead_id::text, state, context FROM journey_runs WHERE id = ANY($1::uuid[])",
        [run_m_j1, run_d_j1, run_d_j2, run_d_j3])}
    assert len(runs) == 4  # o CASCADE não levou nenhum
    assert all(r["lead_id"] == m for r in runs.values())
    assert runs[run_m_j1]["state"] == "waiting"
    assert runs[run_d_j1]["state"] == "exited"
    contexto = runs[run_d_j1]["context"]
    contexto = json.loads(contexto) if isinstance(contexto, str) else contexto
    assert contexto["encerrado_por"] == "fusao" and contexto["fundido_em"] == m
    assert runs[run_d_j2]["state"] == "active"
    assert runs[run_d_j3]["state"] == "done"
    assert await conexao.fetchval(
        "SELECT lead_id::text FROM journey_step_log WHERE run_id = $1::uuid", run_d_j3) == m
    assert resultado["resolvidos"]["runs_encerrados"] == 1

    # Comercial: um só 'criar' pendente (o do mantido), o entregue e o
    # 'mover' do descartado vieram.
    pedidos = await conexao.fetch(
        "SELECT id, acao, status FROM crm_handoffs WHERE lead_id = $1::uuid ORDER BY id", m)
    assert [(p["acao"], p["status"]) for p in pedidos] == [
        ("criar", "pendente"), ("criar", "entregue"), ("mover", "pendente")]
    assert pedidos[0]["id"] == pend_m
    assert resultado["resolvidos"]["pedidos_repetidos"] == 1

    # Campanhas: o envio de C1 do descartado não pode ir (um e-mail por
    # campanha e contato) e fica sem dono, como ficava antes da fusão existir;
    # o de C2 veio, com a fila e a fila morta.
    assert await conexao.fetchval(
        "SELECT lead_id FROM campaign_sends WHERE id = $1::uuid", envio_d_c1) is None
    assert await conexao.fetchval(
        "SELECT lead_id::text FROM campaign_sends WHERE id = $1::uuid", envio_d_c2) == m
    for tabela in ("email_send_queue", "email_send_dead"):
        assert await conexao.fetchval(
            f"SELECT lead_id::text FROM {tabela} WHERE send_id = $1::uuid", envio_d_c2) == m

    # E o resto do histórico.
    for tabela, filtro, valor in (
            ("email_events", "svix_id", f"teste-fusao-{marca}"),
            ("email_suppressions", "email", f"fusao-supressao-{marca}@exemplo.invalid"),
            ("ab_events", "ab_test", f"teste-fusao-{marca}"),
            ("ab_identities", "ab_vid", f"v_teste-fusao-{marca}")):
        assert await conexao.fetchval(
            f"SELECT lead_id::text FROM {tabela} WHERE {filtro} = $1", valor) == m, tabela
    assert await conexao.fetchval(
        "SELECT count(*) FROM lead_conversions WHERE lead_id = $1::uuid", m) == 1
    assert await conexao.fetchval(
        "SELECT count(*) FROM lead_tags WHERE lead_id = $1::uuid "
        "AND tag_id = ANY($2::uuid[])", m, [t1, t2]) == 2
    assert await conexao.fetchval(
        "SELECT count(*) FROM segment_contacts WHERE lead_id = $1::uuid "
        "AND segment_id = ANY($2::uuid[])", m, [s1, s2]) == 2
    assert await conexao.fetchval(
        "SELECT count(*) FROM lead_notes WHERE lead_id = $1::uuid", m) == 1


async def test_fusao_sem_colisao_nao_encerra_nem_apaga_nada(conexao, marca, papel):
    """A regra de colisão só age quando há colisão: run aberto em fluxo
    diferente e pedido de ação diferente vão inteiros."""
    m = await _lead(conexao, "mantido")
    d = await _lead(conexao, "descartado")
    j1, j2 = [await _jornada(conexao, f"fusão {n} {marca}") for n in (1, 2)]
    await _run(conexao, j1, m)
    run_d = await _run(conexao, j2, d)
    await conexao.execute(
        "INSERT INTO crm_handoffs (lead_id, acao, origem) VALUES ($1::uuid, 'criar', 'manual')", m)
    await conexao.execute(
        "INSERT INTO crm_handoffs (lead_id, acao, origem) VALUES ($1::uuid, 'mover', 'regra')", d)

    resultado = await _fundir(conexao, papel, m, d)

    assert resultado["movidos"]["journey_runs"] == 1
    assert resultado["movidos"]["crm_handoffs"] == 1
    assert resultado["resolvidos"]["runs_encerrados"] == 0
    assert resultado["resolvidos"]["pedidos_repetidos"] == 0
    assert await conexao.fetchval(
        "SELECT state FROM journey_runs WHERE id = $1::uuid", run_d) == "waiting"
    assert await conexao.fetchval(
        "SELECT count(*) FROM crm_handoffs WHERE lead_id = $1::uuid AND status = 'pendente'",
        m) == 2


async def test_authenticated_pode_apagar_a_fila_de_jornada(conexao):
    """A 024. Enquanto ela não estiver aplicada, os testes da fusão sob
    `authenticated` ficam vermelhos com permissão negada em `journey_events` —
    este diz o porquê numa linha."""
    assert await conexao.fetchval(
        "SELECT has_table_privilege('authenticated', 'public.journey_events', 'DELETE')"), \
        "migration 024 não aplicada: rode ~/marketinghs-migration-024.sh"


async def test_fusao_apaga_a_fila_de_jornada_do_descartado(conexao, marca, papel):
    """Pergunta 40 (a), 02/10/2026: `journey_events` é fila de trânsito, sem FK
    e fora de `_TABELAS_FILHAS`. Sem limpeza, o evento do descartado ficava
    apontando para um lead que não existe mais. A fusão o apaga na mesma
    transação — sob `authenticated` também, que não tem DELETE na tabela — e
    devolve o papel de quem chamou, sem mexer na fila do mantido."""
    m = await _lead(conexao, "mantido")
    d = await _lead(conexao, "descartado")
    for lead in (m, d, d):
        await conexao.execute(
            "INSERT INTO journey_events (lead_id, event_type, metadata) "
            "VALUES ($1::uuid, 'teste_fusao', jsonb_build_object('marca', $2::text))",
            lead, marca)
    fila_m = await conexao.fetchval(
        "SELECT count(*) FROM journey_events WHERE lead_id = $1::uuid", m)
    assert await conexao.fetchval(
        "SELECT count(*) FROM journey_events WHERE lead_id = $1::uuid", d) >= 2

    if papel == "service_role":
        resultado = await fundir_leads(conexao, m, d)
        assert await conexao.fetchval("SELECT current_user") == "service_role"
    else:
        admin = await conexao.fetchval(
            "SELECT user_id::text FROM user_roles WHERE role = 'admin' LIMIT 1")
        if admin is None:
            pytest.skip("nenhum admin em user_roles")
        await conexao.execute("SELECT set_config('app.current_user_id', $1, true)", admin)
        await conexao.execute("SET LOCAL ROLE authenticated")
        try:
            resultado = await fundir_leads(conexao, m, d)
            # A elevação para apagar a fila não pode vazar para o resto da
            # transação de quem chamou.
            assert await conexao.fetchval("SELECT current_user") == "authenticated"
            assert await conexao.fetchval(
                "SELECT current_setting('app.current_user_id', true)") == admin
        finally:
            await conexao.execute("SET LOCAL ROLE service_role")
            await conexao.execute("SELECT set_config('app.current_user_id', '', true)")

    assert resultado["fila_de_jornada_apagada"] >= 2
    assert await conexao.fetchval(
        "SELECT count(*) FROM journey_events WHERE lead_id = $1::uuid", d) == 0
    assert await conexao.fetchval(
        "SELECT count(*) FROM journey_events WHERE lead_id = $1::uuid", m) == fila_m
