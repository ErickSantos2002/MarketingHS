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
    4. tarefa `meeting` com o lead convidado, assinada em `notes`
       `Pedido MarketingHS: <id>`; `dados.tarefa_pedida` ANTES do POST, e o
       retry com a marca procura nas reuniões do card (M4)  → task_id
    5. sala de vídeo (evento no Outlook do vendedor); `dados.sala_pedida`
       ANTES do POST, e o retry lê a tarefa: sala + evento = pronta (M4)
                                                          → public_link
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
from app.agendamento.config import definicoes_so_do_agendamento, ler_config
from app.captura.campos import ler_definicoes
from app.captura.informados import CAMPOS_INFORMADOS
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
# O menor `abandono_min` que a config aceita (app/agendamento/config.py).
ABANDONO_MINIMO = timedelta(minutes=5)
PRAZO_DA_REIVINDICACAO = timedelta(minutes=10)
AGENDAMENTO_DE_TESTE = "lower(email) LIKE '%@exemplo.invalid'"
DIAS_DA_SEMANA = ("segunda-feira", "terça-feira", "quarta-feira", "quinta-feira",
                  "sexta-feira", "sábado", "domingo")


class _Falha(Exception):
    """Definitivo daqui (não do HTTP): falha a reserva e alerta."""


def _dados(ag) -> dict:
    return reserva._dados(ag["dados"])


# O que a nota de abertura e o e-mail ao vendedor já mostram por nome (ou que
# não é resposta do lead): não vai de novo como resposta avulsa.
CHAVES_DE_CONTROLE = frozenset({
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "source", "ab_test", "ab_var", "ab_vid", "tipo", "status"})
CHAVES_JA_MOSTRADAS = CHAVES_DE_CONTROLE | {
    "nome", "empresa", "cargo", "email", "whatsapp", "funcionarios", "filiais"}


def rotulos_dos_campos(config) -> dict[str, str]:
    """chave -> rótulo dos campos da página (`ler_definicoes`). Ajuste da
    homologação (28/10): o vendedor lia `testes_por_dia` em vez da pergunta.
    Inclui as perguntas só do modal (`agendamento.campos`, 29/10); chave
    repetida fica com o rótulo da página."""
    config = reserva._dados(config)
    rotulos = {d.chave: d.rotulo for d in definicoes_so_do_agendamento(config) if d.rotulo}
    rotulos.update({d.chave: d.rotulo for d in ler_definicoes(config) if d.rotulo})
    return rotulos


def _rotulo(chave: str, rotulos: dict[str, str] | None) -> str:
    return (rotulos or {}).get(chave) or chave


def _trocar_chaves(respostas, rotulos: dict[str, str] | None):
    """As respostas com o rótulo no lugar da chave. Rótulo que dois campos
    dividem, ou que é a chave de outro campo, fica na chave: duas respostas
    não podem virar uma."""
    if not isinstance(respostas, dict):
        return respostas
    rotulos = rotulos or {}
    valores = list(rotulos.values())
    mapa = {c: r for c, r in rotulos.items() if valores.count(r) == 1 and r not in rotulos}
    return {mapa.get(chave, chave): valor for chave, valor in respostas.items()}


def _quando(ag) -> tuple[str, str]:
    inicio = ag["inicio"].astimezone(FUSO)
    return inicio.strftime("%d/%m/%Y"), inicio.strftime("%H:%M")


# ── E-mails ──────────────────────────────────────────────────────────────────

def montar_email_vendedor(ag: dict, lead: dict, url_card: str | None, *,
                          rotulos: dict[str, str] | None = None) -> tuple[str, str, str]:
    """(assunto, html, texto) do aviso ao vendedor. Tudo que veio do
    formulário público passa por `html.escape` (e por `uma_linha`). As
    respostas avulsas saem com o rótulo do campo na página (`rotulos`),
    a chave só quando a página não define o campo."""
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
    for chave, valor in respostas.items():
        if chave not in CHAVES_JA_MOSTRADAS and linha(valor):
            itens.append((linha(_rotulo(chave, rotulos)), linha(valor)))
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


