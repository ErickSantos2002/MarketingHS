"""Apagar lead de teste sem deixar evento órfão (pergunta 38, 02/10/2026).

`contact_events.lead_id` é ON DELETE SET NULL, e `journey_events` (a cópia que
o gatilho `trg_contact_event_journey` faz de todo `contact_events`) não tem FK.
Apagar só o lead deixa os dois para trás: o INSERT de lead já grava um
`form_submitted` (`fn_lead_insert_event`), o `campaign_sends` um `email_sent`,
o webhook o `email_opened`/`bounced`/`complained`. Até a rodada 6 cada suíte
inteira deixava ~24 desses em produção (a maior parte pela fixture `envio`).

Toda fixture que COMITA lead e depois o apaga passa por aqui.
"""


async def apagar_leads(conn, ids) -> None:
    """Apaga os eventos dos leads e depois os leads. `ids` pode ser vazio."""
    ids = [str(i) for i in ids]
    await conn.execute(
        "DELETE FROM journey_events WHERE lead_id = ANY($1::uuid[])", ids)
    await conn.execute(
        "DELETE FROM contact_events WHERE lead_id = ANY($1::uuid[])", ids)
    await conn.execute("DELETE FROM leads WHERE id = ANY($1::uuid[])", ids)
