"""A fila de entrega ao GrowthHS — o que era o handoff-to-nexus, sem o Nexus.

Três caminhos enfileiram (a regra de automação pelo gatilho do banco, o nó de
jornada, o botão manual) e o worker drena. Um caminho de entrega, uma política
de re-tentativa, um lugar para ver falha (`GET /config/growthhs`).

⚠️ A rede nunca roda dentro de transação: reivindica (sessão curta, com
prazo de 5 min), chama, grava o resultado (outra sessão curta). Se o worker
morrer entre a chamada e a gravação, o pedido volta depois do prazo e é
mandado de novo — e é por isso que o `external_id` vai no corpo: o contrato
pede ao GrowthHS a restrição `(external_source, external_id)` que torna o
reenvio inofensivo.

⚠️ Guarda do nosso lado (decisão 4): lead que já tem entrega `entregue` não
é mandado de novo — a restrição do GrowthHS ainda não existe.
"""

import logging
from datetime import timedelta

from app.crm import growthhs
from app.database import sessao

logger = logging.getLogger(__name__)

MAX_TENTATIVAS = 6
ESPERA_BASE = timedelta(minutes=1)          # 1, 2, 4, 8, 16 min
PRAZO_DA_REIVINDICACAO = timedelta(minutes=5)
MOTIVO_MOVER = ("O GrowthHS ainda não tem rota para mover card de etapa — "
                "pedido registrado no contrato (docs/contratos/"
                "2026-09-02-endpoint-card-comercial-growthhs.md).")

_COLUNAS_LEAD = """id::text AS id, nome, email, whatsapp, phone_normalized, empresa,
    cargo, faturamento, funcionarios, desafios, indicacao, utm_source, utm_medium,
    utm_campaign, utm_term, utm_content, lead_score, etiqueta,
    dnia_id::text AS dnia_id, deleted_at"""


async def enfileirar(conn, lead_id: str, origem: str, *, acao: str = "criar",
                     rule_id: str | None = None,
                     journey_run_id: str | None = None) -> int | None:
    """Um pedido por lead e ação enquanto pendente; o segundo é absorvido."""
    return await conn.fetchval(
        """INSERT INTO crm_handoffs (lead_id, acao, origem, rule_id, journey_run_id)
           VALUES ($1::uuid, $2, $3, $4::uuid, $5::uuid)
           ON CONFLICT (lead_id, acao) WHERE status = 'pendente' DO NOTHING
           RETURNING id""",
        lead_id, acao, origem, rule_id, journey_run_id)


async def _reivindicar(limite: int, somente_lead: str | None) -> list[dict]:
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            """UPDATE crm_handoffs SET visivel_em = now() + $2::interval,
                      tentativas = tentativas + 1, atualizado_em = now()
                WHERE id IN (SELECT id FROM crm_handoffs
                              WHERE status = 'pendente' AND visivel_em <= now()
                                AND ($3::uuid IS NULL OR lead_id = $3::uuid)
                              ORDER BY visivel_em LIMIT $1
                              FOR UPDATE SKIP LOCKED)
            RETURNING id, lead_id::text AS lead_id, acao, origem, rule_id::text AS rule_id,
                      journey_run_id::text AS journey_run_id, tentativas""",
            limite, PRAZO_DA_REIVINDICACAO, somente_lead)
    return [dict(l) for l in linhas]


async def _registrar_evento(conn, lead: dict, tipo: str, titulo: str, metadata: dict) -> None:
    await conn.execute(
        """INSERT INTO contact_events (dnia_id, lead_id, source_app, event_type, title, metadata)
           VALUES ($1::uuid, $2::uuid, 'marketinghs', $3, $4, $5::jsonb)""",
        lead.get("dnia_id"), lead["id"], tipo, titulo, metadata)


async def _falhar(pedido: dict, lead: dict | None, erro: str) -> None:
    async with sessao(role="service_role") as conn:
        await conn.execute(
            """UPDATE crm_handoffs SET status = 'falhou', erro = $2, atualizado_em = now()
                WHERE id = $1""", pedido["id"], erro[:1000])
        if lead:
            await _registrar_evento(conn, lead, "crm_handoff_falhou",
                                    "Não foi possível enviar ao comercial (GrowthHS)",
                                    {"origem": pedido["origem"], "rule_id": pedido["rule_id"],
                                     "erro": erro[:400]})


