"""Operação em massa não dispara automação; evento individual dispara.

Decisão 6 do Erick (01/10/2026). Os dois lados:

- **em massa** — recálculo de pontuação (`contatos.recalcular`) e
  sincronização do DataCore (`sincronizar`) atualizam o dado e NÃO criam
  pedido em `crm_handoffs` nem linha em `journey_events`;
- **individual** — captura (INSERT de lead) e mudança manual de status
  continuam criando o pedido e a linha da fila de jornada.

⚠️ O lado "em massa" depende da migration 023 (as funções de gatilho leem a
marca). Ela foi aplicada em 01/10/2026: desde a rodada 5 a falta dela é
VERMELHO, não pulo — um banco recriado sem a 023 (ou uma função de gatilho
reescrita por cima) voltaria a disparar automação no recálculo, e um teste
pulado não avisaria ninguém. O `test_marca_*` e o
`test_so_as_operacoes_em_massa_marcam` provam que a aplicação põe a marca, e
só onde deve. Tudo aqui roda na
fixture `conexao` (transação revertida): a regra de automação ativa que os
testes criam nunca é vista por outra sessão.
"""

import ast
import pathlib

import pytest

import app.database as db
from app.dominio.automacao import MARCA, marcar_sem_automacao
from app.dominio.datacore import ClienteErp
from app.dominio.sincronizacao_datacore import sincronizar
from app.routers.contatos import recalcular


async def _com_023(conexao) -> bool:
    return bool(await conexao.fetchval(
        "SELECT bool_and(prosrc LIKE '%' || $1 || '%') FROM pg_proc "
        "WHERE proname IN ('evaluate_automation_on_etiqueta', "
        "'fn_contact_event_to_journey_queue')", MARCA))


async def _exigir_023(conexao):
    assert await _com_023(conexao), (
        "as funções de gatilho não leem a marca: a migration 023 "
        "(023_operacao_em_massa_nao_dispara_automacao.sql) não está no banco")


async def _regra_para_quem_nasce_agora(conexao, acao="create_in_growthhs") -> str:
    """Regra ATIVA que casa só com lead criado nesta transação: `created_at`
    depois do `now()` dela (que é o `created_at` de quem nasce aqui)."""
    agora = await conexao.fetchval("SELECT now()::text")
    return str(await conexao.fetchval(
        """INSERT INTO automation_rules (name, priority, condition_type, condition_operator,
                                         condition_value, conditions, condition_logic,
                                         action_type, is_active)
           VALUES ('teste decisão 6', 1000, 'etiqueta', 'is', 'x', $1::jsonb, 'and', $2, true)
           RETURNING id""",
        [{"type": "created_at", "operator": "after", "value": agora}], acao))


async def _lead(conexao, email, **campos) -> str:
    campos = {"nome": "Decisão 6", "email": email, "tipo": "teste", **campos}
    nomes = ", ".join(campos)
    marcas = ", ".join(f"${i}" for i in range(1, len(campos) + 1))
    return str(await conexao.fetchval(
        f"INSERT INTO leads ({nomes}) VALUES ({marcas}) RETURNING id", *campos.values()))


async def _pedidos(conexao, lead) -> int:
    return await conexao.fetchval(
        "SELECT count(*) FROM crm_handoffs WHERE lead_id = $1::uuid", lead)


async def _fila_de_jornada(conexao, lead) -> int:
    return await conexao.fetchval(
        "SELECT count(*) FROM journey_events WHERE lead_id = $1::uuid", lead)


# ── O lado individual: continua disparando ───────────────────────────────────

async def test_captura_individual_dispara_regra_e_fila_de_jornada(conexao):
    await _regra_para_quem_nasce_agora(conexao)
    lead = await _lead(conexao, "decisao6-captura@exemplo.invalid", cargo="CEO")
    assert await _pedidos(conexao, lead) == 1
    # `fn_lead_insert_event` grava `form_submitted`, copiado para a fila.
    assert await _fila_de_jornada(conexao, lead) >= 1


async def test_mudanca_manual_de_status_dispara_regra(conexao):
    lead = await _lead(conexao, "decisao6-status@exemplo.invalid")
    await conexao.execute(
        """INSERT INTO automation_rules (name, priority, condition_type, condition_operator,
                                         condition_value, conditions, condition_logic,
                                         action_type, is_active)
           VALUES ('teste decisão 6', 1000, 'etiqueta', 'is', 'x', $1::jsonb, 'and',
                   'create_in_growthhs', true)""",
        [{"type": "status", "operator": "is", "value": "Iniciado"}])
    assert await _pedidos(conexao, lead) == 0
    await conexao.execute("UPDATE leads SET status = 'Iniciado' WHERE id = $1::uuid", lead)
    assert await _pedidos(conexao, lead) == 1


