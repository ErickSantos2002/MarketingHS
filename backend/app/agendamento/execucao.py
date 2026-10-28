"""A fila do agendamento: da reserva à reunião no GrowthHS (Task 7).

Uma reserva (`status = 'reservada'`) vira, passo a passo, com o id de cada
coisa gravado ASSIM QUE EXISTE — a falha no meio retoma do passo seguinte,
nunca refaz o card (molde `crm/entrega.py`):

    1. pessoa (`achar_ou_criar_pessoa`)                → person_id
    2. card: o aberto do lead (sem vendedor, ganha o da reserva) ou um novo
       na lista "Reunião Agendada" com o vendedor, assinado
       `Pedido MarketingHS: <id da reserva>`; o retry depois de um 201
       perdido o reconhece pela assinatura                → card_id
    3. nota de abertura + "Reunião agendada pelo lead…"   → dados.nota_enviada
    4. tarefa `meeting` com o lead convidado             → task_id
    5. sala de vídeo (evento no Outlook do vendedor)     → public_link
       ⚠️ `convidados_removidos > 0` num 2xx é o convite CORTADO em silêncio
       (`DAILY_DEV_MODE` de lá): falha que alerta, não sucesso
    6. e-mail ao vendedor                                 → email_vendedor_em,
                                                            status `criada`

Erro transitório: volta com espera crescente (`entrega.espera_transitoria`),
até `entrega.MAX_TENTATIVAS`. Definitivo ou esgotado: `falhou` — que CONTINUA
bloqueando o horário do vendedor (o lead já leu "confirmado") — e e-mail de
alerta aos admins, uma vez só (`alerta_em`). Não troca de vendedor sozinha.

⚠️ Rede nunca dentro de transação. ⚠️ Agendamento de TESTE (`@exemplo.invalid`)
nunca sai por passada sem `somente` — o worker de produção não pode mandar o
falso ao GrowthHS real (mesma lição de `entrega.LEAD_DE_TESTE`).
"""

import asyncio
import html
import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app import integracoes
from app.agendamento import reserva
from app.config import settings
from app.crm import entrega, growthhs
from app.database import sessao
from app.email import resend
from app.texto import html_para_texto

logger = logging.getLogger(__name__)

FUSO = ZoneInfo("America/Sao_Paulo")
UTC = timezone.utc
REMETENTE_PADRAO = "MarketingHS <noreply@localhost>"
LISTA_REUNIAO_PADRAO = 28
ABANDONO = timedelta(minutes=30)
PRAZO_DA_REIVINDICACAO = timedelta(minutes=10)
AGENDAMENTO_DE_TESTE = "lower(email) LIKE '%@exemplo.invalid'"
DIAS_DA_SEMANA = ("segunda-feira", "terça-feira", "quarta-feira", "quinta-feira",
                  "sexta-feira", "sábado", "domingo")


class _Falha(Exception):
    """Definitivo daqui (não do HTTP): falha a reserva e alerta."""


def _dados(ag) -> dict:
    return reserva._dados(ag["dados"])


def _quando(ag) -> tuple[str, str]:
    inicio = ag["inicio"].astimezone(FUSO)
    return inicio.strftime("%d/%m/%Y"), inicio.strftime("%H:%M")


# ── E-mails ──────────────────────────────────────────────────────────────────