async def _entregar(pedido: dict, cfg: growthhs.Config, transporte) -> str:
    async with sessao(role="service_role") as conn:
        lead = await conn.fetchrow(
            f"SELECT {_COLUNAS_LEAD} FROM leads WHERE id = $1::uuid", pedido["lead_id"])
        anterior = await conn.fetchrow(
            """SELECT card_id, person_id FROM crm_handoffs
                WHERE lead_id = $1::uuid AND acao = 'criar' AND status = 'entregue'
                ORDER BY id LIMIT 1""", pedido["lead_id"])
    lead = dict(lead) if lead else None

    if lead is None or lead["deleted_at"] is not None:
        await _falhar(pedido, None, "O contato foi excluído antes da entrega.")
        return "falhas"
    if pedido["acao"] == "mover":
        await _falhar(pedido, lead, MOTIVO_MOVER)
        return "falhas"
    if anterior:
        async with sessao(role="service_role") as conn:
            await conn.execute(
                """UPDATE crm_handoffs SET status = 'entregue', card_id = $2, person_id = $3,
                          erro = 'já estava no GrowthHS', atualizado_em = now()
                    WHERE id = $1""", pedido["id"], anterior["card_id"], anterior["person_id"])
        return "ja_entregues"

    try:
        resposta = await growthhs.criar_card(cfg, growthhs.montar_card(lead, cfg.board_id),
                                             transporte=transporte)
    except growthhs.ErroDefinitivo as erro:
        await _falhar(pedido, lead, str(erro))
        return "falhas"
    except growthhs.ErroTransitorio as erro:
        if pedido["tentativas"] >= MAX_TENTATIVAS:
            await _falhar(pedido, lead, f"{erro} (desistiu após {pedido['tentativas']} tentativas)")
            return "falhas"
        espera = ESPERA_BASE * (2 ** (pedido["tentativas"] - 1))
        async with sessao(role="service_role") as conn:
            await conn.execute(
                """UPDATE crm_handoffs SET visivel_em = now() + $2::interval, erro = $3,
                          atualizado_em = now() WHERE id = $1""",
                pedido["id"], espera, str(erro)[:1000])
        return "adiadas"

    card_id, person_id = resposta.get("id"), resposta.get("person_id")
    async with sessao(role="service_role") as conn:
        await conn.execute(
            """UPDATE crm_handoffs SET status = 'entregue', card_id = $2, person_id = $3,
                      erro = NULL, atualizado_em = now() WHERE id = $1""",
            pedido["id"], card_id, person_id)
        if lead["dnia_id"]:
            await conn.execute(
                """UPDATE ecosystem_identities SET growthhs_card_id = $2,
                          growthhs_person_id = coalesce($3, growthhs_person_id)
                    WHERE dnia_id = $1::uuid""", lead["dnia_id"], card_id, person_id)
        await _registrar_evento(conn, lead, "crm_handoff", "Enviado ao comercial (GrowthHS)",
                                {"origem": pedido["origem"], "rule_id": pedido["rule_id"],
                                 "card_id": card_id, "created": resposta.get("created")})
    return "entregues"


async def rodar_entregas(*, limite: int = 20, cfg: growthhs.Config | None = None,
                         transporte=None, somente_lead: str | None = None) -> dict:
    """Um ciclo do worker. Sem configuração, NÃO reivindica — o pedido fica
    pendente, e quem configurar vê a fila andar (mesmo desenho do Resend).

    ⚠️ `somente_lead` existe para os testes: eles rodam contra o banco de
    produção, e um ciclo sem filtro reivindicaria os pedidos REAIS e os
    "entregaria" ao transporte falso do teste, com card inventado."""
    cfg = cfg or await growthhs.ler_config()
    if not cfg.configurado:
        return {"desligado": True}
    contagem = {"entregues": 0, "ja_entregues": 0, "adiadas": 0, "falhas": 0}
    for pedido in await _reivindicar(limite, somente_lead):
        try:
            contagem[await _entregar(pedido, cfg, transporte)] += 1
        except Exception:
            # Defeito nosso (não do GrowthHS): o prazo da reivindicação vence
            # e o pedido volta. Logar é o mínimo — não engolir calado.
            logger.exception("[crm] pedido %s quebrou na entrega", pedido["id"])
    return contagem
