"""O banco do handoff — o que o gatilho de validação aceita e a fila garante.

O modo de falhar é um pedido de card duplicado (dois pendentes para o mesmo
lead) ou um vocabulário que a tela manda e o banco recusa. Os dois aparecem só
quando alguém tenta salvar ou quando o vendedor vê o mesmo contato duas vezes.
"""

import asyncpg
import pytest

GRAFO_OK = [{"id": "n1", "type": "handoff_growthhs", "config": {}, "next": None}]


async def _lead(conexao) -> str:
    return str(await conexao.fetchval(
        "INSERT INTO leads (nome, email, tipo) VALUES ('Handoff 8D', "
        "'handoff-8d-banco@exemplo.invalid', 'teste') RETURNING id"))


async def test_regra_aceita_o_vocabulario_novo_e_recusa_o_do_nexus(conexao):
    await conexao.execute(
        """INSERT INTO automation_rules (name, condition_type, condition_operator,
                                         condition_value, action_type)
           VALUES ('8D', 'etiqueta', 'is', 'hotlead', 'create_in_growthhs')""")
    with pytest.raises(asyncpg.RaiseError, match="Invalid action_type"):
        async with conexao.transaction():
            await conexao.execute(
                """INSERT INTO automation_rules (name, condition_type, condition_operator,
                                                 condition_value, action_type)
                   VALUES ('8D', 'etiqueta', 'is', 'hotlead', 'create_in_nexus')""")


async def test_no_de_jornada_growthhs_sem_etapa_e_nexus_recusado(conexao):
    await conexao.execute("SELECT validate_journey_graph($1::jsonb, 'n1')", GRAFO_OK)
    velho = [{"id": "n1", "type": "handoff_nexus", "config": {"stage_id": "x"}, "next": None}]
    with pytest.raises(asyncpg.RaiseError, match="tipo de no invalido"):
        async with conexao.transaction():
            await conexao.execute("SELECT validate_journey_graph($1::jsonb, 'n1')", velho)


async def test_fila_nao_aceita_dois_pendentes_do_mesmo_lead(conexao):
    lead = await _lead(conexao)
    await conexao.execute(
        "INSERT INTO crm_handoffs (lead_id, origem) VALUES ($1::uuid, 'manual')", lead)
    with pytest.raises(asyncpg.UniqueViolationError):
        async with conexao.transaction():
            await conexao.execute(
                "INSERT INTO crm_handoffs (lead_id, origem) VALUES ($1::uuid, 'regra')", lead)
    # Depois de entregue, um novo pedido pode entrar (e a entrega decide).
    await conexao.execute("UPDATE crm_handoffs SET status = 'entregue' WHERE lead_id = $1::uuid",
                          lead)
    await conexao.execute(
        "INSERT INTO crm_handoffs (lead_id, origem) VALUES ($1::uuid, 'regra')", lead)


async def test_identidade_tem_as_colunas_inteiras_do_growthhs(conexao):
    tipos = dict(await conexao.fetch(
        """SELECT column_name, data_type FROM information_schema.columns
            WHERE table_name = 'ecosystem_identities'
              AND column_name IN ('growthhs_card_id', 'growthhs_person_id')"""))
    assert tipos == {"growthhs_card_id": "bigint", "growthhs_person_id": "bigint"}


@pytest.mark.trava_global  # apaga e recria a linha ÚNICA que `config_growthhs` de outra rodada grava
async def test_nexus_config_saiu_e_growthhs_config_e_linha_unica(conexao):
    assert await conexao.fetchval("SELECT to_regclass('public.nexus_config')") is None
    await conexao.execute("DELETE FROM growthhs_config")
    await conexao.execute("INSERT INTO growthhs_config (board_id) VALUES (1)")
    with pytest.raises(asyncpg.UniqueViolationError):
        async with conexao.transaction():
            await conexao.execute("INSERT INTO growthhs_config (board_id) VALUES (2)")