# ── A marca: a aplicação já a põe (vale com ou sem a 023) ────────────────────

async def test_marca_da_sincronizacao(conexao):
    assert await conexao.fetchval("SELECT current_setting($1, true)", MARCA) in (None, "")
    await sincronizar(conexao, [])
    assert await conexao.fetchval("SELECT current_setting($1, true)", MARCA) == "on"


async def test_marca_morre_com_a_transacao_e_nao_vaza_pelo_pool():
    """`SET LOCAL`: a conexão volta ao pool limpa. Se a marca vazasse, o
    próximo pedido INDIVIDUAL que pegasse a mesma conexão perderia a
    automação calado."""
    await db.init_db()
    if db._pool is None:
        pytest.skip("sem DATABASE_URL")
    try:
        async with db._pool.acquire() as conn:
            tr = conn.transaction()
            await tr.start()
            await marcar_sem_automacao(conn)
            assert await conn.fetchval("SELECT current_setting($1, true)", MARCA) == "on"
            await tr.rollback()
            assert await conn.fetchval("SELECT current_setting($1, true)", MARCA) in (None, "")
    finally:
        await db.close_db()


def test_so_as_operacoes_em_massa_marcam():
    """Quem chama `marcar_sem_automacao` é exatamente o recálculo e a
    sincronização. Marcar uma rota individual (captura, status, edição)
    calaria a automação dela — o oposto da decisão."""
    raiz = pathlib.Path(__file__).resolve().parent.parent / "app"
    chamadores = set()
    for arquivo in raiz.rglob("*.py"):
        arvore = ast.parse(arquivo.read_text(encoding="utf-8"))
        for funcao in ast.walk(arvore):
            if not isinstance(funcao, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for no in ast.walk(funcao):
                if (isinstance(no, ast.Call) and isinstance(no.func, ast.Name)
                        and no.func.id == "marcar_sem_automacao"):
                    chamadores.add(f"{arquivo.relative_to(raiz)}:{funcao.name}")
    assert chamadores == {"routers/contatos.py:recalcular",
                          "dominio/sincronizacao_datacore.py:sincronizar"}


# ── O lado em massa: só atualiza dado (exige a 023) ──────────────────────────

@pytest.mark.trava_global  # o UPDATE da base inteira trava toda linha de `leads`
async def test_recalculo_atualiza_pontuacao_sem_disparar_regra(conexao):
    await _exigir_023(conexao)
    lead = await _lead(conexao, "decisao6-recalculo@exemplo.invalid", cargo="CEO",
                       utm_source="google")
    certo = await conexao.fetchval("SELECT lead_score FROM leads WHERE id = $1::uuid", lead)
    # Pontuação "velha": UPDATE fora das colunas do scoring não a recalcula.
    await conexao.execute(
        "UPDATE leads SET lead_score = COALESCE(lead_score, 0) + 7 WHERE id = $1::uuid", lead)
    await _regra_para_quem_nasce_agora(conexao)

    await recalcular(conexao)

    # O dado mudou (a pontuação voltou à da régua)...
    assert await conexao.fetchval(
        "SELECT lead_score FROM leads WHERE id = $1::uuid", lead) == certo
    # ...e a regra, que casa com este lead, não enfileirou nada.
    assert await _pedidos(conexao, lead) == 0


async def test_sincronizacao_cria_e_atualiza_sem_disparar_regra_nem_jornada(conexao):
    await _exigir_023(conexao)
    await _regra_para_quem_nasce_agora(conexao)
    cliente = ClienteErp(cpf_cnpj="60606060000106", nome="Decisão 6 Ltda",
                         email="decisao6-datacore@exemplo.invalid", fone="81999990606",
                         cidade="Recife", uf="PE", tipo_pessoa="J")
    for _ in range(2):  # cria, depois atualiza
        r = await sincronizar(conexao, [cliente])
        assert not r.erros, r.erros
    lead = await conexao.fetchval(
        """SELECT l.id::text FROM leads l
             JOIN ecosystem_identities i ON i.dnia_id = l.dnia_id
            WHERE i.datacore_cliente_id = $1""", cliente.cpf_cnpj)
    assert lead
    assert await _pedidos(conexao, lead) == 0
    assert await _fila_de_jornada(conexao, lead) == 0
    # A linha do tempo NÃO perde o evento — só a cópia para a fila não é feita.
    assert await conexao.fetchval(
        "SELECT count(*) FROM contact_events WHERE lead_id = $1::uuid "
        "AND event_type = 'form_submitted'", lead) == 1
