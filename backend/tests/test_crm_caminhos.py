"""Os três caminhos até a fila de entrega.

O modo de falhar é o da origem que este lote conserta: regra cadastrada que
nunca dispara, e ninguém percebe, porque a tela de automações mostra a regra
"ativa". E o inverso: uma regra mal preenchida derrubando a gravação do lead.
"""

import re
import uuid

import pytest_asyncio

import app.database as db
from app.jornadas import executor

# ⚠️ Único por processo do pytest: com o e-mail fixo, duas rodadas ao mesmo
# tempo batiam em `leads_email_unique` (o `lead_real` de uma COMITA o lead e o
# `_lead` da outra colide). A pré-limpeza do `lead_real` apaga o que uma rodada
# MORTA deixou: a forma exata do e-mail e mais de 2 h de vida — nunca o lead de
# uma rodada viva. O e-mail fixo antigo entra pelo nome exato.
EMAIL_ANTIGO = "caminhos-8d@exemplo.invalid"
EMAIL = f"caminhos-8d-{uuid.uuid4().hex[:12]}@exemplo.invalid"
_RE_EMAIL = r"^caminhos-8d-[0-9a-f]{12}@exemplo\.invalid$"
assert re.match(_RE_EMAIL, EMAIL)


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _regra(conexao, condicoes, acao="create_in_growthhs", prioridade=0, logica="and"):
    return str(await conexao.fetchval(
        """INSERT INTO automation_rules (name, priority, condition_type, condition_operator,
                                         condition_value, conditions, condition_logic, action_type)
           VALUES ('8D', $1, 'etiqueta', 'is', 'x', $2::jsonb, $3, $4) RETURNING id""",
        prioridade, condicoes, logica, acao))


async def _lead(conexao, **campos) -> str:
    campos = {"nome": "Caminhos 8D", "email": EMAIL, "tipo": "teste", **campos}
    nomes = ", ".join(campos)
    marcas = ", ".join(f"${i}" for i in range(1, len(campos) + 1))
    return str(await conexao.fetchval(
        f"INSERT INTO leads ({nomes}) VALUES ({marcas}) RETURNING id", *campos.values()))


async def _pedidos(conexao, lead):
    return await conexao.fetch(
        "SELECT acao, origem, rule_id::text FROM crm_handoffs WHERE lead_id = $1::uuid", lead)


async def test_regra_de_etiqueta_enfileira_ao_mudar(conexao):
    regra = await _regra(conexao, [{"type": "etiqueta", "operator": "is", "value": "hotlead"}])
    lead = await _lead(conexao)
    assert await _pedidos(conexao, lead) == []
    await conexao.execute("UPDATE leads SET etiqueta = 'hotlead' WHERE id = $1::uuid", lead)
    assert [dict(p) for p in await _pedidos(conexao, lead)] == [
        {"acao": "criar", "origem": "regra", "rule_id": regra}]


async def test_regra_de_status_tambem_dispara(conexao):
    """A origem só avaliava na mudança de ETIQUETA (achado 7). ⚠️ `leads.status`
    tem FK para `lead_statuses` (8B): o valor tem de existir lá."""
    lead = await _lead(conexao)
    atual = await conexao.fetchval("SELECT status FROM leads WHERE id = $1::uuid", lead)
    alvo = await conexao.fetchval(
        "SELECT name FROM lead_statuses WHERE name IS DISTINCT FROM $1 "
        "ORDER BY sort_order DESC LIMIT 1", atual)
    await _regra(conexao, [{"type": "status", "operator": "is", "value": alvo}])
    await conexao.execute("UPDATE leads SET status = $2 WHERE id = $1::uuid", lead, alvo)
    assert len(await _pedidos(conexao, lead)) == 1


async def test_bloqueio_de_prioridade_maior_para_a_avaliacao(conexao):
    # ⚠️ `_lead(conexao, etiqueta=...)` não sobrevive: `trg_score_lead_on_change`
    # (BEFORE INSERT, incondicional) recalcula `etiqueta` a partir de
    # `scoring_config` em TODO INSERT e sobrescreve o que foi pedido. Por
    # isso a etiqueta é definida por UPDATE (que só recalcula se a lista de
    # colunas do próprio gatilho de score mudar — nome não está nela).
    await _regra(conexao, [{"type": "etiqueta", "operator": "is", "value": "hotlead"}],
                 acao="block_growthhs", prioridade=10)
    await _regra(conexao, [{"type": "etiqueta", "operator": "is", "value": "hotlead"}],
                 prioridade=1)
    lead = await _lead(conexao)
    await conexao.execute("UPDATE leads SET etiqueta = 'hotlead' WHERE id = $1::uuid", lead)
    assert await _pedidos(conexao, lead) == []


