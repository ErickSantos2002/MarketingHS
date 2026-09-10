"""O webhook do Resend. Porte de `resend-webhook/index.ts`.

Recebe os eventos de e-mail (enviado, entregue, aberto, clicado, devolvido,
reclamado) e os transforma em status e métrica.

⚠️ Autentica por **assinatura Svix**, não por chave de API — por isso não usa
`app.chave_api`. Fica sob `/publico` porque é esse prefixo que o limite de taxa
cobre.
"""

import base64
import hashlib
import hmac
import json
import logging
import math
import time
from datetime import datetime, timezone

import asyncpg
from fastapi import APIRouter, Request, Response, status

from app.database import sessao
from app.integracoes import ler_segredo

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/publico", tags=["webhook"])

# Avanço monotônico: sem garantia de ordem de entrega, "opened" pode chegar
# antes de "delivered" — e nunca pode ser rebaixado por ele.
POSICAO = {"pending": 0, "sent": 1, "delivered": 2, "opened": 3, "clicked": 4}

# ⚠️ 'suppressed' está aqui: um envio pulado por supressão nunca chegou a sair,
# e sobrescrevê-lo apagaria o motivo real por um rótulo que sugere, falsamente,
# que o e-mail foi enviado.
TERMINAIS = {"bounced", "complained", "failed", "unsubscribed", "suppressed"}

EVENTO_PARA_STATUS = {
    "email.sent": "sent",
    "email.delivered": "delivered",
    "email.opened": "opened",
    "email.clicked": "clicked",
    "email.bounced": "bounced",
    "email.complained": "complained",
    "email.failed": "failed",
}

# Janela anti-replay. Um evento capturado e reenviado depois disso não vale.
JANELA_SEGUNDOS = 300


def _quando(valor) -> datetime:
    """O `created_at` do evento como datetime, ou agora.

    ⚠️ O asyncpg recusa string em parâmetro `timestamptz` ("expected a
    datetime.date or datetime.datetime instance") e o cast `::timestamptz` NÃO
    salva — ele age no SQL, depois de o driver já ter rejeitado o argumento.
    Este é o segundo lugar do projeto onde isso mordeu; o primeiro foi o
    `scheduled_at` do lote 3A.

    Data ilegível vira agora em vez de derrubar o evento: perder o instante
    exato é muito melhor que devolver 500 e fazer o Svix reentregar por 10h.
    """
    if isinstance(valor, datetime):
        return valor
    if isinstance(valor, str) and valor:
        try:
            return datetime.fromisoformat(valor.replace("Z", "+00:00"))
        except ValueError:
            logger.warning("webhook: created_at ilegível (%r); usando agora", valor)
    return datetime.now(timezone.utc)


def _confere_assinatura(svix_id: str, ts: str, corpo: bytes, segredo: str,
                        cabecalho: str) -> bool:
    """HMAC-SHA256 sobre "{svix-id}.{svix-timestamp}.{corpo}".

    ⚠️ A chave é o base64 DECODIFICADO do segredo sem o prefixo `whsec_` — não
    o texto do segredo. Usar o texto faria toda assinatura falhar, e os eventos
    do Resend seriam rejeitados em silêncio.
    """
    if not (segredo and svix_id and ts and cabecalho):
        return False
    try:
        instante = float(ts)
        # ⚠️ Só `nan` passaria: toda comparação com NaN é falsa, inclusive
        # `> JANELA_SEGUNDOS` (`inf` já cai nessa comparação). A origem
        # recusava não finito.
        if not math.isfinite(instante) or abs(time.time() - instante) > JANELA_SEGUNDOS:
            return False
        chave = base64.b64decode(segredo.removeprefix("whsec_"))
    except Exception:  # noqa: BLE001
        return False

    mac = hmac.new(chave, b"%s.%s." % (svix_id.encode(), ts.encode()) + corpo,
                   hashlib.sha256).digest()
    esperado = base64.b64encode(mac).decode()

    # O cabeçalho traz uma ou mais assinaturas "v1,<base64>" separadas por
    # espaço — é assim que uma rotação de segredo funciona sem perder evento.
    # Aceitar se QUALQUER uma casar.
    for parte in cabecalho.split(" "):
        _, _, assinatura = parte.partition(",")
        if assinatura and hmac.compare_digest(assinatura, esperado):
            return True
    return False


