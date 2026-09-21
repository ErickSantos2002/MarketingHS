"""Escrita nas tabelas de eventos do A/B, comum ao redirecionador e ao coletor."""

import re
from datetime import datetime, timezone
from uuid import UUID

# As colunas de origem do clique, na ordem da origem: UTMs e click ids.
ORIGEM = ("utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
          "gclid", "fbclid", "ttclid", "msclkid")

# Reenvio de exposição/conversão é absorvido pelo índice parcial da origem
# (`uq_ab_events_dedupe`). A origem tratava o 23505 como sucesso; aqui nem chega
# a ser erro.
SEM_DUPLICATA = "ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING"


async def inserir(conn, tabela: str, linha: dict, conflito: str = "") -> None:
    """INSERT de uma linha.

    ⚠️ `tabela` e as CHAVES de `linha` vêm do código, nunca do request — é o
    que deixa montar o SQL por f-string. Os VALORES vão como parâmetro.
    """
    colunas = list(linha)
    marcas = ", ".join(f"${i + 1}" for i in range(len(colunas)))
    await conn.execute(
        f"INSERT INTO {tabela} ({', '.join(colunas)}) VALUES ({marcas}) {conflito}",
        *linha.values())


TIPOS = {"assignment", "exposure", "behavior", "schedule_step", "conversion"}
MAX_EVENTOS = 50
# Robôs que executam JS são raros; os conhecidos ficam de fora para a
# exposição ficar limpa. Lista da origem, inteira.
ROBO = re.compile(r"bot|crawler|spider|crawling|slurp|bingpreview|facebookexternalhit"
                  r"|whatsapp|telegrambot|preview|headless|lighthouse|pingdom|gtmetrix"
                  r"|monitor", re.I)


def chave_de_dedupe(evento: dict) -> str | None:
    """Idempotência da origem. `None` deixa repetir (behavior, assignment).

    ⚠️ Usa os valores CRUS do evento, antes de truncar — como a origem.
    """
    vid, teste = evento.get("ab_vid"), evento.get("ab_test")
    tipo, nome = evento.get("event_type"), evento.get("event_name")
    metadata = evento.get("metadata")
    passo = metadata.get("step") if isinstance(metadata, dict) else None
    if tipo == "exposure":
        return f"{vid}:{teste}:exposure"
    if tipo == "conversion":
        return f"{vid}:{teste}:conversion:{nome or 'default'}"
    if tipo == "schedule_step":
        return f"{vid}:{teste}:schedule_step:{nome or passo or ''}"
    return None


def _texto(valor, maximo: int = 2000) -> str | None:
    """Trunca para não aceitar payload abusivo. `""` continua `""`."""
    return None if valor is None else str(valor)[:maximo]


def _quando(valor) -> datetime:
    """Decisão 11: data ilegível vira agora, em vez de derrubar o evento."""
    try:
        data = datetime.fromisoformat(str(valor)[:40])
    except ValueError:
        return datetime.now(timezone.utc)
    return data if data.tzinfo else data.replace(tzinfo=timezone.utc)


def _uuid_ou_nada(valor) -> str | None:
    """Decisão 11: `lead_id` é uuid no banco; lixo vira nulo, não evento perdido."""
    try:
        return str(UUID(str(valor))) if valor is not None else None
    except ValueError:
        return None


def normalizar_evento(evento, ua_lido: dict, referer: str | None,
                      idioma: str | None) -> dict | None:
    """Uma linha de `ab_events`, ou `None` se o evento não serve.

    Inválido é descartado em silêncio — o coletor é fire-and-forget e nunca
    falha o request por um evento ruim. Aparelho, navegador e sistema que o
    cliente não mandar saem do user-agent do request.
    """
    if not isinstance(evento, dict):
        return None
    ab_test = _texto(evento.get("ab_test"), 200)
    ab_vid = _texto(evento.get("ab_vid"), 200)
    tipo = _texto(evento.get("event_type"), 40)
    if not ab_test or not ab_vid or tipo not in TIPOS:
        return None
    metadata = evento.get("metadata")
    return {
        "ab_test": ab_test, "ab_var": _texto(evento.get("ab_var"), 40), "ab_vid": ab_vid,
        "event_type": tipo, "event_name": _texto(evento.get("event_name"), 200),
        "occurred_at": _quando(evento.get("occurred_at")),
        "page_slug": _texto(evento.get("page_slug"), 400),
        "url": _texto(evento.get("url")),
        "referrer": _texto(evento.get("referrer")) or referer,
        "lead_id": _uuid_ou_nada(evento.get("lead_id")),
        "dnia_id": _texto(evento.get("dnia_id"), 100),
        **{c: _texto(evento.get(c), 400) for c in ORIGEM},
        "raw_query": _texto(evento.get("raw_query"), 4000),
        "device_type": _texto(evento.get("device_type"), 40) or ua_lido["device_type"],
        "browser": _texto(evento.get("browser"), 80) or ua_lido["browser"],
        "browser_version": _texto(evento.get("browser_version"), 40),
        "os": _texto(evento.get("os"), 80) or ua_lido["os"],
        "language": _texto(evento.get("language"), 40) or idioma,
        "screen_resolution": _texto(evento.get("screen_resolution"), 40),
        "metadata": metadata if isinstance(metadata, dict) else None,
        "dedupe_key": chave_de_dedupe(evento),
    }