async def test_regra_mal_formada_nao_derruba_a_gravacao_do_lead(conexao):
    """`'abc'::int` estoura dentro do gatilho — na origem, abortava o INSERT do
    lead. (O `lead_score` é recalculado por `trg_score_lead_on_change`; o valor
    não importa aqui, o cast falha antes da comparação.)"""
    await _regra(conexao, [{"type": "score", "operator": "greater_than", "value": "abc"}])
    lead = await _lead(conexao)
    assert await conexao.fetchval("SELECT count(*) FROM leads WHERE id = $1::uuid", lead) == 1


async def test_regra_quebrada_nao_bloqueia_regra_valida_de_prioridade_menor(conexao):
    """Achado 8, visto do outro lado: a regra quebrada é IGNORADA (loga e
    segue o laço), não um bloqueio — uma regra válida de prioridade MENOR
    ainda tem a chance de casar e enfileirar."""
    await _regra(conexao, [{"type": "score", "operator": "greater_than", "value": "abc"}],
                 prioridade=10)
    await _regra(conexao, [{"type": "etiqueta", "operator": "is", "value": "hotlead"}],
                 prioridade=1)
    lead = await _lead(conexao)
    await conexao.execute("UPDATE leads SET etiqueta = 'hotlead' WHERE id = $1::uuid", lead)
    assert len(await _pedidos(conexao, lead)) == 1


async def test_mover_etapa_enfileira_como_mover(conexao):
    # ⚠️ Mesmo motivo do teste de bloqueio: `trg_score_lead_on_change`
    # sobrescreveria a etiqueta pedida no INSERT — por isso o UPDATE.
    await _regra(conexao, [{"type": "etiqueta", "operator": "is", "value": "hotlead"}],
                 acao="move_stage_growthhs")
    lead = await _lead(conexao)
    await conexao.execute("UPDATE leads SET etiqueta = 'hotlead' WHERE id = $1::uuid", lead)
    assert [p["acao"] for p in await _pedidos(conexao, lead)] == ["mover"]


async def test_update_sem_coluna_relevante_nao_reavalia(conexao):
    """Achado do 8D: sem lista de colunas no `UPDATE OF` do gatilho (migration
    019), quem decide reavaliar ou não é a saída cedo da função — que já
    compara OLD/NEW de etiqueta, status e lead_score. Um UPDATE em qualquer
    outra coluna (aqui, `nome`) não deve enfileirar nada."""
    await _regra(conexao, [{"type": "etiqueta", "operator": "is", "value": "hotlead"}])
    lead = await _lead(conexao)
    await conexao.execute("UPDATE leads SET nome = 'Outro nome' WHERE id = $1::uuid", lead)
    assert await _pedidos(conexao, lead) == []
    await conexao.execute("UPDATE leads SET etiqueta = 'hotlead' WHERE id = $1::uuid", lead)
    assert len(await _pedidos(conexao, lead)) == 1


async def test_efeito_colateral_do_score_dispara_a_regra(conexao):
    """O defeito herdado que a mudança 6 corrige: a origem restringia o
    gatilho a `UPDATE OF etiqueta`, então uma etiqueta trocada como EFEITO
    COLATERAL de `trg_score_lead_on_change` (que roda ao mudar cargo,
    faturamento etc.) nunca disparava a regra — o gatilho só via a lista de
    colunas do PRÓPRIO UPDATE (`cargo`), nunca o que a trigger BEFORE fez de
    fato com `etiqueta`. Sem lista de colunas (019), a regra dispara.

    ⚠️ Mexe em `scoring_config` para o teste ser determinístico, sem depender
    dos critérios de produção — está dentro de `conexao` (rollback garantido
    pela fixture), nunca some com a configuração de verdade.
    """
    await conexao.execute(
        "UPDATE scoring_config SET criteria = $1::jsonb, thresholds = $2::jsonb",
        {"cargo_decisor": {"enabled": True, "points": 100, "cargos": ["CEO"]}},
        {"warm": 10, "hotlead": 50})
    await _regra(conexao, [{"type": "etiqueta", "operator": "is", "value": "hotlead"}])
    lead = await _lead(conexao)
    assert await _pedidos(conexao, lead) == []

    await conexao.execute("UPDATE leads SET cargo = 'CEO' WHERE id = $1::uuid", lead)
    assert await conexao.fetchval(
        "SELECT etiqueta FROM leads WHERE id = $1::uuid", lead) == "hotlead"
    assert len(await _pedidos(conexao, lead)) == 1