def montar_email_vendedor(ag: dict, lead: dict, url_card: str | None) -> tuple[str, str, str]:
    """(assunto, html, texto) do aviso ao vendedor. Tudo que veio do
    formulário público passa por `html.escape` (e por `uma_linha`)."""
    dados = reserva._dados(ag.get("dados"))
    respostas = reserva.respostas(dados)
    inicio = ag["inicio"].astimezone(FUSO)
    duracao = int((ag["fim"] - ag["inicio"]).total_seconds() // 60)
    linha = growthhs.uma_linha

    def campo(chave):
        return linha(lead.get(chave) or respostas.get(chave))

    empresa = campo("empresa") or campo("nome") or "lead"
    assunto = f"Reunião agendada: {empresa} — {inicio:%d/%m} às {inicio:%H:%M}"[:200]
    itens = [
        ("Quando", f"{DIAS_DA_SEMANA[inicio.weekday()]}, {inicio:%d/%m/%Y} às "
                   f"{inicio:%H:%M} (Brasília), {duracao} min"),
        ("Nome", campo("nome")), ("Empresa", campo("empresa")), ("Cargo", campo("cargo")),
        ("E-mail", linha(lead.get("email") or ag.get("email"))),
        ("WhatsApp", campo("whatsapp")),
        ("Funcionários", campo("funcionarios")), ("Filiais", campo("filiais")),
    ]
    vistos = {"nome", "empresa", "cargo", "email", "whatsapp", "funcionarios", "filiais",
              "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
              "source", "ab_test", "ab_var", "ab_vid", "tipo", "status"}
    for chave, valor in respostas.items():
        if chave not in vistos and linha(valor):
            itens.append((linha(chave), linha(valor)))
    itens.append(("Página de origem", linha(ag.get("page_slug"))))
    if linha(respostas.get("utm_campaign")):
        itens.append(("Campanha", linha(respostas.get("utm_campaign"))))
    if ag.get("public_link"):
        itens.append(("Sala de vídeo", linha(ag["public_link"])))
    itens = [(r, v) for r, v in itens if v]

    e = html.escape
    linhas_html = "".join(
        f"<tr><td style=\"padding:4px 12px 4px 0;color:#555\">{e(r)}</td>"
        f"<td style=\"padding:4px 0\"><strong>{e(v)}</strong></td></tr>" for r, v in itens)
    botao = (f"<p><a href=\"{e(url_card, quote=True)}\" style=\"display:inline-block;"
             f"padding:10px 18px;background:#0b5cad;color:#fff;border-radius:6px;"
             f"text-decoration:none\">Abrir no GrowthHS</a></p>") if url_card else ""
    corpo_html = (f"<p>Um lead agendou uma reunião com você pela landing.</p>"
                  f"<table>{linhas_html}</table>{botao}"
                  f"<p style=\"color:#777;font-size:12px\">Dados informados no formulário, "
                  f"não verificados. O evento já está na sua agenda do Outlook.</p>")
    texto = "\n".join(["Um lead agendou uma reunião com você pela landing.", ""]
                      + [f"{r}: {v}" for r, v in itens]
                      + ([f"Abrir no GrowthHS: {url_card}"] if url_card else []))
    return assunto, corpo_html, texto


async def _remetente() -> tuple[str | None, str, str]:
    chave = await integracoes.ler_segredo("RESEND_API_KEY")
    de = (await integracoes.ler_segredo("EMAIL_FROM")) or REMETENTE_PADRAO
    responder = (await integracoes.ler_segredo("EMAIL_REPLY_TO")) or ""
    return chave, de, responder


async def alertar_admins(ag: dict, motivo: str) -> None:
    """E-mail a todo admin: a reunião que o lead acha confirmada não ficou
    pronta. Uma vez só por reserva (`alerta_em`)."""
    if ag.get("alerta_em") is not None:
        return
    async with sessao(role="service_role") as conn:
        if await conn.fetchval(
                "SELECT alerta_em FROM reuniao_agendamentos WHERE id = $1", ag["id"]):
            return
        admins = [r["email"] for r in await conn.fetch(
            """SELECT DISTINCT u.email FROM public.user_roles r
                 JOIN auth.users u ON u.id = r.user_id
                WHERE r.role = 'admin' AND u.email IS NOT NULL""")]
    chave, de, responder = await _remetente()
    if not chave or not admins:
        logger.error("[agendamento] alerta da reserva %s sem como enviar (Resend/admin): %s",
                     ag["id"], motivo)
        return
    dia, hora = _quando(ag)
    e = html.escape
    linha = growthhs.uma_linha
    itens = [("Motivo", linha(motivo)), ("Lead", linha(ag.get("email"))),
             ("Horário", f"{dia} às {hora} (Brasília)"),
             ("Vendedor", linha(ag.get("vendedor_nome") or ag.get("vendedor_id"))),
             ("Página", linha(ag.get("page_slug"))),
             ("Card no GrowthHS", linha(ag.get("card_id") or "não criado"))]
    corpo = ("<p>Uma reunião agendada pela landing <strong>não ficou pronta</strong>. "
             "O lead viu \"confirmado\" e o horário segue reservado para o vendedor — "
             "confira no GrowthHS e fale com o lead.</p><ul>"
             + "".join(f"<li>{e(r)}: {e(str(v))}</li>" for r, v in itens) + "</ul>")
    for email in admins:
        try:
            await resend.enviar(chave=chave, de=de, para=email,
                                assunto=f"[MarketingHS] Agendamento com falha — {dia} {hora}",
                                html=corpo, texto=html_para_texto(corpo), cabecalhos={},
                                responder_para=responder)
        except Exception:  # noqa: BLE001 — o alerta tenta os outros admins
            logger.exception("[agendamento] alerta da reserva %s não saiu", ag["id"])
    async with sessao(role="service_role") as conn:
        await conn.execute(
            "UPDATE reuniao_agendamentos SET alerta_em = now() WHERE id = $1", ag["id"])


# ── Fila ─────────────────────────────────────────────────────────────────────

async def _reivindicar(limite: int, ambiente: str, somente: list[str] | None) -> list[dict]:
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            f"""UPDATE reuniao_agendamentos
                   SET visivel_em = now() + $2::interval, tentativas = tentativas + 1,
                       atualizado_em = now()
                 WHERE id IN (SELECT id FROM reuniao_agendamentos
                               WHERE status = 'reservada' AND visivel_em <= now()
                                 AND ambiente = $3
                                 AND ($4::uuid[] IS NULL OR id = ANY($4::uuid[]))
                                 AND ($4::uuid[] IS NOT NULL OR NOT ({AGENDAMENTO_DE_TESTE}))
                               ORDER BY visivel_em LIMIT $1
                               FOR UPDATE SKIP LOCKED)
             RETURNING *""",
            limite, PRAZO_DA_REIVINDICACAO, ambiente, somente)
    return [dict(l) for l in linhas]


