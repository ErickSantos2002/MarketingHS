"""A captura de quem CONFIRMOU um agendamento não entra na jornada que entrega
ao comercial (frente agendamento, Task 4).

O modo de falhar é o card duplicado: o agendamento cria o card na lista 28 e
a jornada "lead para o comercial" (nó `handoff_growthhs`) enfileira um
segundo pedido de card para o mesmo lead. As outras jornadas da página
(boas-vindas, nutrição) continuam valendo.
"""

import json
import uuid

import pytest

from app.captura.registro import Origem, registrar_captura

PAGINA = f"agendamento-cap-{uuid.uuid4().hex[:8]}"
HANDOFF = [{"id": "n1", "type": "handoff_growthhs", "config": {}, "next": None}]
SO_EMAIL = [{"id": "n1", "type": "delay", "config": {"minutes": 60}, "next": None}]


async def _exigir_036(conexao):
    tem = await conexao.fetchval(
        "SELECT position('v_agendamento' in prosrc) > 0 FROM pg_proc "
        "WHERE proname = 'journey_enroll_event' AND pronargs = 3")
    if not tem:
        pytest.skip("migration 036 ainda não aplicada neste banco")


async def _jornadas(conexao):
    ids = []
    for nome, nos in (("handoff", HANDOFF), ("só e-mail", SO_EMAIL)):
        ids.append(await conexao.fetchval(
            """INSERT INTO journeys (name, status, entry_type, entry_config,
                                     entry_node_id, nodes)
               VALUES ($1, 'active', 'event', $2::jsonb, 'n1', $3::jsonb)
               RETURNING id::text""",
            f"agendamento {nome}", {"event_type": "form_submitted", "page_slug": PAGINA},
            nos))
    return ids


async def _capturar(conexao, email, *, agendamento=None):
    kw = {} if agendamento is None else {"agendamento": agendamento}
    return await registrar_captura(
        conexao, email=email, campos={"nome": "Lead Agendado"}, extras={},
        origem=Origem(page_slug=PAGINA), session_id=None, consentimento=None, tags=[],
        **kw)


async def _drenar(conexao, lead):
    """O que o worker faz com a fila de eventos: matricula com o metadata."""
    for e in await conexao.fetch(
            "DELETE FROM journey_events WHERE lead_id = $1::uuid "
            "RETURNING event_type, metadata", lead):
        meta = e["metadata"] if isinstance(e["metadata"], dict) else json.loads(e["metadata"])
        await conexao.fetchval("SELECT journey_enroll_event($1::uuid, $2, $3::jsonb)",
                               lead, e["event_type"], meta)


async def _runs(conexao, lead, jornadas):
    return {r["j"] for r in await conexao.fetch(
        "SELECT journey_id::text AS j FROM journey_runs "
        "WHERE lead_id = $1::uuid AND journey_id = ANY($2::uuid[])", lead, jornadas)}


async def test_lead_novo_agendado_nao_entra_na_jornada_de_handoff(conexao):
    await _exigir_036(conexao)
    a, b = await _jornadas(conexao)
    lead = await _capturar(conexao, f"novo-{uuid.uuid4().hex[:8]}@exemplo.invalid",
                           agendamento=True)
    await _drenar(conexao, lead)
    assert await _runs(conexao, lead, [a, b]) == {b}
    assert await conexao.fetchval(
        "SELECT count(*) FROM crm_handoffs WHERE lead_id = $1::uuid", lead) == 0
    # A marca não vaza para o resto da transação.
    assert await conexao.fetchval(
        "SELECT coalesce(current_setting('marketinghs.agendamento', true), '')") == ""


async def test_lead_existente_agendado_tambem_nao(conexao):
    await _exigir_036(conexao)
    email = f"existe-{uuid.uuid4().hex[:8]}@exemplo.invalid"
    lead = await conexao.fetchval(
        "INSERT INTO leads (email, tipo) VALUES ($1, 'teste') RETURNING id::text", email)
    await conexao.execute("DELETE FROM journey_events WHERE lead_id = $1::uuid", lead)
    a, b = await _jornadas(conexao)
    assert await _capturar(conexao, email, agendamento=True) is not None
    meta = await conexao.fetchval(
        "SELECT metadata FROM contact_events WHERE lead_id = $1::uuid "
        "AND metadata->>'reconversao' = 'true'", lead)
    meta = meta if isinstance(meta, dict) else json.loads(meta)
    assert meta["agendamento"] is True
    await _drenar(conexao, lead)
    assert await _runs(conexao, lead, [a, b]) == {b}


async def test_captura_comum_continua_entrando_nas_duas(conexao):
    await _exigir_036(conexao)
    a, b = await _jornadas(conexao)
    lead = await _capturar(conexao, f"comum-{uuid.uuid4().hex[:8]}@exemplo.invalid")
    await _drenar(conexao, lead)
    assert await _runs(conexao, lead, [a, b]) == {a, b}


async def test_reconversao_comum_sem_a_chave(conexao):
    await _exigir_036(conexao)
    email = f"reconv-{uuid.uuid4().hex[:8]}@exemplo.invalid"
    lead = await conexao.fetchval(
        "INSERT INTO leads (email, tipo) VALUES ($1, 'teste') RETURNING id::text", email)
    await _capturar(conexao, email)
    meta = await conexao.fetchval(
        "SELECT metadata FROM contact_events WHERE lead_id = $1::uuid "
        "AND metadata->>'reconversao' = 'true'", lead)
    meta = meta if isinstance(meta, dict) else json.loads(meta)
    assert "agendamento" not in meta