async def alertar_admins(ag: dict, motivo: str, *, aviso: bool = False) -> None:
    """E-mail a todo admin: a reunião que o lead acha confirmada não ficou
    pronta. Uma vez só por reserva (`alerta_em`).

    `aviso=True` (card de outro vendedor, C1): a reunião FICOU pronta, mas
    alguém precisa olhar — não grava `alerta_em` (o alerta de falha, se vier
    depois, ainda sai); quem chama garante o "uma vez"."""
    if not aviso and ag.get("alerta_em") is not None:
        return
    async with sessao(role="service_role") as conn:
        if not aviso and await conn.fetchval(
                "SELECT alerta_em FROM reuniao_agendamentos WHERE id = $1", ag["id"]):
            return
        admins = [r["email"] for r in await conn.fetch(
            """SELECT DISTINCT u.email FROM public.user_roles r
                 JOIN auth.users u ON u.id = r.user_id
                WHERE r.role = 'admin' AND u.email IS NOT NULL""")]
    chave, de, responder = await _remetente()
    dia, hora = _quando(ag)
    if not chave or not admins:
        # M5: sem e-mail, o log é o único rastro — nível de erro e um texto
        # fixo para achar (`ALERTA NÃO ENVIADO`). `alerta_em` fica vazio: a
        # fila (reservada) ou a varredura (falhou) tenta de novo.
        logger.error("[agendamento] ALERTA NÃO ENVIADO (%s) — reserva %s, %s %s, página %s, "
                     "vendedor %s: %s",
                     "Resend sem RESEND_API_KEY" if not chave else "nenhum admin com e-mail",
                     ag["id"], dia, hora, ag.get("page_slug"), ag.get("vendedor_id"), motivo)
        return
    e = html.escape
    linha = growthhs.uma_linha
    itens = [("Motivo", linha(motivo)), ("Lead", linha(ag.get("email"))),
             ("Horário", f"{dia} às {hora} (Brasília)"),
             ("Vendedor", linha(ag.get("vendedor_nome") or ag.get("vendedor_id"))),
             ("Página", linha(ag.get("page_slug"))),
             ("Card no GrowthHS", linha(ag.get("card_id") or "não criado"))]
    abertura = ("<p>Uma reunião agendada pela landing caiu num card de "
                "<strong>outro vendedor</strong>. A reunião foi criada; confira no "
                "GrowthHS quem atende o lead.</p><ul>" if aviso else
                "<p>Uma reunião agendada pela landing <strong>não ficou pronta</strong>. "
                "O lead viu \"confirmado\" e o horário segue reservado para o vendedor — "
                "confira no GrowthHS e fale com o lead.</p><ul>")
    corpo = (abertura
             + "".join(f"<li>{e(r)}: {e(str(v))}</li>" for r, v in itens) + "</ul>")
    enviados = 0
    for email in admins:
        try:
            await resend.enviar(chave=chave, de=de, para=email,
                                assunto=(f"[MarketingHS] Agendamento com aviso — {dia} {hora}"
                                         if aviso else
                                         f"[MarketingHS] Agendamento com falha — {dia} {hora}"),
                                html=corpo, texto=html_para_texto(corpo), cabecalhos={},
                                responder_para=responder)
            enviados += 1
        except Exception:  # noqa: BLE001 — o alerta tenta os outros admins
            logger.exception("[agendamento] alerta da reserva %s não saiu", ag["id"])
    if aviso:
        return
    if not enviados:
        # M5: o Resend recusou para todos — ninguém soube. Sem `alerta_em`, a
        # próxima passada (ou a varredura) tenta de novo.
        logger.error("[agendamento] ALERTA NÃO ENVIADO (Resend falhou para todos os admins) "
                     "— reserva %s, %s %s: %s", ag["id"], dia, hora, motivo)
        return
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


async def _gravar_dado(ag: dict, chave: str, valor: str) -> None:
    """Um texto em `dados` (o passo seguinte lê, mesmo depois de um retry)."""
    async with sessao(role="service_role") as conn:
        await conn.execute(
            "UPDATE reuniao_agendamentos SET dados = dados || jsonb_build_object($2::text, $3::text) "
            "WHERE id = $1", ag["id"], chave, valor)
    ag["dados"] = {**_dados(ag), chave: valor}


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
        config_bruta = await conn.fetchval(
            "SELECT config FROM pages WHERE slug = $1", ag["page_slug"])
    ag["_meeting_kind"] = cfg_pagina.meeting_kind
    ag["_rotulos"] = rotulos_dos_campos(config_bruta)
    return dict(lead), conversao, consentimento