async def _gravar(ag_id, **campos) -> None:
    sets = ", ".join(f"{c} = ${i}" for i, c in enumerate(campos, start=2))
    async with sessao(role="service_role") as conn:
        await conn.execute(
            f"UPDATE reuniao_agendamentos SET {sets}, atualizado_em = now() WHERE id = $1",
            ag_id, *campos.values())


async def _marcar_dado(ag_id, chave: str) -> None:
    async with sessao(role="service_role") as conn:
        await conn.execute(
            "UPDATE reuniao_agendamentos SET dados = dados || jsonb_build_object($2::text, true) "
            "WHERE id = $1", ag_id, chave)


async def _lead_e_origem(ag: dict) -> tuple[dict, dict | None, dict | None]:
    async with sessao(role="service_role") as conn:
        if ag.get("lead_id") is None:
            # A confirmação gravou a reserva mas não o lead (ver `reserva`).
            linha = await conn.fetchrow(
                "SELECT * FROM reuniao_agendamentos WHERE id = $1", ag["id"])
            lead_id = await reserva._registrar_lead(conn, linha, agendamento=True)
            await conn.execute(
                "UPDATE reuniao_agendamentos SET lead_id = $2::uuid WHERE id = $1",
                ag["id"], lead_id)
            ag["lead_id"] = lead_id
        lead = await conn.fetchrow(
            f"SELECT {entrega._COLUNAS_LEAD} FROM leads WHERE id = $1::uuid",
            str(ag["lead_id"]))
        if lead is None:
            raise _Falha("o contato foi excluído antes da criação da reunião")
        conversao, consentimento = await entrega.origem_do_card(conn, str(ag["lead_id"]))
        cfg_pagina = await reserva._config_da_pagina(conn, ag["page_slug"])
    ag["_meeting_kind"] = cfg_pagina.meeting_kind
    return dict(lead), conversao, consentimento


async def _card(ag: dict, lead, conversao, consentimento, cfg, cliente) -> int:
    if ag.get("card_existente_id") is not None:
        card_id = int(ag["card_existente_id"])
        if (await cliente.ler_card(card_id)).get("assigned_to_id") is None:
            await cliente.atribuir_vendedor(card_id, int(ag["vendedor_id"]))
        return card_id
    if ag["tentativas"] > 1:
        # Retry: o card que uma tentativa anterior criou (201 perdido) é
        # reconhecido pela assinatura — nunca o segundo card.
        for c in await cliente.cards_da_pessoa(int(ag["person_id"])):
            if not entrega._aberto(c):
                continue
            descricao = (await cliente.ler_card(int(c["id"]))).get("description")
            if growthhs.card_do_pedido(descricao, ag["id"]):
                return int(c["id"])
    corpo = growthhs.montar_card(lead, cfg, conversao=conversao, consentimento=consentimento,
                                 person_id=int(ag["person_id"]),
                                 frontend_url=settings.FRONTEND_URL, pedido_id=ag["id"])
    corpo["list_id"] = (cfg.listas_reuniao[0] if cfg.listas_reuniao
                        else LISTA_REUNIAO_PADRAO)
    corpo["assigned_to_id"] = int(ag["vendedor_id"])
    criado = await cliente.criar_card(corpo)
    if entrega._id_inteiro(criado.get("id")) is None:
        # Criou lá, sem id aqui: o retry acha pela assinatura.
        raise growthhs.ErroTransitorio("POST /cards sem id na resposta")
    return int(criado["id"])


