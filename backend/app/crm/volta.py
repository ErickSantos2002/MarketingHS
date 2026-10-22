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
import string
from datetime import datetime, timedelta, timezone

from app.crm import growthhs, retorno

logger = logging.getLogger(__name__)

EVENTOS = {
    "meeting_scheduled": "Reunião agendada no GrowthHS",
    "deal_won": "Venda fechada no GrowthHS",
}

# O corpo do GrowthHS tem uns poucos KB (um card, sem histórico); 64 KB é
# folga larga e corta quem tenta encher a memória por uma rota anônima.
CORPO_MAXIMO = 64 * 1024

# O único `event` que a automação `send_webhook` manda (formato fixo, doc do
# GrowthHS §4) — vale para mover E para ganhar, porque ganhar MOVE o card para
# a lista de ganho.
EVENTO_DO_CORPO = "card.list_changed"

# ⚠️ Replay: o corpo assinado vale para sempre. Só aceita `timestamp` a até
# 10 min do relógio (o envio de lá é síncrono, com 10 s de timeout) e, dentro
# da janela, só uma vez por (card, evento, timestamp).
JANELA = timedelta(minutes=10)

_COLUNAS = "l.id::text AS id, l.dnia_id::text AS dnia_id, l.status, l.email"
_HEX = frozenset(string.hexdigits)


def assinatura_confere(corpo: bytes, segredo: str, cabecalho: str | None) -> bool:
    """`sha256=<hex>` sobre os bytes CRUS do corpo, em tempo constante.

    ⚠️ Nunca sobre o JSON re-serializado: o GrowthHS assina o texto que ele
    gerou (compacto, `ensure_ascii=False`), e qualquer diferença de espaço ou
    de escape de acento mudaria o HMAC — toda reunião viraria 401.
    """
    if not cabecalho or not segredo:
        return False
    prefixo, _, recebido = cabecalho.strip().partition("=")
    recebido = recebido.strip().lower()
    # ⚠️ `compare_digest` com `str` não-ASCII levanta TypeError (virava 500).
    # Só hex de 64 passa daqui, e a comparação é em bytes.
    if prefixo.lower() != "sha256" or len(recebido) != 64 or not set(recebido) <= _HEX:
        return False
    esperado = hmac.new(segredo.encode("utf-8"), corpo, hashlib.sha256).hexdigest()
    return hmac.compare_digest(esperado.encode("ascii"), recebido.encode("ascii"))


def _id_do_card(card: dict) -> int | None:
    """Só inteiro (ou texto só de dígitos). `True` é `int` em Python e não é id."""
    return _inteiro(card.get("id"))


def _inteiro(valor) -> int | None:
    if isinstance(valor, bool):
        return None
    if isinstance(valor, int):
        return valor if valor > 0 else None
    # ⚠️ `isascii()`: `"²".isdigit()` é True e `int("²")` levanta.
    if isinstance(valor, str) and valor.strip().isascii() and valor.strip().isdigit():
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


def _listas_do_evento(cfg: "growthhs.Config", evento: str) -> tuple[int, ...]:
    return cfg.listas_reuniao if evento == "meeting_scheduled" else cfg.listas_ganho


def _momento(valor, agora: datetime) -> str | None:
    """O `timestamp` do corpo (texto, como veio) se ele cai na `JANELA`; senão
    `None`. Sem fuso é UTC (o GrowthHS usa `utcnow()`)."""
    if not isinstance(valor, str) or not valor.strip():
        return None
    data = growthhs._ler_iso(valor)
    if data is None or abs(agora - data) > JANELA:
        return None
    return valor.strip()


async def aplicar(conn, evento: str, payload: dict, *,
                  cfg: "growthhs.Config | None" = None,
                  agora: datetime | None = None) -> dict:
    """Traduz o webhook e aplica. `{"ignorado": True}` para evento fora de
    `EVENTOS`, corpo sem `card`, corpo que não prova o evento, `timestamp`
    fora da janela ou card que não é de lead nosso; `{"ignorado": True,
    "repetido": True}` para o mesmo corpo já aplicado.

    ⚠️ O `?evento=` da URL NÃO é coberto pela assinatura. Quem decide é o
    corpo assinado: `event == "card.list_changed"` e `card.list_id` numa das
    listas do evento (`listas_reuniao` / `listas_ganho` da config). Sem isso,
    um corpo de reunião reenviado com `?evento=deal_won` marcaria venda.
    """
    card = payload.get("card") if isinstance(payload, dict) else None
    if evento not in EVENTOS or not isinstance(card, dict) or _id_do_card(card) is None:
        return {"ignorado": True}
    card_id = _id_do_card(card)
    if payload.get("event") != EVENTO_DO_CORPO:
        logger.info("webhook do GrowthHS: event %r não é %s (card %s)",
                    payload.get("event"), EVENTO_DO_CORPO, card_id)
        return {"ignorado": True}
    cfg = cfg or await growthhs.ler_config()
    lista = _inteiro(card.get("list_id"))
    if lista is None or lista not in _listas_do_evento(cfg, evento):
        logger.info("webhook do GrowthHS: card %s na lista %r não prova %s",
                    card_id, card.get("list_id"), evento)
        return {"ignorado": True}
    momento = _momento(payload.get("timestamp"), agora or datetime.now(timezone.utc))
    if momento is None:
        logger.warning("webhook do GrowthHS: timestamp %r ausente ou fora da janela "
                       "(card %s, %s)", payload.get("timestamp"), card_id, evento)
        return {"ignorado": True}

    # Dois envios do mesmo corpo ao mesmo tempo: a trava da transação faz o
    # segundo esperar o primeiro gravar, e então ele acha o evento.
    await conn.execute("SELECT pg_advisory_xact_lock(hashtext($1))",
                       f"growthhs-webhook:{card_id}:{evento}:{momento}")
    # ⚠️ O recorte de 1 dia em `occurred_at` é para usar o índice
    # (event_type, occurred_at): um repetido só passa da janela de 10 min se
    # o original também passou, então o original é sempre recente.
    if await conn.fetchval(
            """SELECT EXISTS (SELECT 1 FROM contact_events
                WHERE source_app = 'growthhs' AND event_type = $1
                  AND occurred_at > now() - interval '1 day'
                  AND metadata->>'card_id' = $2
                  AND metadata->>'timestamp_growthhs' = $3)""",
            evento, str(card_id), momento):
        logger.info("webhook do GrowthHS: card %s, %s, %s já aplicado",
                    card_id, evento, momento)
        return {"ignorado": True, "repetido": True}

    lead = await lead_do_card(conn, card)
    if lead is None:
        return {"ignorado": True}
    metadata = {"card_id": card_id, "list_id": card.get("list_id"),
                "list_name": card.get("list_name"), "board_id": card.get("board_id"),
                "via": "webhook", "evento_growthhs": payload.get("event"),
                "timestamp_growthhs": momento}
    return await retorno.aplicar_evento(conn, lead, event_type=evento,
                                        title=EVENTOS[evento], metadata=metadata)
