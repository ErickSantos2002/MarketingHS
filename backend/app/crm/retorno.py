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
