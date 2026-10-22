"""A volta pelo webhook de automação do GrowthHS (spec 2026-10-22 §4).

O GrowthHS não chama o `/publico/evento-de-contato`: o que existe lá é a ação
`send_webhook` das automações de board, com corpo de formato fixo (`event`,
`timestamp`, `card` com `person`) e assinatura `X-HSGrowth-Signature:
sha256=<hex>` = HMAC-SHA256 dos bytes do corpo (doc do GrowthHS §4 e §8.5).
O corpo é igual para todo gatilho, então o evento sai da URL
(`?evento=meeting_scheduled` / `?evento=deal_won`), uma automação por evento.

Este módulo traduz: acha o lead pelo card e entrega para
`retorno.aplicar_evento`, a mesma aplicação do evento de contato.

⚠️ A automação dispara para TODO card que fizer o movimento — não só os que
nasceram aqui — e se desliga sozinha depois de 5 respostas não-2xx seguidas.
Por isso "não é nosso" é resposta normal (`{"ignorado": true}`), não erro.
"""

import hashlib
import hmac
import logging

from app.crm import retorno

logger = logging.getLogger(__name__)

EVENTOS = {
    "meeting_scheduled": "Reunião agendada no GrowthHS",
    "deal_won": "Venda fechada no GrowthHS",
}

# O corpo do GrowthHS tem uns poucos KB (um card, sem histórico); 64 KB é
# folga larga e corta quem tenta encher a memória por uma rota anônima.
CORPO_MAXIMO = 64 * 1024

_COLUNAS = "l.id::text AS id, l.dnia_id::text AS dnia_id, l.status, l.email"


def assinatura_confere(corpo: bytes, segredo: str, cabecalho: str | None) -> bool:
    """`sha256=<hex>` sobre os bytes CRUS do corpo, em tempo constante.

    ⚠️ Nunca sobre o JSON re-serializado: o GrowthHS assina o texto que ele
    gerou (compacto, `ensure_ascii=False`), e qualquer diferença de espaço ou
    de escape de acento mudaria o HMAC — toda reunião viraria 401.
    """
    if not cabecalho or not segredo:
        return False
    prefixo, _, recebido = cabecalho.strip().partition("=")
    if prefixo.lower() != "sha256" or not recebido:
        return False
    esperado = hmac.new(segredo.encode("utf-8"), corpo, hashlib.sha256).hexdigest()
    return hmac.compare_digest(esperado, recebido.strip().lower())


def _id_do_card(card: dict) -> int | None:
    """Só inteiro (ou texto só de dígitos). `True` é `int` em Python e não é id."""
    valor = card.get("id")
    if isinstance(valor, bool):
        return None
    if isinstance(valor, int):
        return valor if valor > 0 else None
    if isinstance(valor, str) and valor.strip().isdigit():
        return int(valor.strip())
    return None


def _email(valor) -> str:
    return valor.strip().lower() if isinstance(valor, str) else ""


async def lead_do_card(conn, card: dict) -> dict | None:
    """O lead do card: pelo `card.id` (o `crm_handoffs` entregue mais recente,
    depois `ecosystem_identities.growthhs_card_id` → lead canônico), senão
    pelo e-mail exato da pessoa do card. Excluído (`deleted_at`) nunca.

    ⚠️ O lead achado pelo id só vale se o e-mail da pessoa do card bate com o
    do lead (ou um dos dois é vazio). O receptor de teste antigo gravava
    `card_id`s inventados, que podem coincidir com o card real de OUTRA
    pessoa — sem essa conferência, a reunião dela mudaria o estágio de um
    lead nosso que não tem nada com isso. Não bateu → cai para o e-mail.
    """
    pessoa = card.get("person") or {}
    email = _email(pessoa.get("email")) if isinstance(pessoa, dict) else ""
    card_id = _id_do_card(card)

    if card_id is not None:
        candidatos = (
            await conn.fetchrow(
                f"""SELECT {_COLUNAS} FROM crm_handoffs h JOIN leads l ON l.id = h.lead_id
                     WHERE h.card_id = $1 AND h.status = 'entregue'
                       AND l.deleted_at IS NULL
                     ORDER BY h.criado_em DESC, h.id DESC LIMIT 1""", card_id),
            await conn.fetchrow(
                f"""SELECT {_COLUNAS} FROM ecosystem_identities i
                      JOIN leads l ON l.id = i.dndash_lead_id
                     WHERE i.growthhs_card_id = $1 AND l.deleted_at IS NULL
                     ORDER BY i.updated_at DESC NULLS LAST LIMIT 1""", card_id),
        )
        for lead in candidatos:
            if lead is None:
                continue
            do_lead = _email(lead["email"])
            if not email or not do_lead or email == do_lead:
                return dict(lead)
            logger.info("webhook do GrowthHS: card %s aponta para um lead com outro "
                        "e-mail; procurando pelo e-mail da pessoa", card_id)

    if email:
        lead = await conn.fetchrow(
            f"""SELECT {_COLUNAS} FROM leads l
                 WHERE lower(l.email) = $1 AND l.deleted_at IS NULL
                 ORDER BY l.created_at DESC LIMIT 1""", email)
        if lead:
            return dict(lead)
    return None


async def aplicar(conn, evento: str, payload: dict) -> dict:
    """Traduz o webhook e aplica. `{"ignorado": True}` para evento fora de
    `EVENTOS`, corpo sem `card` ou card que não é de lead nosso."""
    card = payload.get("card") if isinstance(payload, dict) else None
    if evento not in EVENTOS or not isinstance(card, dict) or _id_do_card(card) is None:
        return {"ignorado": True}
    lead = await lead_do_card(conn, card)
    if lead is None:
        return {"ignorado": True}
    metadata = {"card_id": _id_do_card(card), "list_id": card.get("list_id"),
                "list_name": card.get("list_name"), "board_id": card.get("board_id"),
                "via": "webhook", "evento_growthhs": payload.get("event")}
    return await retorno.aplicar_evento(conn, lead, event_type=evento,
                                        title=EVENTOS[evento], metadata=metadata)