async def test_no_de_jornada_enfileira_e_avanca(conexao, monkeypatch):
    lead = await _lead(conexao)
    passos = []

    async def registrar(conn, run, no, resultado, detalhe=None):
        passos.append((resultado, detalhe))
    monkeypatch.setattr(executor, "registrar_passo", registrar)

    run = {"run_id": "00000000-0000-0000-0000-0000000000a1", "lead_id": lead,
           "journey_id": "00000000-0000-0000-0000-0000000000b1", "context": {}}
    no = {"id": "n1", "type": "handoff_growthhs", "config": {}, "next": "n2"}
    saida = await executor.executar_no(conexao, run, no)
    assert saida == {"tipo": "avancar", "proximo": "n2"}
    assert [p["origem"] for p in await _pedidos(conexao, lead)] == ["jornada"]
    assert passos[0][0] == "enqueued"


@pytest_asyncio.fixture
async def lead_real():
    await db.init_db()

    async def limpar():
        # `fn_lead_insert_event` grava contact_event (e journey_event) sem FK.
        async with db.sessao(role="service_role") as conn:
            ids = [r["id"] for r in await conn.fetch(
                """SELECT id FROM leads
                    WHERE email = $1 OR email = $2
                       OR (email ~ $3 AND created_at < now() - interval '2 hours')""",
                EMAIL, EMAIL_ANTIGO, _RE_EMAIL)]
            await conn.execute("DELETE FROM journey_events WHERE lead_id = ANY($1::uuid[])", ids)
            await conn.execute("DELETE FROM contact_events WHERE lead_id = ANY($1::uuid[])", ids)
            await conn.execute("DELETE FROM leads WHERE id = ANY($1::uuid[])", ids)
    await limpar()
    async with db.sessao(role="service_role") as conn:
        lead = await conn.fetchval(
            "INSERT INTO leads (nome, email, tipo) VALUES ('Botão 8D', $1, 'teste') "
            "RETURNING id::text", EMAIL)
    yield lead
    await limpar()


async def test_botao_manual_exige_admin_e_enfileira_uma_vez(cliente, token_admin,
                                                            token_usuario, lead_real):
    r = await cliente.post(f"/crm/enviar/{lead_real}", headers=_auth(token_usuario))
    assert r.status_code == 403
    r = await cliente.post(f"/crm/enviar/{lead_real}", headers=_auth(token_admin))
    assert r.status_code == 202 and r.json()["ja_na_fila"] is False
    r = await cliente.post(f"/crm/enviar/{lead_real}", headers=_auth(token_admin))
    assert r.json() == {"handoff_id": None, "ja_na_fila": True}
    r = await cliente.post("/crm/enviar/00000000-0000-0000-0000-000000000000",
                           headers=_auth(token_admin))
    assert r.status_code == 404


async def test_botao_manual_404_para_lead_apagado(cliente, token_admin, lead_real):
    """Exclusão é lógica (`deleted_at`) — a rota não pode oferecer ao GrowthHS
    um contato que a tela já trata como apagado."""
    async with db.sessao(role="service_role") as conn:
        await conn.execute(
            "UPDATE leads SET deleted_at = now() WHERE id = $1::uuid", lead_real)
    r = await cliente.post(f"/crm/enviar/{lead_real}", headers=_auth(token_admin))
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Revisão final do 8D — I1, I4, I6
# ---------------------------------------------------------------------------

async def test_lead_ja_entregue_nao_volta_para_a_fila(conexao):
    """I4: o gatilho reavalia a cada mudança de etiqueta/status/pontuação —
    sem esta guarda, o lead já entregue reentrava na fila a cada mudança (e
    cada pedido virava uma linha "já estava no comercial")."""
    await _regra(conexao, [{"type": "status", "operator": "is_not", "value": "__nenhum__"}])
    lead = await _lead(conexao)
    await conexao.execute(
        "UPDATE crm_handoffs SET status = 'entregue', card_id = 4821 WHERE lead_id = $1::uuid",
        lead)
    await conexao.execute("UPDATE leads SET etiqueta = 'hotlead' WHERE id = $1::uuid", lead)
    await conexao.execute("UPDATE leads SET etiqueta = 'warm' WHERE id = $1::uuid", lead)
    assert await conexao.fetchval(
        "SELECT count(*) FROM crm_handoffs WHERE lead_id = $1::uuid AND status = 'pendente'",
        lead) == 0