async def _ler_aberto(cliente, card_id: int) -> dict | None:
    """O card, se ainda existe e está aberto (M7: o card visto na etapa 3 pode
    ter sido ganho, perdido ou apagado até a execução)."""
    try:
        card = await cliente.ler_card(card_id)
    except growthhs.ErroDefinitivo as erro:
        if erro.status == 404:
            return None
        raise
    if card.get("is_won") or card.get("is_lost"):
        return None
    return {**card, "id": card.get("id", card_id)}


async def _nome_do_vendedor(cliente, user_id: int) -> str:
    try:
        for v in await cliente.vendedores():
            if v["id"] == int(user_id):
                return v["nome"] or f"vendedor #{user_id}"
    except (growthhs.ErroTransitorio, growthhs.ErroDefinitivo):
        pass
    return f"vendedor #{user_id}"


async def _usar_card(ag: dict, card: dict, cliente) -> int:
    """Usa um card aberto que já existe. Sem vendedor, ganha o da reserva.
    De OUTRO vendedor (C1): o dono não muda — a reunião fica com o vendedor
    da reserva, que é quem está livre e bloqueado no Outlook —, a nota diz
    isso e os admins são avisados (em `_executar`)."""
    card_id = int(card["id"])
    dono = card.get("assigned_to_id")
    if dono is None:
        await cliente.atribuir_vendedor(card_id, int(ag["vendedor_id"]))
    elif int(dono) != int(ag["vendedor_id"]):
        da_reserva = ag.get("vendedor_nome") or await _nome_do_vendedor(cliente, ag["vendedor_id"])
        do_card = await _nome_do_vendedor(cliente, int(dono))
        aviso = (f"Reunião agendada pelo lead com {growthhs.uma_linha(da_reserva)}; "
                 f"o card é de {growthhs.uma_linha(do_card)}.")
        await _gravar_dado(ag, "aviso_dono", aviso)
    return card_id


async def _card(ag: dict, lead, conversao, consentimento, cfg, cliente) -> int:
    if ag.get("card_existente_id") is not None:
        card = await _ler_aberto(cliente, int(ag["card_existente_id"]))
        if card is not None:
            return await _usar_card(ag, card, cliente)
    # Os cards abertos da pessoa AGORA. O retry de um 201 perdido acha o
    # nosso pela assinatura; e (C1) um card aberto que outro handoff criou
    # depois da reserva — a jornada da captura normal, uma regra — é usado
    # em vez de nascer o segundo card.
    abertos = []
    for c in await cliente.cards_da_pessoa(int(ag["person_id"])):
        if not entrega._aberto(c):
            continue
        lido = await _ler_aberto(cliente, int(c["id"]))
        if lido is None:
            continue
        if growthhs.card_do_pedido(lido.get("description"), ag["id"]):
            return int(lido["id"])
        abertos.append((growthhs.criado_em_utc(c), int(c["id"]), lido))
    if abertos:
        minimo = datetime.min.replace(tzinfo=UTC)
        _, _, mais_novo = max(abertos, key=lambda t: (t[0] or minimo, t[1]))
        return await _usar_card(ag, mais_novo, cliente)
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
    aviso = _dados(ag).get("aviso_dono")
    if aviso:
        linhas.append(aviso)
    rotulos = ag.get("_rotulos")
    extras = dict(lead.get("campos_extras") or {})
    # A nota padrão com o rótulo do campo, não a chave (ajuste da
    # homologação, 28/10) — nas "Respostas do formulário" e no "Informou
    # nesta conversão", que compara as duas pelo MESMO nome.
    lead_rotulado = {**lead, "campos_extras": _trocar_chaves(extras, rotulos)}
    if conversao and isinstance(conversao.get("dados_informados"), dict):
        informados = conversao["dados_informados"]
        conversao = {**conversao, "dados_informados": {
            **informados, "campos_extras": _trocar_chaves(informados.get("campos_extras"),
                                                          rotulos)}}
    linhas += growthhs.nota_de_abertura(lead_rotulado,
                                        conversao=conversao, consentimento=consentimento,
                                        frontend_url=settings.FRONTEND_URL,
                                        quando=datetime.now(UTC))
    # Só o que a nota padrão ainda não mostra: a resposta desta reserva que
    # não chegou a `campos_extras` (antes, "Filiais" saía aqui DE NOVO).
    for chave, valor in reserva.respostas(_dados(ag)).items():
        texto = growthhs.uma_linha(valor)
        if (chave in CHAVES_DE_CONTROLE or chave in CAMPOS_INFORMADOS or chave == "email"
                or chave in extras or not texto):
            continue
        linhas.append(f"- {growthhs.uma_linha(_rotulo(chave, rotulos))}: {texto}")
    return linhas


