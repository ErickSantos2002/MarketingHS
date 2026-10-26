"""Sem DataCore (pergunta 80, 26/10/2026).

Nada que veio do DataCore (ERP Tiny, a base de clientes) vai ao comercial, e
a sincronização saiu da tela e da API. Os modos de falhar que estes testes
pegam:

- a rota de sincronização voltar (alguém reinclui o router) e recarregar a
  base de clientes que acabou de ser apagada;
- um caminho até `crm_handoffs` que não confere a origem — o botão, o nó de
  jornada, a regra (que é gatilho de banco, migration 033) ou a entrega de
  um pedido que já estava na fila;
- e o oposto, que é o corte silencioso: a trava pegar também o contato de
  landing ou CSV, que tem de continuar indo.
"""

import importlib
import uuid

import pytest
import pytest_asyncio

import app.database as db
from app.crm import entrega
from app.jornadas import executor


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _lead(conexao, origem, email=None) -> str:
    email = email or f"sem-datacore-{uuid.uuid4().hex[:12]}@exemplo.invalid"
    return str(await conexao.fetchval(
        "INSERT INTO leads (nome, email, tipo, source) VALUES ('Sem DataCore', $1, 'teste', $2) "
        "RETURNING id", email, origem))


async def _pedidos(conexao, lead) -> int:
    return await conexao.fetchval(
        "SELECT count(*) FROM crm_handoffs WHERE lead_id = $1::uuid", lead)


# ── A sincronização saiu ─────────────────────────────────────────────────────

@pytest.mark.parametrize("metodo,rota", [("GET", "/datacore/previa"),
                                         ("POST", "/datacore/sincronizar")])
async def test_rotas_do_datacore_nao_existem(cliente, token_admin, metodo, rota):
    r = await cliente.request(metodo, rota, headers=_auth(token_admin))
    assert r.status_code == 404


def test_pool_do_datacore_nao_abre_no_boot():
    assert not hasattr(db, "init_datacore")
    assert not hasattr(db, "sessao_datacore")


@pytest.mark.parametrize("modulo", ["app.routers.datacore", "app.dominio.datacore",
                                    "app.dominio.sincronizacao_datacore"])
def test_modulos_da_sincronizacao_sairam(modulo):
    with pytest.raises(ModuleNotFoundError):
        importlib.import_module(modulo)


# ── enfileirar: o botão e o nó passam por aqui ──────────────────────────────

@pytest.mark.parametrize("origem", ["datacore", " DataCore "])
async def test_enfileirar_recusa_contato_do_datacore(conexao, origem):
    lead = await _lead(conexao, origem)
    with pytest.raises(entrega.ContatoRecusado) as erro:
        await entrega.enfileirar(conexao, lead, "manual")
    assert "DataCore" in str(erro.value)
    assert await _pedidos(conexao, lead) == 0


@pytest.mark.parametrize("origem", ["csv_import", "landing_page", "formulario", None])
async def test_enfileirar_aceita_landing_csv_e_sem_origem(conexao, origem):
    lead = await _lead(conexao, origem)
    assert await entrega.enfileirar(conexao, lead, "manual") is not None
    assert await _pedidos(conexao, lead) == 1


# ── O nó de jornada ──────────────────────────────────────────────────────────

async def test_no_de_jornada_pula_contato_do_datacore_e_segue(conexao, monkeypatch):
    lead = await _lead(conexao, "datacore")
    passos = []

    async def registrar(conn, run, no, resultado, detalhe=None):
        passos.append((resultado, detalhe))
    monkeypatch.setattr(executor, "registrar_passo", registrar)

    run = {"run_id": "00000000-0000-0000-0000-0000000000c1", "lead_id": lead,
           "journey_id": "00000000-0000-0000-0000-0000000000d1", "context": {}}
    no = {"id": "n1", "type": "handoff_growthhs", "config": {}, "next": "n2"}
    assert await executor.executar_no(conexao, run, no) == {"tipo": "avancar", "proximo": "n2"}
    assert await _pedidos(conexao, lead) == 0
    [(resultado, detalhe)] = passos
    assert resultado == "skipped"
    assert "DataCore" in detalhe["motivo"]


# ── A regra (gatilho de banco) e qualquer INSERT direto — migration 033 ──────

async def _regra_de_etiqueta(conexao):
    await conexao.execute(
        """INSERT INTO automation_rules (name, priority, condition_type, condition_operator,
                                         condition_value, conditions, condition_logic,
                                         action_type)
           VALUES ('sem datacore', 0, 'etiqueta', 'is', 'x', $1::jsonb, 'and',
                   'create_in_growthhs')""",
        [{"type": "etiqueta", "operator": "is", "value": "hotlead"}])


async def test_regra_nao_enfileira_contato_do_datacore(conexao):
    await _regra_de_etiqueta(conexao)
    dc = await _lead(conexao, "datacore")
    csv = await _lead(conexao, "csv_import")
    await conexao.execute(
        "UPDATE leads SET etiqueta = 'hotlead' WHERE id = ANY($1::uuid[])", [dc, csv])
    assert await _pedidos(conexao, dc) == 0
    assert await _pedidos(conexao, csv) == 1  # o de CSV continua indo


async def test_insert_direto_na_fila_descarta_contato_do_datacore(conexao):
    dc = await _lead(conexao, "DATACORE")
    await conexao.execute(
        "INSERT INTO crm_handoffs (lead_id, acao, origem) VALUES ($1::uuid, 'criar', 'manual')",
        dc)
    assert await _pedidos(conexao, dc) == 0


# ── O botão "Enviar ao comercial" ────────────────────────────────────────────

@pytest_asyncio.fixture
async def leads_do_botao():
    """Dois contatos COMITADOS (a rota abre a própria sessão): um do DataCore
    e um de landing. Apagados com o que a rota grava."""
    await db.init_db()
    sufixo = uuid.uuid4().hex[:12]
    emails = [f"sem-datacore-botao-dc-{sufixo}@exemplo.invalid",
              f"sem-datacore-botao-lp-{sufixo}@exemplo.invalid"]
    async with db.sessao(role="service_role") as conn:
        dc = await conn.fetchval(
            "INSERT INTO leads (nome, email, tipo, source) "
            "VALUES ('Botão DataCore', $1, 'teste', 'datacore') RETURNING id::text", emails[0])
        lp = await conn.fetchval(
            "INSERT INTO leads (nome, email, tipo, source) "
            "VALUES ('Botão landing', $1, 'teste', 'landing_page') RETURNING id::text",
            emails[1])
    yield {"datacore": dc, "landing": lp}
    async with db.sessao(role="service_role") as conn:
        ids = [dc, lp]
        await conn.execute("DELETE FROM crm_handoffs WHERE lead_id = ANY($1::uuid[])", ids)
        await conn.execute("DELETE FROM journey_events WHERE lead_id = ANY($1::uuid[])", ids)
        await conn.execute("DELETE FROM contact_events WHERE lead_id = ANY($1::uuid[])", ids)
        await conn.execute("DELETE FROM leads WHERE id = ANY($1::uuid[])", ids)


async def test_botao_recusa_contato_do_datacore_com_409(cliente, token_admin, leads_do_botao):
    r = await cliente.post(f"/crm/enviar/{leads_do_botao['datacore']}",
                           headers=_auth(token_admin))
    assert r.status_code == 409
    assert "DataCore" in r.json()["detail"]

    r = await cliente.post(f"/crm/enviar/{leads_do_botao['landing']}",
                           headers=_auth(token_admin))
    assert r.status_code == 202 and r.json()["ja_na_fila"] is False