async def _guardar_evento(conn, base: dict, tags: dict) -> str:
    """Insere em `email_events`, degradando os vínculos se preciso.

    ⚠️ `campaign_id` e `lead_id` são FK com ON DELETE SET NULL — mas SET NULL só
    protege linha que JÁ existia no instante do DELETE. Um evento que chega
    DEPOIS da exclusão tenta inserir um id que não existe mais, e isso viola a
    FK (23503, não 23505). Sem tratar, devolvemos 500 e o Svix reentrega o MESMO
    evento por até 10 horas (5s, 5min, 30min, 2h, 5h, 10h) sem nunca conseguir:
    o registro excluído não volta.

    São DUAS portas para o mesmo laço — campanha excluída e contato excluído — e
    fechar só uma deixa a outra girando.

    ⚠️ Um degrau só entra se o vínculo que ele zera estava presente. Um degrau
    que reinsere exatamente a mesma linha repetiria o mesmo 23503: ruído no log
    e uma ida ao banco à toa.

    Devolve 'gravado' ou 'duplicado'.
    """
    tentativas = [(tags.get("campaign_id"), tags.get("lead_id"))]
    if tags.get("campaign_id"):
        tentativas.append((None, tags.get("lead_id")))
    if tags.get("lead_id"):
        tentativas.append((None, None))

    erro = None
    for campanha, lead in tentativas:
        try:
            # ⚠️ SAVEPOINT por degrau. `sessao()` abre UMA transação, e no
            # Postgres qualquer erro a aborta inteira — o degrau seguinte
            # falharia com InFailedSQLTransactionError em vez de tentar de
            # verdade. A origem não tinha esse problema porque o PostgREST
            # mandava cada instrução na própria transação implícita.
            async with conn.transaction():
                await conn.execute(
                    """INSERT INTO email_events
                           (svix_id, event_type, resend_email_id, payload,
                            occurred_at, campaign_id, lead_id)
                       VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz,
                               $6::uuid, $7::uuid)""",
                    base["svix_id"], base["event_type"], base["resend_email_id"],
                    base["payload"], base["occurred_at"], campanha, lead)
            return "gravado"
        except asyncpg.exceptions.UniqueViolationError:
            return "duplicado"
        except asyncpg.exceptions.ForeignKeyViolationError as e:
            erro = e
            logger.warning(
                "webhook: vínculo do evento %s não existe mais; degradando",
                base["svix_id"])
            continue
    raise erro  # noqa: RSE102 — só chega aqui se a escada inteira falhou


async def _achar_envio(conn, tags: dict, email_id: str | None):
    """Resolve o envio. ⚠️ A ORDEM importa:

    a) `tags.send_id` — exato, e é o que o worker manda em todo e-mail
    b) `campaign_id` + `lead_id` — compatibilidade com e-mails em voo
    c) `resend_email_id` — último recurso
    """
    if tags.get("send_id"):
        linha = await conn.fetchrow(
            "SELECT id::text, status FROM campaign_sends WHERE id = $1::uuid",
            tags["send_id"])
        if linha:
            return linha
    if tags.get("campaign_id") and tags.get("lead_id"):
        linha = await conn.fetchrow(
            """SELECT id::text, status FROM campaign_sends
                WHERE campaign_id = $1::uuid AND lead_id = $2::uuid
                ORDER BY sent_at DESC NULLS LAST LIMIT 1""",
            tags["campaign_id"], tags["lead_id"])
        if linha:
            return linha
    if email_id:
        return await conn.fetchrow(
            "SELECT id::text, status FROM campaign_sends "
            "WHERE resend_email_id = $1 LIMIT 1", email_id)
    return None


