"""O worker: drena a fila de e-mail.

Substitui o `pg_cron` por um laço `asyncio`, no padrão do `guardiao_crons.py` do
HS.OS. Roda como processo separado (`python -m app.worker`) porque reiniciar a
API não pode pausar um disparo em andamento, e uma exceção no envio não pode
derrubar o admin.

⚠️ Sem `RESEND_API_KEY` o worker NÃO reivindica nada e diz por quê. Fingir que
enviou seria o pior comportamento possível: as linhas sairiam de 'pending', a
campanha fecharia como enviada, e ninguém receberia nada.
"""

import asyncio
import logging
import signal

from app import fila, integracoes
from app.config import settings
from app.database import close_db, init_db, sessao
from app.email import resend
from app.email.montagem import (
    aplicar_merge_tags,
    cabecalhos_rfc8058,
    garantir_rodape,
    url_de_descadastro,
)
from app.texto import html_para_texto

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("worker")

REMETENTE_PADRAO = "MarketingHS <noreply@localhost>"

_parar = asyncio.Event()


async def _remetente() -> str:
    """A MESMA ordem de prioridade do `send-test-email`: o valor gravado vence
    o ambiente. Divergir faria o e-mail de teste sair de um remetente
    diferente do que a campanha real usa — ou seja, testaria a coisa errada."""
    return (await integracoes.ler_segredo("EMAIL_FROM")) or REMETENTE_PADRAO


async def _processar(conn, m: fila.Mensagem, chave: str, de: str,
                     segredo_descadastro: str) -> None:
    """Processa uma mensagem. Levanta se o envio falhar — quem chama devolve."""
    # (a) A linha ainda está 'pending'? Se não, outra passagem já enviou.
    # É o que torna o reprocessamento inofensivo.
    # `campaigns.body` guarda o HTML exportado do Unlayer (o `design` é o JSON
    # do editor, que não se envia). Ver CampaignWizard: body = emailHtml.
    envio = await conn.fetchrow(
        """SELECT cs.status, c.status AS campanha, c.subject, c.body,
                  l.email, l.nome, l.empresa
             FROM campaign_sends cs
             JOIN campaigns c ON c.id = cs.campaign_id
             JOIN leads l ON l.id = cs.lead_id
            WHERE cs.id = $1::uuid""",
        m.send_id)
    if envio is None or envio["status"] != "pending":
        await fila.concluir(conn, m.fila_id)
        return

    # (b) A campanha ainda está enviando? Cancelada não deve continuar saindo.
    if envio["campanha"] != "sending":
        await conn.execute(
            """UPDATE campaign_sends SET status = 'failed', sent_at = now(),
                   error = 'campanha não está em envio'
                WHERE id = $1::uuid AND status = 'pending'""", m.send_id)
        await fila.concluir(conn, m.fila_id)
        return

    email = (envio["email"] or "").strip().lower()

    # (c) Supressão. ⚠️ 'suppressed', NÃO 'failed': não é erro, é a lista de
    # descadastro funcionando — e o finalize conta os dois separados.
    suprimido = await conn.fetchval(
        "SELECT 1 FROM email_suppressions WHERE email = $1", email)
    if suprimido:
        await conn.execute(
            """UPDATE campaign_sends SET status = 'suppressed', sent_at = now(),
                   error = 'endereço na lista de descadastro'
                WHERE id = $1::uuid AND status = 'pending'""", m.send_id)
        await fila.concluir(conn, m.fila_id)
        return

    # (d) Montar e enviar.
    url = url_de_descadastro(settings.FRONTEND_URL, m.lead_id, email,
                             segredo_descadastro)
    html = aplicar_merge_tags(
        envio["body"] or "",
        {"nome": envio["nome"], "empresa": envio["empresa"], "email": email},
        url)
    html = garantir_rodape(html, url)
    resend_id = await resend.enviar(
        chave=chave, de=de, para=email,
        assunto=envio["subject"] or "(sem assunto)",
        html=html, texto=html_para_texto(html),
        cabecalhos=cabecalhos_rfc8058(url))

    # (e) Só agora sai da fila.
    await conn.execute(
        """UPDATE campaign_sends SET status = 'sent', sent_at = now(),
               resend_email_id = $2
            WHERE id = $1::uuid AND status = 'pending'""",
        m.send_id, resend_id)
    await fila.concluir(conn, m.fila_id)


async def _tick() -> int:
    """Uma passada. Devolve quantas mensagens foram tratadas."""
    chave = await integracoes.ler_segredo("RESEND_API_KEY")
    if not chave:
        # ⚠️ Não reivindica NADA. Ver o aviso no topo do módulo.
        logger.warning(
            "RESEND_API_KEY ausente — a fila NÃO será consumida. "
            "Grave o segredo em integration_secrets ou no ambiente.")
        return 0

    segredo = await integracoes.ler_segredo("UNSUBSCRIBE_SECRET")
    if not segredo:
        # Sem ele o link de descadastro não pode ser assinado, e enviar e-mail
        # de campanha sem saída é o que queima a reputação do remetente.
        logger.warning("UNSUBSCRIBE_SECRET ausente — a fila NÃO será consumida.")
        return 0

    de = await _remetente()

    async with sessao(role="service_role") as conn:
        mensagens = await fila.reivindicar(
            conn, limite=settings.FILA_LOTE,
            visibilidade=settings.FILA_VISIBILIDADE_SEGUNDOS)

    if not mensagens:
        return 0

    campanhas = set()
    for m in mensagens:
        campanhas.add(m.campaign_id)
        try:
            async with sessao(role="service_role") as conn:
                await _processar(conn, m, chave, de, segredo)
        except Exception as e:  # noqa: BLE001 — uma falha não derruba o lote
            logger.warning("envio %s falhou: %s", m.send_id, e)
            async with sessao(role="service_role") as conn:
                destino = await fila.devolver(
                    conn, m.fila_id, str(e)[:500],
                    max_tentativas=settings.FILA_MAX_TENTATIVAS)
                if destino == "morta":
                    # A mensagem saiu da fila; a linha precisa sair de 'pending'
                    # ou a campanha nunca fecha.
                    await conn.execute(
                        """UPDATE campaign_sends SET status = 'failed',
                               sent_at = now(), error = $2
                            WHERE id = $1::uuid AND status = 'pending'""",
                        m.send_id, str(e)[:500])

    # O fechamento é do banco: só ele sabe se `pending` chegou a zero.
    async with sessao(role="service_role") as conn:
        for campanha in campanhas:
            await conn.fetchval("SELECT finalize_campaign_if_drained($1::uuid)",
                                campanha)
    return len(mensagens)


async def principal() -> None:
    await init_db()
    logger.info("worker no ar — lote de %s, intervalo de %ss",
                settings.FILA_LOTE, settings.WORKER_INTERVALO_SEGUNDOS)
    try:
        while not _parar.is_set():
            try:
                tratadas = await _tick()
            except Exception:  # noqa: BLE001 — o laço não morre por uma passada
                logger.exception("falha na passada do worker")
                tratadas = 0
            # Fila vazia espera o intervalo; fila cheia volta na hora.
            espera = 0 if tratadas else settings.WORKER_INTERVALO_SEGUNDOS
            try:
                await asyncio.wait_for(_parar.wait(), timeout=espera or 0.01)
            except asyncio.TimeoutError:
                pass
    finally:
        await close_db()
        logger.info("worker encerrado")


def _pedir_parada(*_):
    _parar.set()


if __name__ == "__main__":
    for s in (signal.SIGINT, signal.SIGTERM):
        signal.signal(s, _pedir_parada)
    asyncio.run(principal())
