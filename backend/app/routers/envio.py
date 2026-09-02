"""O enfileirador. Porte de `send-campaign/index.ts`.

Resolve a audiência, cria as linhas `campaign_sends` 'pending' e publica na
fila. Devolve na hora — quem envia é o worker (`app/worker.py`).

⚠️ Este módulo NÃO envia e-mail e NÃO fala com o Resend. Toda a lógica por
destinatário (supressão, merge tags, descadastro) vive em `app/email/` e roda no
worker, o mais perto possível do envio.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, status

from pydantic import BaseModel, Field

from app import fila, integracoes
from app.database import sessao
from app.dependencies import Usuario, admin_atual
from app.email import resend
from app.email.montagem import normalizar_email
from app.texto import html_para_texto

# O remetente sai do mesmo lugar que o worker usa — dois padrões diferentes
# fariam o teste chegar de um endereço e a campanha de outro.
REMETENTE_PADRAO = "MarketingHS <onboarding@resend.dev>"


async def _remetente() -> str:
    return (await integracoes.ler_segredo("EMAIL_FROM")) or REMETENTE_PADRAO

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/campanhas", tags=["campanhas-envio"])

# Status a partir dos quais uma campanha pode ser (re)enfileirada.
# 'sending' e 'sent' ficam de fora: é o que impede enfileiramento duplo.
INICIAVEL = ("draft", "scheduled", "failed", "paused")

# Teto do caminho "todos os contatos". Com segmento de inclusão não há teto —
# é o comportamento da origem, e o endpoint de audiência do 3A já avisa a tela
# com `teto_aplicado`.
TETO_SEM_SEGMENTO = 5000


@router.post("/{campanha_id}/enviar")
async def enviar(campanha_id: str, _: Usuario = Depends(admin_atual)):
    """Enfileira a campanha para envio.

    ⚠️ `admin_atual`, não `usuario_atual`. A function de origem rodava com
    `verify_jwt=false` e SEM checagem no corpo: qualquer pessoa que descobrisse
    o UUID de uma campanha forçava o envio para até 5.000 contatos com um POST
    anônimo. Foi corrigido lá e não se reintroduz aqui.
    """
    return await enfileirar(campanha_id)


async def enfileirar(campanha_id: str) -> dict:
    """O enfileiramento em si, sem autenticação.

    Separado da rota porque o AGENDADOR do worker precisa dele e não tem
    usuário para autenticar. Escrever um segundo enfileirador para o agendador
    seria criar duas implementações da mesma coisa — e a que diverge é sempre a
    que ninguém está olhando.
    """
    async with sessao(role="service_role") as conn:
        campanha = await conn.fetchrow(
            """SELECT id::text, status, channel,
                      segment_ids::text[] AS incluir,
                      excluded_segment_ids::text[] AS excluir
                 FROM campaigns WHERE id = $1::uuid""", campanha_id)
        if campanha is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Campanha não encontrada.")
        if campanha["channel"] != "email":
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Só campanhas de e-mail passam por esta fila. O canal WhatsApp "
                "não foi portado.")
        if campanha["status"] not in INICIAVEL:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Esta campanha está em {campanha['status']!r} e não pode ser "
                "enfileirada.")

        # ⚠️ CLAIM ATÔMICO, antes de qualquer trabalho pesado. Duas chamadas
        # concorrentes disputam este UPDATE; a perdedora recebe 0 linhas e
        # aborta. É isto que garante que uma campanha nunca é enfileirada duas
        # vezes — não a checagem acima, que é só uma mensagem melhor.
        r = await conn.execute(
            """UPDATE campaigns SET status = 'sending', updated_at = now()
                WHERE id = $1::uuid AND status = $2""",
            campanha_id, campanha["status"])
        if r.endswith(" 0"):
            raise HTTPException(status.HTTP_409_CONFLICT,
                                "Esta campanha já está em envio (claim perdido).")

        incluir = campanha["incluir"] or []
        excluir = campanha["excluir"] or []
        limite = None if incluir else TETO_SEM_SEGMENTO

        # A audiência sai de `resolve_segment_audience` — a MESMA RPC que o card
        # da campanha mostra. Duas implementações divergiriam, e a divergência
        # apareceria como "o card dizia 500 e saíram 480".
        publico = await conn.fetch(
            """SELECT l.id::text AS lead_id, l.email, l.dnia_id::text
                 FROM resolve_segment_audience($1::uuid[], $2::uuid[], $3) a
                 JOIN leads l ON l.id = a.lead_id
                WHERE l.deleted_at IS NULL""",
            incluir, excluir, limite)

        # As linhas que já existem para esta campanha, em DOIS grupos — tratá-las
        # igual quebra a recuperação:
        #   não-'pending' -> contato realmente processado: exclui da audiência
        #   'pending'     -> órfã de uma execução que morreu antes de publicar.
        #                    NÃO re-inserir (o índice único barra), mas
        #                    REPUBLICAR o send_id existente.
        # É isto que torna um re-run um caminho de recuperação real: sem o
        # segundo grupo a órfã ficaria encalhada para sempre — não pode ser
        # re-inserida nem seria republicada, e a campanha ficaria presa em
        # 'sending' com pending > 0 impedindo o finalize.
        existentes = await conn.fetch(
            """SELECT id::text, lead_id::text, status
                 FROM campaign_sends
                WHERE campaign_id = $1::uuid AND channel = 'email'
                  AND lead_id IS NOT NULL""",
            campanha_id)
        orfas = [{"send_id": e["id"], "campaign_id": campanha_id,
                  "lead_id": e["lead_id"]}
                 for e in existentes if e["status"] == "pending"]
        processados = {e["lead_id"] for e in existentes if e["status"] != "pending"}
        pendentes = {o["lead_id"] for o in orfas}

        novos = [p for p in publico
                 if p["lead_id"] not in processados and p["lead_id"] not in pendentes]
        com_email = [p for p in novos if (p["email"] or "").strip()]
        sem_email = [p for p in novos if not (p["email"] or "").strip()]

        # Contato sem e-mail nunca entra na fila: vira 'failed' aqui mesmo.
        # ⚠️ A supressão NÃO é conferida aqui, de propósito — ela é conferida no
        # worker, o mais perto possível do envio, para não usar uma lista
        # defasada. Um contato pode se descadastrar entre o enfileiramento e o
        # disparo.
        if sem_email:
            await conn.execute(
                """INSERT INTO campaign_sends
                       (campaign_id, lead_id, dnia_id, channel, status, sent_at, error)
                   SELECT $1::uuid, x.lead_id::uuid, NULLIF(x.dnia_id,'')::uuid,
                          'email', 'failed', now(), 'contato sem e-mail'
                     FROM jsonb_to_recordset($2::jsonb)
                          AS x(lead_id text, dnia_id text)
                   ON CONFLICT DO NOTHING""",
                campanha_id,
                [{"lead_id": p["lead_id"], "dnia_id": p["dnia_id"] or ""}
                 for p in sem_email])

        if not com_email and not orfas:
            # Só dá para sair cedo se não há NEM contato novo NEM órfã para
            # republicar — senão as órfãs ficariam encalhadas e a campanha
            # nunca fecharia.
            await conn.fetchval("SELECT finalize_campaign_if_drained($1::uuid)",
                                campanha_id)
            return {"queued": 0, "ignorados": len(sem_email) + len(processados),
                    "campaign_id": campanha_id}

        # ⚠️ DUAS PASSADAS ESTRITAMENTE ORDENADAS. Não é estilo: é o que elimina
        # a corrida do finalize por construção.
        #
        # `finalize_campaign_if_drained` só olha `count(*) FILTER (status='pending')`.
        # Se inseríssemos e publicássemos em lotes intercalados, existiria uma
        # janela real: o worker drena o lote 1 enquanto o enfileirador ainda não
        # inseriu as linhas do lote 2 -> pending chega a zero -> a campanha é
        # fechada como 'sent' cedo demais. E como o UPDATE do finalize é guardado
        # por `status='sending'`, os lotes seguintes seriam rejeitados pelo
        # próprio worker — subcontagem permanente e silenciosa.
        #
        # Passada 1: TODAS as linhas 'pending' da audiência inteira.
        # Passada 2: só então as mensagens na fila.
        # No instante em que a primeira mensagem fica visível, campaign_sends já
        # tem uma linha 'pending' para CADA destinatário. Sem timing, sem sleep.
        inseridos = await conn.fetch(
            """INSERT INTO campaign_sends
                   (campaign_id, lead_id, dnia_id, channel, status)
               SELECT $1::uuid, x.lead_id::uuid, NULLIF(x.dnia_id,'')::uuid,
                      'email', 'pending'
                 FROM jsonb_to_recordset($2::jsonb) AS x(lead_id text, dnia_id text)
               ON CONFLICT DO NOTHING
               RETURNING id::text, lead_id::text""",
            campanha_id,
            [{"lead_id": p["lead_id"], "dnia_id": p["dnia_id"] or ""}
             for p in com_email])

        mensagens = [{"send_id": i["id"], "campaign_id": campanha_id,
                      "lead_id": i["lead_id"]} for i in inseridos] + orfas
        publicadas = await fila.publicar(conn, mensagens)

    logger.info("campanha %s enfileirada: %s mensagens (%s órfãs republicadas)",
                campanha_id, publicadas, len(orfas))
    return {"queued": publicadas,
            "ignorados": len(sem_email) + len(processados),
            "campaign_id": campanha_id}


# ── Envio de teste ───────────────────────────────────────────────────────────
# Porte de `send-test-email`. Copiado da function, não lembrado.

# ⚠️ Os valores de amostra são da origem, e existem para o admin ver o template
# com texto no lugar de `{{nome}}`. O `{{unsubscribe_url}}` vira '#' de
# propósito: um e-mail de teste NÃO pode carregar link de descadastro válido —
# clicar nele descadastraria um contato de verdade.
AMOSTRA_MERGE_TAGS = {
    "{{nome}}": "João Silva",
    "{{empresa}}": "Empresa LTDA",
    "{{email}}": "joao@empresa.com",
    "{{unsubscribe_url}}": "#",
}


class TesteIn(BaseModel):
    template_id: str
    to: str = Field(min_length=3, max_length=320)


@router.post("/enviar-teste")
async def enviar_teste(dados: TesteIn, _: Usuario = Depends(admin_atual)):
    """Um e-mail de teste a partir de um template, para o admin conferir como
    ele chega no cliente de e-mail.

    ⚠️ **O HTML nunca vem do corpo da requisição** — só o `template_id`. É o que
    impede a rota de virar um relay para mandar qualquer coisa de dentro do
    domínio da HS.

    ⚠️ **Sem tags do Resend, de propósito.** O `resend-webhook` resolve envios
    pelas tags, e um teste não tem linha em `campaign_sends` para correlacionar:
    com tag, o evento de abertura do teste bateria num envio real.
    """
    async with sessao(role="service_role") as conn:
        modelo = await conn.fetchrow(
            "SELECT name, html FROM email_templates WHERE id = $1::uuid",
            dados.template_id)
        if modelo is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Template não encontrado.")
        if not (modelo["html"] or "").strip():
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                "Este template ainda não tem conteúdo para enviar.")
        # A supressão vale também para o teste: o endereço pode ser o de um
        # contato que se descadastrou, e mandar assim é o que queima domínio.
        #
        # ⚠️ `normalize_suppression_email` NÃO serve para isto — apesar do nome,
        # ela não recebe argumento: é a função do TRIGGER que normaliza a coluna
        # na gravação. A comparação usa o mesmo `normalizar_email` que o worker
        # aplica em `_processar`, senão um endereço com maiúscula passaria pela
        # supressão.
        suprimido = await conn.fetchrow(
            "SELECT reason FROM email_suppressions WHERE email = $1",
            normalizar_email(dados.to))
    if suprimido:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Este endereço está na lista de descadastro ({suprimido['reason']}) "
            f"e não pode receber e-mails.")

    chave = await integracoes.ler_segredo("RESEND_API_KEY")
    if not chave:
        # ⚠️ 503 e não 500: a falta da chave é decisão em aberto (o envio real
        # está adiado), não defeito. A tela precisa distinguir uma coisa da
        # outra para não mandar ninguém caçar bug onde não há.
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "O Resend ainda não está configurado — grave a chave em "
            "Configurações → Resend para enviar e-mails de teste.")

    html = modelo["html"]
    for tag, amostra in AMOSTRA_MERGE_TAGS.items():
        html = html.replace(tag, amostra)

    de = await _remetente()
    try:
        eid = await resend.enviar(
            chave=chave, de=de, para=dados.to,
            assunto=f"[Teste] {modelo['name']}",
            html=html, texto=html_para_texto(html), cabecalhos={}, tags=None)
    except Exception as exc:  # noqa: BLE001
        logger.warning("envio de teste falhou: %s", exc)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                            "O Resend recusou o envio.")
    return {"enviado": True, "para": dados.to, "de": de, "resend_email_id": eid}
