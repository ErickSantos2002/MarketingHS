"""A volta do CRM: "reunião agendada" e "venda fechada" no GrowthHS mudam o
estágio do lead aqui (prova do RD, 21/10/2026).

O GrowthHS chama `POST /publico/evento-de-contato` com `source_app =
"growthhs"` (contrato em
`docs/contratos/2026-09-02-endpoint-card-comercial-growthhs.md`, "Acréscimos
de 21/10"). O evento é gravado como veio, e o estágio **só avança**: pela
`lead_statuses.sort_order`, nunca volta. Um "reunião agendada" atrasado,
chegando depois da venda, não pode desfazer a venda.

⚠️ **Um evento de reunião, não dois.** A mudança de status pelo painel
(`escrita_contatos._registrar_mudanca`) grava o `contact_updated` E o
evento específico do estágio (`meeting_scheduled` para "MQL - Reunião
agendada", `deal_won` para "Venda realizada"). Aqui o específico JÁ É o
evento que o GrowthHS mandou — gravar o de `_registrar_mudanca` também
faria o indicador de agendamentos (`painel.py`, que conta
`meeting_scheduled`) contar cada reunião do CRM em dobro. Por isso só o
`contact_updated` (com as mesmas chaves de metadata que o painel lê) sai
daqui.
"""

import logging

logger = logging.getLogger(__name__)

ESTAGIO_POR_EVENTO = {
    "meeting_scheduled": "MQL - Reunião agendada",
    "deal_won": "Venda realizada",
}

DESCRICAO_CRM = "Mudança de status pelo CRM"


async def avancar_status(conn, lead_id: str, novo: str, *,
                         metadata_extra: dict) -> tuple[str | None, str, bool]:
    """`(anterior, atual, mudou)`. Grava só se `sort_order(novo) >
    sort_order(anterior)`; status anterior fora de `lead_statuses` (ou nulo)
    conta como o começo do funil."""
    linha = await conn.fetchrow(
        """SELECT l.status,
                  (SELECT sort_order FROM lead_statuses WHERE name = l.status) AS ordem_atual,
                  (SELECT sort_order FROM lead_statuses WHERE name = $2) AS ordem_nova
             FROM leads l WHERE l.id = $1::uuid FOR UPDATE""", lead_id, novo)
    anterior = linha["status"]
    if linha["ordem_nova"] is None:
        # O estágio do mapa sumiu de `lead_statuses` (renomeado no painel):
        # não inventa status — registra e não mexe.
        logger.warning("retorno do CRM: estágio %r não existe em lead_statuses", novo)
        return anterior, anterior, False
    if linha["ordem_atual"] is not None and linha["ordem_nova"] <= linha["ordem_atual"]:
        return anterior, anterior, False
    await conn.execute("UPDATE leads SET status = $2 WHERE id = $1::uuid", lead_id, novo)
    metadata = {"de": anterior, "para": novo, "status_anterior": anterior,
                "status_atual": novo, "source": "crm", "origem": "crm",
                **(metadata_extra or {})}
    await conn.execute(
        """INSERT INTO contact_events (lead_id, dnia_id, source_app, event_type,
                                       title, description, metadata)
           SELECT $1::uuid, l.dnia_id, 'marketinghs', 'contact_updated',
                  'Status alterado', $3, $2::jsonb
             FROM leads l WHERE l.id = $1::uuid""",
        lead_id, metadata, DESCRICAO_CRM)
    return anterior, novo, True


# O que conta como a conversão `agendamento` do teste A/B. É a mesma lista de
# `publico.EVENTOS_DE_AGENDAMENTO`; aqui só chega `meeting_scheduled`.
EVENTOS_DE_AGENDAMENTO = ("meeting_scheduled", "scheduling_widget_booked")


async def aplicar_evento(conn, lead: dict, *, event_type: str, title: str,
                         metadata: dict, description: str | None = None) -> dict:
    """O evento do CRM aplicado a um lead JÁ ACHADO (`id`, `dnia_id`,
    `status`): grava em `contact_events` (`source_app = 'growthhs'`), avança
    o estágio por `ESTAGIO_POR_EVENTO` (só para a frente) e, para reunião,
    costura o visitante A/B e registra a conversão `agendamento`.

    Quem chama decide o lead e a transação; nada aqui procura contato.

    ⚠️ `routers/publico.py:_evento_do_growthhs` (o `/publico/evento-de-contato`)
    ficou com uma CÓPIA própria desta aplicação — era território de outra
    frente quando esta nasceu. As duas têm de andar juntas: mudar a regra do
    estágio, do evento ou da costura numa e não na outra faz a mesma reunião
    contar diferente conforme a porta por onde chegou.
    """
    from app.ab.costura import costurar_visitante, extrair_ab, registrar_conversao_ab

    lead_id = str(lead["id"])
    dnia_id = str(lead["dnia_id"]) if lead["dnia_id"] else None
    evento_id = await conn.fetchval(
        """INSERT INTO contact_events (dnia_id, lead_id, source_app, event_type,
                                       title, description, metadata)
           VALUES ($1::uuid, $2::uuid, 'growthhs', $3, $4, $5, $6::jsonb)
           RETURNING id""",
        dnia_id, lead_id, event_type, title, description, metadata or {})

    estagio = ESTAGIO_POR_EVENTO.get(event_type)
    if estagio:
        anterior, atual, mudou = await avancar_status(
            conn, lead_id, estagio,
            metadata_extra={"evento_crm": event_type, "evento_id": str(evento_id)})
    else:
        anterior = atual = lead["status"]
        mudou = False

    if event_type in EVENTOS_DE_AGENDAMENTO:
        email = await conn.fetchval("SELECT email FROM leads WHERE id = $1::uuid", lead_id)
        ab = await costurar_visitante(
            conn, extrair_ab({}, metadata), email=email, phone=None,
            phone_normalized=None, lead_id=lead_id, dnia_id=dnia_id,
            source_app="growthhs",
            metadata={"origin": "growthhs-webhook", "event_type": event_type})
        await registrar_conversao_ab(
            conn, ab, "agendamento", lead_id=lead_id, dnia_id=dnia_id,
            metadata={"event_type": event_type})

    return {"evento_id": str(evento_id), "lead_id": lead_id, "dnia_id": dnia_id,
            "status_anterior": anterior, "status_atual": atual, "mudou": mudou}