class _Passou(_Falha):
    """A reunião chegou (ou passou) sem ficar pronta: nada mais é criado."""


MOTIVO_PASSOU = "reunião não pôde ser criada antes do horário"
# A partir daqui (ou na 2ª falha seguida) os admins são avisados (I2).
AVISAR_ANTES = timedelta(hours=3)
MAX_TITULO_TAREFA = 255


LINHA_DA_TAREFA = "Reunião agendada pelo lead na landing (MarketingHS)."


def _corpo_da_tarefa(ag: dict, lead: dict) -> dict:
    nome = growthhs._cortar(lead.get("nome"), growthhs.MAX_NOME_PESSOA) or ag["email"]
    empresa = growthhs.uma_linha(lead.get("empresa"))
    titulo = (f"Reunião: {nome}" + (f" — {empresa}" if empresa else ""))[:MAX_TITULO_TAREFA]
    return {
        "card_id": int(ag["card_id"]),
        "title": titulo,
        "task_type": "meeting", "meeting_kind": ag["_meeting_kind"],
        "assigned_to_id": int(ag["vendedor_id"]),
        "due_date": reserva.iso_z(ag["inicio"]),
        "duration_minutes": int((ag["fim"] - ag["inicio"]).total_seconds() // 60),
        "invited_emails": [ag["email"]],
        # M4: a marca vai em `notes`, NUNCA em `description` — lá a
        # `description` é a "Pauta" do convite que o lead recebe; `notes` só
        # aparece no CRM.
        "notes": f"{LINHA_DA_TAREFA}\n{growthhs.marca_de_criacao(ag['id'])}"}


async def _tarefa_do_pedido(ag: dict, cliente) -> int | None:
    """A tarefa desta reserva, se já existe no card (marca exata, numa linha
    própria de `notes` — `card_do_pedido`)."""
    for t in await cliente.reunioes_do_card(int(ag["card_id"])):
        if growthhs.card_do_pedido(t.get("notes"), ag["id"]):
            achada = entrega._id_inteiro(t.get("id"))
            if achada is not None:
                logger.info("[agendamento] reserva %s: tarefa %s já existia (resposta perdida)",
                            ag["id"], achada)
                return achada
    return None


async def _sala_ja_criada(ag: dict, cfg: growthhs.Config, cliente) -> dict | None:
    """M4: a sala de uma tentativa anterior, lida da tarefa. A rota de lá
    (`POST /card-tasks/{id}/daily-room`) cria a sala, DEPOIS o evento no
    Outlook, e desfaz a sala se o evento falhar. Então:

    - nem sala → a anterior não ficou: `None`, pede de novo;
    - sala e evento → pronta: o link público é `<app_url>/entrar/<token>`,
      o mesmo que a rota devolve;
    - sala sem evento → a anterior ainda está rodando (ou caiu no meio):
      transitório, sem pedir outra — o Daily recusaria o nome repetido.

    ⚠️ O `convidados_removidos` não fica gravado lá: na sala recuperada ele
    é 0 por falta de como saber (pedido ao GrowthHS, 29/10)."""
    tarefa = await cliente.ler_tarefa(int(ag["task_id"]))
    url, token = tarefa.get("daily_room_url"), tarefa.get("public_access_token")
    if not url:
        return None
    if not tarefa.get("teams_event_id"):
        raise growthhs.ErroTransitorio(
            "sala de vídeo criada sem o convite no Outlook (ainda): confira a tarefa "
            f"{ag['task_id']} no GrowthHS")
    link = f"{cfg.app_url.rstrip('/')}/entrar/{token}" if cfg.app_url and token else ""
    logger.info("[agendamento] reserva %s: sala da tarefa %s já existia (resposta perdida)",
                ag["id"], ag["task_id"])
    return {"room_url": url, "public_link": link, "public_access_token": token,
            "convidados_removidos": 0}


async def _executar(ag: dict, cfg: growthhs.Config, cliente: growthhs.Cliente) -> str:
    if ag["inicio"] <= datetime.now(UTC):
        # I2: nem card, nem convite, nem e-mail para uma reunião que já
        # começou — o lead não estaria lá.
        raise _Passou(MOTIVO_PASSOU)
    lead, conversao, consentimento = await _lead_e_origem(ag)
    if ag.get("person_id") is None:
        ag["person_id"] = await cliente.achar_ou_criar_pessoa(lead)
        await _gravar(ag["id"], person_id=ag["person_id"])
    if ag.get("card_id") is None:
        ag["card_id"] = await _card(ag, lead, conversao, consentimento, cfg, cliente)
        await asyncio.shield(_gravar(ag["id"], card_id=ag["card_id"]))
    aviso = _dados(ag).get("aviso_dono")
    if aviso and not _dados(ag).get("aviso_dono_enviado"):
        await alertar_admins(ag, aviso, aviso=True)
        await _marcar_dado(ag["id"], "aviso_dono_enviado")
    if not _dados(ag).get("nota_enviada"):
        await cliente.anotar(int(ag["card_id"]), _nota(ag, lead, conversao, consentimento))
        await asyncio.shield(_marcar_dado(ag["id"], "nota_enviada"))
    if ag.get("task_id") is None:
        task_id = None
        if _dados(ag).get("tarefa_pedida"):
            # M4: uma tentativa anterior pediu a tarefa — a resposta pode ter
            # se perdido com a tarefa criada lá.
            task_id = await _tarefa_do_pedido(ag, cliente)
        if task_id is None:
            await asyncio.shield(_marcar_dado(ag["id"], "tarefa_pedida"))
            tarefa = await cliente.criar_tarefa(_corpo_da_tarefa(ag, lead))
            task_id = entrega._id_inteiro(tarefa.get("id"))
            if task_id is None:
                # Criou lá sem id aqui: o retry acha pela marca em `notes`.
                raise growthhs.ErroTransitorio(
                    "o GrowthHS criou a tarefa da reunião sem devolver o id")
        ag["task_id"] = int(task_id)
        await asyncio.shield(_gravar(ag["id"], task_id=ag["task_id"]))
    if ag.get("public_link") is None:
        sala = None
        if _dados(ag).get("sala_pedida"):
            sala = await _sala_ja_criada(ag, cfg, cliente)
        if sala is None:
            await asyncio.shield(_marcar_dado(ag["id"], "sala_pedida"))
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
    assunto, corpo, texto = montar_email_vendedor(ag, lead, cfg.url_do_card(ag["card_id"]),
                                                  rotulos=ag.get("_rotulos"))
    try:
        await resend.enviar(chave=chave, de=de, para=destino, assunto=assunto, html=corpo,
                            texto=texto, cabecalhos={}, responder_para=responder)
    except Exception as erro:  # noqa: BLE001 — a re-tentativa só repete o e-mail
        raise growthhs.ErroTransitorio(
            f"e-mail ao vendedor não saiu ({type(erro).__name__})") from erro
    await asyncio.shield(_gravar(ag["id"], email_vendedor_em=datetime.now(UTC)))


async def _tratar(ag: dict, erro: Exception) -> str:
    """Transitório: re-tenta com espera crescente ENQUANTO a reunião não
    chegou (I2). Os admins são avisados (uma vez, `alerta_em`) na 2ª falha
    seguida ou quando faltam menos de 3 h. Definitivo, ou a reunião chegou:
    `falhou` (o horário segue bloqueado) e alerta."""
    transitorio = isinstance(erro, growthhs.ErroTransitorio) or (
        isinstance(erro, growthhs.ErroDefinitivo)
        and (erro.de_configuracao or erro.status in entrega.STATUS_DE_CONFIGURACAO))
    texto = str(erro)[:400] or type(erro).__name__
    agora = datetime.now(UTC)
    if transitorio and ag["inicio"] > agora:
        espera = entrega.espera_transitoria(ag["tentativas"])
        async with sessao(role="service_role") as conn:
            await conn.execute(
                """UPDATE reuniao_agendamentos SET visivel_em = now() + $2::interval,
                          erro = $3, atualizado_em = now() WHERE id = $1""",
                ag["id"], espera, texto)
        if ag["tentativas"] >= 2 or ag["inicio"] - agora < AVISAR_ANTES:
            await alertar_admins(ag, f"ainda tentando criar a reunião: {texto}")
        return "adiadas"
    if transitorio:
        texto = f"{MOTIVO_PASSOU} (último erro: {texto})"
    await _gravar(ag["id"], status="falhou", erro=texto[:400])
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


# ── Painel ───────────────────────────────────────────────────────────────────

async def pendencias(*, somente_paginas: list[str] | None = None) -> dict:
    """M5: as reuniões que o lead acha confirmadas e não ficaram prontas, para
    o painel (o card do GrowthHS em Configurações já mostra a fila de
    entrega; este é o par dele). `falhou` cuja reunião não passou há mais de
    7 dias; `sem_alerta` = nem o e-mail aos admins saiu. Nunca o token nem o
    e-mail do lead (a faixa da fila, ao lado, também não mostra dado pessoal)."""
    filtro = ("page_slug = ANY($1::text[])" if somente_paginas is not None
              else f"NOT ({AGENDAMENTO_DE_TESTE}) AND $1::text[] IS NULL")
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            f"""SELECT id::text, page_slug, inicio, vendedor_id, vendedor_nome, card_id,
                       erro, alerta_em, atualizado_em
                  FROM reuniao_agendamentos
                 WHERE status = 'falhou' AND fim > now() - interval '7 days' AND {filtro}
                 ORDER BY atualizado_em DESC""",
            somente_paginas)
    return {"falhas": len(linhas),
            "sem_alerta": sum(1 for l in linhas if l["alerta_em"] is None),
            "ultimas": [{**dict(l), "inicio": l["inicio"].isoformat(),
                         "alerta_em": l["alerta_em"] and l["alerta_em"].isoformat(),
                         "atualizado_em": l["atualizado_em"].isoformat()}
                        for l in linhas[:5]]}