async def _avancar_status(conn, send_id: str, atual: str, novo: str,
                          quando: datetime) -> None:
    """Avanço monotônico com CAS otimista, até 3 tentativas.

    ⚠️ Duas entregas simultâneas do webhook podem ler o mesmo status defasado, e
    a mais lenta rebaixaria o valor da mais rápida. Por isso o UPDATE é
    condicionado ao status lido; se outra invocação mudou no meio, relemos e
    reavaliamos.

    ⚠️ `fn_campaign_send_event` é um trigger em `campaign_sends` que já propaga
    a mudança para `contact_events`. Não duplicar esse insert aqui.
    """
    for _ in range(3):
        if novo in TERMINAIS:
            avanca = atual not in TERMINAIS
        else:
            avanca = POSICAO.get(novo, -1) > POSICAO.get(atual, 99)
        if not avanca:
            return

        extra = ""
        if novo == "opened":
            extra = ", opened_at = $4::timestamptz"
        elif novo == "clicked":
            extra = ", clicked_at = $4::timestamptz"

        r = await conn.execute(
            f"""UPDATE campaign_sends SET status = $2{extra}
                 WHERE id = $1::uuid AND status = $3""",
            send_id, novo, atual, *( [quando] if extra else [] ))
        if not r.endswith(" 0"):
            return  # venceu o CAS

        fresco = await conn.fetchval(
            "SELECT status FROM campaign_sends WHERE id = $1::uuid", send_id)
        if fresco is None:
            return
        atual = fresco


@router.post("/webhook/resend")
async def resend_webhook(request: Request):
    """⚠️ O corpo é lido CRU. A assinatura é calculada sobre os bytes exatos que
    chegaram; reserializar o JSON depois do parse muda espaços e ordem de
    chaves, e a assinatura deixa de bater."""
    corpo = await request.body()
    segredo = await ler_segredo("RESEND_WEBHOOK_SECRET") or ""
    svix_id = request.headers.get("svix-id", "")

    if not _confere_assinatura(svix_id, request.headers.get("svix-timestamp", ""),
                               corpo, segredo,
                               request.headers.get("svix-signature", "")):
        return Response("assinatura inválida", status_code=status.HTTP_401_UNAUTHORIZED)

    try:
        evento = json.loads(corpo)
    except ValueError:
        return Response("JSON inválido", status_code=status.HTTP_400_BAD_REQUEST)

    dados = evento.get("data") or {}
    tags = {t.get("name"): t.get("value")
            for t in (dados.get("tags") or []) if isinstance(t, dict)}

    base = {
        "svix_id": svix_id,
        "event_type": evento.get("type") or "unknown",
        "resend_email_id": dados.get("email_id"),
        "payload": evento,
        "occurred_at": _quando(evento.get("created_at")),
    }

    async with sessao(role="service_role") as conn:
        try:
            resultado = await _guardar_evento(conn, base, tags)
        except Exception:  # noqa: BLE001
            logger.exception("webhook: falha ao gravar o evento %s", svix_id)
            return Response("erro de banco",
                            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)
        if resultado == "duplicado":
            # ⚠️ 200, não 409. O Svix entrega at-least-once e trata qualquer
            # coisa fora de 2xx como falha, reentregando por 10 horas.
            return Response("ok (duplicado)", status_code=status.HTTP_200_OK)

        envio = await _achar_envio(conn, tags, dados.get("email_id"))
        if envio:
            await conn.execute(
                "UPDATE email_events SET campaign_send_id = $2::uuid "
                "WHERE svix_id = $1", svix_id, envio["id"])
            novo = EVENTO_PARA_STATUS.get(base["event_type"])
            if novo:
                await _avancar_status(conn, envio["id"], envio["status"], novo,
                                      base["occurred_at"])

        # Supressão automática. ⚠️ Só hard bounce: `Transient` é caixa cheia ou
        # servidor fora do ar, e suprimir aí queimaria um contato bom.
        destino = dados.get("to")
        destino = destino[0] if isinstance(destino, list) and destino else destino
        bounce_duro = (base["event_type"] == "email.bounced"
                       and (dados.get("bounce") or {}).get("type") != "Transient")
        if destino and (bounce_duro or base["event_type"] == "email.complained"):
            # ignoreDuplicates: a primeira razão de supressão prevalece.
            await conn.execute(
                """INSERT INTO email_suppressions (email, reason, source, lead_id)
                   VALUES ($1, $2, 'resend-webhook', $3::uuid)
                   ON CONFLICT (email) DO NOTHING""",
                str(destino).strip().lower(),
                "complaint" if base["event_type"] == "email.complained" else "bounce",
                tags.get("lead_id"))

    return Response("ok", status_code=status.HTTP_200_OK)