def _nota(ag, lead, conversao, consentimento) -> list[str]:
    dia, hora = _quando(ag)
    duracao = int((ag["fim"] - ag["inicio"]).total_seconds() // 60)
    linhas = [f"Reunião agendada pelo lead: {dia} às {hora} (Brasília), {duracao} min."]
    linhas += growthhs.nota_de_abertura(lead, conversao=conversao, consentimento=consentimento,
                                        frontend_url=settings.FRONTEND_URL,
                                        quando=datetime.now(UTC))
    filiais = reserva.respostas(_dados(ag)).get("filiais")
    if filiais:
        linhas.append(f"Filiais: {filiais}")
    return linhas


async def _executar(ag: dict, cfg: growthhs.Config, cliente: growthhs.Cliente) -> str:
    lead, conversao, consentimento = await _lead_e_origem(ag)
    if ag.get("person_id") is None:
        ag["person_id"] = await cliente.achar_ou_criar_pessoa(lead)
        await _gravar(ag["id"], person_id=ag["person_id"])
    if ag.get("card_id") is None:
        ag["card_id"] = await _card(ag, lead, conversao, consentimento, cfg, cliente)
        await asyncio.shield(_gravar(ag["id"], card_id=ag["card_id"]))
    if not _dados(ag).get("nota_enviada"):
        await cliente.anotar(int(ag["card_id"]), _nota(ag, lead, conversao, consentimento))
        await asyncio.shield(_marcar_dado(ag["id"], "nota_enviada"))
    if ag.get("task_id") is None:
        nome = growthhs.uma_linha(lead.get("nome")) or ag["email"]
        empresa = growthhs.uma_linha(lead.get("empresa"))
        tarefa = await cliente.criar_tarefa({
            "card_id": int(ag["card_id"]),
            "title": f"Reunião: {nome}" + (f" — {empresa}" if empresa else ""),
            "task_type": "meeting", "meeting_kind": ag["_meeting_kind"],
            "assigned_to_id": int(ag["vendedor_id"]),
            "due_date": reserva.iso_z(ag["inicio"]),
            "duration_minutes": int((ag["fim"] - ag["inicio"]).total_seconds() // 60),
            "invited_emails": [ag["email"]]})
        if entrega._id_inteiro(tarefa.get("id")) is None:
            # Criou lá sem id aqui: re-tentar criaria a segunda tarefa.
            raise _Falha("o GrowthHS criou a tarefa da reunião sem devolver o id")
        ag["task_id"] = int(tarefa["id"])
        await asyncio.shield(_gravar(ag["id"], task_id=ag["task_id"]))
    if ag.get("public_link") is None:
        sala = await cliente.criar_sala(int(ag["task_id"]))
        ag["public_link"] = sala.get("public_link") or sala.get("room_url") or ""
        await asyncio.shield(_gravar(ag["id"], public_link=ag["public_link"]))
        if sala["convidados_removidos"] > 0:
            raise _Falha("convite cortado pelo GrowthHS (convidados_removidos="
                         f"{sala['convidados_removidos']}): o lead não recebeu o convite")
    if ag.get("email_vendedor_em") is None:
        await _email_ao_vendedor(ag, lead, cfg, cliente)
    await _gravar(ag["id"], status="criada", erro=None)
    return "criadas"


async def _email_ao_vendedor(ag, lead, cfg, cliente) -> None:
    destino = ag.get("vendedor_email")
    if not destino:
        for v in await cliente.vendedores():
            if v["id"] == int(ag["vendedor_id"]):
                destino = v["email"]
    if not destino:
        raise _Falha("reunião criada, mas o vendedor não tem e-mail no GrowthHS")
    chave, de, responder = await _remetente()
    if not chave:
        raise growthhs.ErroTransitorio("e-mail ao vendedor: Resend não configurado")
    assunto, corpo, texto = montar_email_vendedor(ag, lead, cfg.url_do_card(ag["card_id"]))
    try:
        await resend.enviar(chave=chave, de=de, para=destino, assunto=assunto, html=corpo,
                            texto=texto, cabecalhos={}, responder_para=responder)
    except Exception as erro:  # noqa: BLE001 — a re-tentativa só repete o e-mail
        raise growthhs.ErroTransitorio(
            f"e-mail ao vendedor não saiu ({type(erro).__name__})") from erro
    await asyncio.shield(_gravar(ag["id"], email_vendedor_em=datetime.now(UTC)))


async def _tratar(ag: dict, erro: Exception) -> str:
    transitorio = isinstance(erro, growthhs.ErroTransitorio) or (
        isinstance(erro, growthhs.ErroDefinitivo)
        and (erro.de_configuracao or erro.status in entrega.STATUS_DE_CONFIGURACAO))
    texto = str(erro)[:400] or type(erro).__name__
    if transitorio and ag["tentativas"] < entrega.MAX_TENTATIVAS:
        espera = entrega.espera_transitoria(ag["tentativas"])
        async with sessao(role="service_role") as conn:
            await conn.execute(
                """UPDATE reuniao_agendamentos SET visivel_em = now() + $2::interval,
                          erro = $3, atualizado_em = now() WHERE id = $1""",
                ag["id"], espera, texto)
        return "adiadas"
    await _gravar(ag["id"], status="falhou", erro=texto)
    await alertar_admins(ag, texto)
    return "falhas"


async def rodar_agendamentos(*, limite: int = 10, cfg: growthhs.Config | None = None,
                             transporte=None, parar: asyncio.Event | None = None,
                             somente: list[str] | None = None) -> dict:
    """Uma passada da fila. `somente` (ids) é para os testes."""
    contagem = {"criadas": 0, "adiadas": 0, "falhas": 0}
    cfg = cfg or await growthhs.ler_config()
    if not cfg.configurado:
        return {"desligado": True}
    if parar is not None and parar.is_set():
        return contagem
    linhas = await _reivindicar(limite, cfg.ambiente, somente)
    if not linhas:
        return contagem
    async with growthhs.Cliente(cfg, transporte=transporte) as cliente:
        for i, ag in enumerate(linhas):
            if parar is not None and parar.is_set():
                async with sessao(role="service_role") as conn:
                    await conn.execute(
                        "UPDATE reuniao_agendamentos SET visivel_em = now(), "
                        "tentativas = tentativas - 1 WHERE id = ANY($1::uuid[])",
                        [x["id"] for x in linhas[i:]])
                break
            try:
                contagem[await _executar(ag, cfg, cliente)] += 1
            except (growthhs.ErroTransitorio, growthhs.ErroDefinitivo, _Falha) as erro:
                contagem[await _tratar(ag, erro)] += 1
            except Exception as erro:  # noqa: BLE001 — defeito nosso: re-tenta
                logger.exception("[agendamento] reserva %s quebrou", ag["id"])
                contagem[await _tratar(ag, growthhs.ErroTransitorio(
                    f"defeito interno ({type(erro).__name__})"))] += 1
    return contagem


# ── Varredura ────────────────────────────────────────────────────────────────

async def varrer(agora: datetime, *, somente_paginas: list[str] | None = None) -> dict:
    """Rascunho parado há mais de 30 min vira lead comum (o lead desistiu no
    meio); se nem isso der, `abandonada`. Reunião criada/falhada que já
    passou vira `realizada` (sai dos índices únicos)."""
    resumo = {"lead_comum": 0, "abandonadas": 0, "realizadas": 0}
    filtro = ("page_slug = ANY($2::text[])" if somente_paginas is not None
              else f"NOT ({AGENDAMENTO_DE_TESTE}) AND $2::text[] IS NULL")
    async with sessao(role="service_role") as conn:
        tokens = [r["token"] for r in await conn.fetch(
            f"""SELECT token FROM reuniao_agendamentos
                 WHERE status = 'rascunho' AND criado_em < $1 AND {filtro}
                 ORDER BY criado_em LIMIT 100""", agora - ABANDONO, somente_paginas)]
        resumo["realizadas"] = int((await conn.execute(
            f"""UPDATE reuniao_agendamentos SET status = 'realizada', atualizado_em = now()
                 WHERE status IN ('criada', 'falhou') AND fim < $1 AND {filtro}""",
            agora, somente_paginas)).split()[-1])
    for token in tokens:
        try:
            await reserva.virar_lead_comum(token)
            resumo["lead_comum"] += 1
        except Exception:  # noqa: BLE001
            async with sessao(role="service_role") as conn:
                ag_id = await conn.fetchval(
                    """UPDATE reuniao_agendamentos SET status = 'abandonada',
                              atualizado_em = now()
                        WHERE token = $1 AND status = 'rascunho' RETURNING id""", token)
            logger.exception("[agendamento] rascunho %s abandonado", ag_id)
            resumo["abandonadas"] += 1
    return resumo