# ── Varredura ────────────────────────────────────────────────────────────────

async def varrer(agora: datetime, *, somente_paginas: list[str] | None = None) -> dict:
    """Rascunho parado há mais de `abandono_min` (30) vira lead comum (o lead desistiu no
    meio); se nem isso der, `abandonada`. Reunião criada/falhada que já
    passou vira `realizada` (sai dos índices únicos)."""
    resumo = {"lead_comum": 0, "abandonadas": 0, "realizadas": 0, "alertas": 0}
    filtro = ("page_slug = ANY($2::text[])" if somente_paginas is not None
              else f"NOT ({AGENDAMENTO_DE_TESTE}) AND $2::text[] IS NULL")
    async with sessao(role="service_role") as conn:
        # M5: `falhou` sem `alerta_em` = o alerta não saiu (Resend sem chave
        # ou fora). A fila não volta a ela; daqui sai assim que o Resend
        # estiver de pé. ANTES do `realizada` abaixo: a reunião que já passou
        # também precisa do alerta (o lead ficou esperando).
        sem_alerta = [dict(l) for l in await conn.fetch(
            f"""SELECT * FROM reuniao_agendamentos
                 WHERE status = 'falhou' AND alerta_em IS NULL
                   AND fim > $1::timestamptz - interval '7 days' AND {filtro}
                 ORDER BY inicio LIMIT 20""",
            agora, somente_paginas)]
    for ag in sem_alerta:
        await alertar_admins(ag, ag.get("erro") or "falha sem motivo registrado")
        async with sessao(role="service_role") as conn:
            if await conn.fetchval(
                    "SELECT alerta_em IS NOT NULL FROM reuniao_agendamentos WHERE id = $1",
                    ag["id"]):
                resumo["alertas"] += 1
    async with sessao(role="service_role") as conn:
        # M1: o relógio é a ÚLTIMA mexida do lead (`atualizado_em` — toda
        # chamada pública do token o toca), não a criação: quem está na etapa
        # 3 escolhendo dia não é desistente. O corte é o `abandono_min` da
        # página (padrão 30); `ABANDONO_MINIMO` só poda a busca.
        parados = await conn.fetch(
            f"""SELECT token, atualizado_em,
                       (SELECT p.config FROM pages p
                         WHERE p.slug = reuniao_agendamentos.page_slug) AS config
                  FROM reuniao_agendamentos
                 WHERE status = 'rascunho' AND atualizado_em < $1 AND {filtro}
                 ORDER BY atualizado_em LIMIT 100""",
            agora - ABANDONO_MINIMO, somente_paginas)
        tokens = [r["token"] for r in parados
                  if r["atualizado_em"] < agora - timedelta(
                      minutes=ler_config(reserva._dados(r["config"])).abandono_min)]
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
