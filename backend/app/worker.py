"""O worker: drena a fila de e-mail, promove campanhas agendadas e roda as
jornadas.

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

# O agendador roda num ritmo próprio: não adianta varrer campanha agendada a
# cada dois segundos, e a granularidade útil do agendamento é o minuto.
AGENDADOR_INTERVALO = 60

# As jornadas têm ritmo próprio: um `delay` de um minuto é a menor unidade que
# o construtor oferece, então varrer com mais frequência que isso não adianta.
JORNADAS_INTERVALO = 20
JORNADAS_LOTE = 25
JORNADAS_LEASE = 300
EVENTOS_LOTE = 50

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
    #
    # ⚠️ LEFT JOIN, não JOIN. E-mail de JORNADA não tem campanha — o nó
    # `send_email` do fluxo cria a linha com `journey_run_id` e `campaign_id`
    # nulo. Com JOIN a linha simplesmente não voltaria, o envio seria concluído
    # como se já tivesse saído, e o fluxo pareceria funcionar enquanto ninguém
    # recebia nada.
    #
    # O assunto e o corpo do e-mail de fluxo vêm do TEMPLATE que o nó aponta.
    envio = await conn.fetchrow(
        """SELECT cs.status, cs.journey_node_id, cs.journey_run_id::text,
                  c.status AS campanha,
                  COALESCE(c.subject, '')  AS subject,
                  COALESCE(c.body, '')     AS body,
                  l.email, l.nome, l.empresa
             FROM campaign_sends cs
             LEFT JOIN campaigns c ON c.id = cs.campaign_id
             JOIN leads l ON l.id = cs.lead_id
            WHERE cs.id = $1::uuid""",
        m.send_id)
    if envio is None or envio["status"] != "pending":
        await fila.concluir(conn, m.fila_id)
        return

    # (b) Se HÁ campanha, ela tem de estar enviando — cancelada não continua
    # saindo. Se não há, é e-mail de fluxo e segue.
    if envio["campanha"] is not None and envio["campanha"] != "sending":
        await conn.execute(
            """UPDATE campaign_sends SET status = 'failed', sent_at = now(),
                   error = 'campanha não está em envio'
                WHERE id = $1::uuid AND status = 'pending'""", m.send_id)
        await fila.concluir(conn, m.fila_id)
        return

    assunto_bruto, corpo_bruto = envio["subject"], envio["body"]
    if envio["journey_run_id"] is not None:
        # E-mail de fluxo: o conteúdo vem do template apontado pelo nó.
        conteudo = await conn.fetchrow(
            """SELECT n->'config'->>'subject' AS subject,
                      t.html AS body
                 FROM journey_runs r
                 JOIN journeys j ON j.id = r.journey_id
                 CROSS JOIN LATERAL jsonb_array_elements(j.nodes) AS n
                 LEFT JOIN email_templates t
                        ON t.id = (n->'config'->>'template_id')::uuid
                WHERE r.id = $1::uuid AND n->>'id' = $2""",
            envio["journey_run_id"], envio["journey_node_id"])
        if conteudo is None or not (conteudo["body"] or "").strip():
            # Sem template resolvido não há o que enviar. Falha visível: um
            # e-mail vazio saindo seria pior que um envio marcado como falho.
            await conn.execute(
                """UPDATE campaign_sends SET status = 'failed', sent_at = now(),
                       error = 'nó de fluxo sem template com conteúdo'
                    WHERE id = $1::uuid AND status = 'pending'""", m.send_id)
            await fila.concluir(conn, m.fila_id)
            return
        assunto_bruto = conteudo["subject"] or "(sem assunto)"
        corpo_bruto = conteudo["body"]

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
    contato = {"nome": envio["nome"], "empresa": envio["empresa"], "email": email}
    html = garantir_rodape(aplicar_merge_tags(corpo_bruto or "", contato, url), url)
    # ⚠️ O ASSUNTO também leva merge tags. O campo da tela sugere isso
    # explicitamente ("Ex: {{nome}}, confira esta novidade!"), e sem esta linha o
    # contato recebe um e-mail com "Oi {{nome}}" na caixa de entrada — o
    # esqueleto do template, no lugar mais visível que existe.
    assunto = aplicar_merge_tags(assunto_bruto or "(sem assunto)", contato, url)
    resend_id = await resend.enviar(
        chave=chave, de=de, para=email,
        assunto=assunto,
        html=html, texto=html_para_texto(html),
        cabecalhos=cabecalhos_rfc8058(url),
        # Estes três nomes exatos são os que o webhook procura. Qualquer outro
        # deixa a correlação no fallback do resend_email_id.
        #
        # ⚠️ Tag de valor nulo é OMITIDA. E-mail de jornada não tem campanha, e
        # o Resend recusa o ENVIO INTEIRO — não só a tag — quando um valor não
        # é string. O `send_id` sozinho já correlaciona de forma exata.
        tags=[{"name": nome, "value": valor} for nome, valor in
              (("send_id", m.send_id), ("campaign_id", m.campaign_id),
               ("lead_id", m.lead_id)) if valor])

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
            # ⚠️ E-mail de fluxo não tem campanha para fechar.
            if campanha is not None:
                await conn.fetchval(
                    "SELECT finalize_campaign_if_drained($1::uuid)", campanha)
    return len(mensagens)


async def _promover_agendadas() -> int:
    """Promove as campanhas cujo horário chegou.

    ⚠️ Isto é o `pg_cron` do Supabase, e a função do banco agora SÓ SELECIONA —
    quem dispara é este laço. A versão herdada chamava `invoke_edge_function`
    (o banco falando com a aplicação por HTTP) e quebrava, porque essa função
    foi apagada no lote 0. Apagar a indireção em vez de portá-la é a decisão
    nº 4 da spec.

    ⚠️ NÃO duplicar o claim: o enfileirador já faz o CAS de `scheduled` para
    `sending`. Duas instâncias do worker chamando a mesma campanha resultam num
    409 para a perdedora, que é o comportamento certo.
    """
    from app.routers.envio import enfileirar

    async with sessao(role="service_role") as conn:
        vencidas = [r["id"] for r in
                    await conn.fetch("SELECT id FROM promote_scheduled_campaigns()")]
    promovidas = 0
    for campanha_id in vencidas:
        try:
            resultado = await enfileirar(str(campanha_id))
            logger.info("campanha agendada %s promovida: %s na fila",
                        campanha_id, resultado["queued"])
            promovidas += 1
        except Exception as e:  # noqa: BLE001 — uma campanha não derruba as outras
            logger.warning("falha ao promover a campanha %s: %s", campanha_id, e)
    return promovidas


async def _rodar_jornadas() -> dict:
    """Uma passada das jornadas, em três blocos — a mesma ordem do original.

    A) matrícula por segmento — quem passou a atender às regras entra
    B) a fila de eventos — acorda quem esperava e matricula quem entra por evento
    C) os runs vencidos — o executor de nós

    ⚠️ A ordem importa: matricular antes de rodar faz o contato novo já andar
    nesta passada, em vez de esperar a próxima.
    """
    from app.jornadas import executor

    resumo = {"matriculados": 0, "acordados": 0, "runs": 0}

    # ---- A. Matrícula por segmento ------------------------------------------
    async with sessao(role="service_role") as conn:
        fluxos = await conn.fetch(
            "SELECT id FROM journeys WHERE status = 'active' AND entry_type = 'segment'")
        for f in fluxos:
            try:
                n = await conn.fetchval(
                    "SELECT journey_enroll_segment($1::uuid, $2)", f["id"], 200)
                resumo["matriculados"] += int(n or 0)
            except Exception as e:  # noqa: BLE001
                logger.warning("matrícula do fluxo %s falhou: %s", f["id"], e)

    # ---- B. A fila de eventos -----------------------------------------------
    # ⚠️ O trigger só INSERE aqui; o trabalho de acordar fluxos é nosso, fora da
    # transação de quem gravou o evento.
    async with sessao(role="service_role") as conn:
        eventos = await conn.fetch(
            """DELETE FROM journey_events
                WHERE id IN (SELECT id FROM journey_events
                              WHERE visivel_em <= now()
                              ORDER BY id LIMIT $1
                              FOR UPDATE SKIP LOCKED)
              RETURNING lead_id::text, event_type, occurred_at, metadata""",
            EVENTOS_LOTE)
        for e in eventos:
            try:
                acordados = await conn.fetchval(
                    "SELECT journey_wake_on_event($1::uuid, $2, $3::timestamptz, $4::jsonb)",
                    e["lead_id"], e["event_type"], e["occurred_at"],
                    e["metadata"] or {})
                if isinstance(acordados, str):
                    import json as _json
                    acordados = _json.loads(acordados)
                resumo["acordados"] += int((acordados or {}).get("woken") or 0)
                n = await conn.fetchval(
                    "SELECT journey_enroll_event($1::uuid, $2)",
                    e["lead_id"], e["event_type"])
                resumo["matriculados"] += int(n or 0)
            except Exception as exc:  # noqa: BLE001
                # ⚠️ O evento já saiu da fila (o DELETE ... RETURNING é o claim).
                # Perder um evento é ruim, mas repô-lo numa transação que já
                # falhou é pior — o log é o rastro.
                logger.warning("evento de jornada %s/%s falhou: %s",
                               e["lead_id"], e["event_type"], exc)

    # ---- C. Os runs vencidos ------------------------------------------------
    async with sessao(role="service_role") as conn:
        runs = await conn.fetch(
            "SELECT * FROM journey_claim_due_runs($1, $2)",
            JORNADAS_LOTE, JORNADAS_LEASE)
    for linha in runs:
        run = {"run_id": str(linha["run_id"]), "journey_id": str(linha["journey_id"]),
               "lead_id": str(linha["lead_id"]),
               "current_node_id": linha["current_node_id"], "state": linha["state"],
               "waiting_event": linha["waiting_event"], "context": linha["context"],
               "lock_token": str(linha["lock_token"]), "nodes": linha["nodes"],
               "reentry": linha["reentry"]}
        try:
            async with sessao(role="service_role") as conn:
                await executor.rodar_cadeia(conn, run)
            resumo["runs"] += 1
        except Exception:  # noqa: BLE001 — um run não derruba os outros
            logger.exception("falha ao rodar a jornada do run %s", run["run_id"])
    return resumo


async def principal() -> None:
    await init_db()
    logger.info("worker no ar — lote de %s, intervalo de %ss",
                settings.FILA_LOTE, settings.WORKER_INTERVALO_SEGUNDOS)
    proximo_agendador = 0.0
    proximo_jornadas = 0.0
    try:
        while not _parar.is_set():
            agora = asyncio.get_running_loop().time()
            if agora >= proximo_agendador:
                proximo_agendador = agora + AGENDADOR_INTERVALO
                try:
                    await _promover_agendadas()
                except Exception:  # noqa: BLE001
                    logger.exception("falha na passada do agendador")
            if agora >= proximo_jornadas:
                proximo_jornadas = agora + JORNADAS_INTERVALO
                try:
                    r = await _rodar_jornadas()
                    if any(r.values()):
                        logger.info("jornadas: %s", r)
                except Exception:  # noqa: BLE001
                    logger.exception("falha na passada das jornadas")
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