REGRA_BASE = {"name": "8D revisão", "condition_type": "etiqueta", "condition_operator": "is",
              "condition_value": "hotlead", "action_type": "create_in_growthhs"}
MSG_TAG = ("Condição por tag ainda não dispara envio ao GrowthHS; use etiqueta, status, "
           "pontuação ou data de criação.")
MSG_MOVER = ("O GrowthHS ainda não tem rota para mover card de etapa — regra de mover fica "
             "disponível quando o contrato tiver a rota.")
REGRA_ALHEIA = "00000000-0000-0000-0000-000000000000"


@pytest_asyncio.fixture
async def sem_regra_de_teste():
    """⚠️ Estes testes passam pelas rotas, que COMITAM no banco de produção. Se
    a recusa falhar (foi o que aconteceu na rodada vermelha), a regra fica
    gravada e ATIVA — e dispara em lead de verdade. Apaga antes e depois."""
    await db.init_db()

    async def limpar():
        async with db.sessao(role="service_role") as conn:
            await conn.execute("DELETE FROM automation_rules WHERE name = $1",
                               REGRA_BASE["name"])
    await limpar()
    yield
    await limpar()


async def test_regra_por_tag_e_recusada_ao_salvar(cliente, token_admin, chave_de,
                                                   sem_regra_de_teste):
    """I1: o gatilho não tem ramo 'tag' (nem a origem tinha) e adicionar tag
    grava `lead_tags`, não `leads` — a regra ficaria "ativa" sem nunca
    disparar. Recusar ao salvar, nas rotas de admin e nas públicas."""
    por_lista = {**REGRA_BASE, "conditions": [{"type": "tag", "operator": "contains",
                                               "value": "vip"}]}
    por_campo = {**REGRA_BASE, "condition_type": "tag", "condition_operator": "contains"}
    admin = _auth(token_admin)
    chave = _auth(await chave_de("write"))
    for corpo in (por_lista, por_campo):
        for rota, cab in (("/automacoes", admin), ("/publico/automacoes", chave)):
            r = await cliente.post(rota, json=corpo, headers=cab)
            assert r.status_code == 400 and r.json()["detail"] == MSG_TAG, (rota, r.text)
            r = await cliente.patch(f"{rota}/{REGRA_ALHEIA}", json=corpo, headers=cab)
            assert r.status_code == 400 and r.json()["detail"] == MSG_TAG, (rota, r.text)


async def test_regra_de_mover_e_recusada_ao_salvar(cliente, token_admin, chave_de,
                                                    sem_regra_de_teste):
    """I4: sem rota de mover no contrato, a regra só gerava um fluxo de
    falhas. Recusar ao salvar."""
    corpo = {**REGRA_BASE, "action_type": "move_stage_growthhs"}
    admin = _auth(token_admin)
    chave = _auth(await chave_de("write"))
    for rota, cab in (("/automacoes", admin), ("/publico/automacoes", chave)):
        r = await cliente.post(rota, json=corpo, headers=cab)
        assert r.status_code == 400 and r.json()["detail"] == MSG_MOVER, (rota, r.text)
        r = await cliente.patch(f"{rota}/{REGRA_ALHEIA}",
                                json={"action_type": "move_stage_growthhs"}, headers=cab)
        assert r.status_code == 400 and r.json()["detail"] == MSG_MOVER, (rota, r.text)


async def test_estado_do_crm_so_diz_se_esta_configurado(cliente, token_usuario):
    """I6: as telas precisam saber se o GrowthHS está ligado para não dizer
    "enviado" quando o pedido só vai esperar — e nada além disso vaza para
    quem não é admin."""
    r = await cliente.get("/crm/estado")
    assert r.status_code == 401
    r = await cliente.get("/crm/estado", headers=_auth(token_usuario))
    assert r.status_code == 200
    assert set(r.json()) == {"configurado"} and isinstance(r.json()["configurado"], bool)
