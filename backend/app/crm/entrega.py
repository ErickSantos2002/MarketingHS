"""A fila de entrega ao GrowthHS — o que era o handoff-to-nexus, sem o Nexus.

Três caminhos enfileiram (a regra de automação pelo gatilho do banco, o nó de
jornada, o botão manual) e o worker drena. Um caminho de entrega, uma política
de re-tentativa, um lugar para ver falha (`GET /config/growthhs`).

Desde 22/10 a entrega fala com a API NORMAL do GrowthHS (spec
`2026-10-22-growthhs-real-design.md` §3; autoridade:
`hsgrowth-sistema/docs/integracao-marketinghs.md`), por pedido:

    achar/criar a pessoa → cards dela nos boards conferidos →
      card aberto criado DEPOIS do pedido → é o nosso: entregue, nada mais
      outro card aberto → atualiza a descrição (bloco no fim) + nota
      nenhum aberto (inclusive só ganhos/perdidos) → cria

⚠️ A rede nunca roda dentro de transação: reivindica (sessão curta, com prazo
escalado ao tamanho do lote — ver `_reivindicar`), chama, grava o resultado
(outra sessão curta). Se o worker morrer entre a chamada e a gravação, o
pedido volta depois do prazo e é tentado de novo.

⚠️ O `POST /cards` de lá NÃO é idempotente (§6 de lá: não há `external_id`).
A defesa é toda daqui, e é a ordem acima: o retry depois de um 201 que se
perdeu acha o card aberto mais novo que `crm_handoffs.criado_em` e o
reconhece em vez de criar outro; o retry depois de um PUT que se perdeu acha
a marca `(pedido N)` no cabeçalho do bloco e não empilha o segundo.

⚠️ A guarda local antiga (`_ja_entregue`: lead já entregue não era mandado
de novo, e o `person_id` guardado era reusado) SAIU de propósito (spec §3):
o card anotado aqui pode ter sido ganho ou perdido lá, e o lead que converte
de novo precisa chegar ao vendedor. E nenhum `person_id` guardado é reusado
sem buscar — os do receptor de teste eram inventados e podem colidir com
pessoas reais do CRM.

⚠️ Revisão final do 8D (I3): 401/403/404 são configuração (credencial,
endereço ou lista errados), a mesma para todos os pedidos. Em vez de falhar a
fila inteira de uma vez, a fila PAUSA: o pedido volta a pendente daqui a
`ESPERA_DA_PAUSA`, a tentativa não conta, e o ciclo para. O estado aparece em
`GET /config/growthhs` (`fila.pausada`). Outro 4xx (400, 422) falha o pedido
— é o dado daquele lead (ex.: e-mail que lá só existe em `email_alternative`,
que a busca não acha e o `POST /persons` recusa com 400).

⚠️ Round 1 de revisão (achado I1): um 2xx do `POST /cards` ou do PUT JÁ mudou
o lado de lá — dali em diante NUNCA se re-tenta por defeito de registro
(gravar identidade, linha do tempo). Por isso o sucesso grava em DUAS
sessões: a primeira marca `entregue` sozinha, blindada; a segunda
(identidade + evento) só loga se falhar, nunca desfaz a primeira.
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from app.config import settings
from app.crm import growthhs
from app.database import sessao
from app.jornadas import modo_teste

logger = logging.getLogger(__name__)

# Revisão final do 8D (I3): com 6 tentativas a fila desistia em ~31 min — um
# GrowthHS fora do ar numa noite derrubava todos os pedidos. A espera dobra
# até `ESPERA_MAXIMA` (1, 2, 4, 8, 16, 32, 60, 60, ... min) e 30 tentativas
# somam pouco mais de 24 h.
MAX_TENTATIVAS = 30
ESPERA_BASE = timedelta(minutes=1)
ESPERA_MAXIMA = timedelta(minutes=60)
PRAZO_MINIMO_DA_REIVINDICACAO = timedelta(minutes=5)
# A pausa de configuração (I3): quanto a fila espera antes de tentar de novo
# com a credencial/endereço que o GrowthHS recusou.
STATUS_DE_CONFIGURACAO = frozenset({401, 403, 404})
ESPERA_DA_PAUSA = timedelta(minutes=10)
# `erro` de um pedido pausado começa com isto — é por este prefixo que
# `GET /config/growthhs` deriva `fila.pausada`.
PREFIXO_PAUSA = "Pausa de configuração"
MOTIVO_MOVER = ("O GrowthHS ainda não tem rota para mover card de etapa — "
                "pedido registrado no contrato (docs/contratos/"
                "2026-09-02-endpoint-card-comercial-growthhs.md).")
# Um pedido custa várias chamadas agora (token, pessoa, cards de cada board,
# card, PUT, nota) — o prazo da reivindicação conta com isso.
CHAMADAS_POR_PEDIDO = 6

_COLUNAS_LEAD = """id::text AS id, nome, email, whatsapp, phone_normalized, empresa,
    cargo, faturamento, funcionarios, desafios, indicacao, utm_source, utm_medium,
    utm_campaign, utm_term, utm_content, lead_score, etiqueta,
    dnia_id::text AS dnia_id, deleted_at, campos_extras"""


async def origem_do_card(conn, lead_id: str) -> tuple[dict | None, dict | None]:
    """(última conversão, último consentimento) do lead, para o card (prova
    do RD). `converted_at`/`criado_em` em ISO 8601, como o resto do corpo.

    `gclid` (API normal do GrowthHS, 22/10): o da visita MAIS RECENTE com
    gclid do mesmo `visitor_id` da conversão. ⚠️ "Com gclid" importa: a
    última visita costuma ser a volta direta, sem clique pago — pegar a
    última de todas apagaria a atribuição do anúncio. Conversão sem
    visitante (envio manual, base importada) → `None`. Visita DEPOIS da
    conversão não conta: não foi o clique que trouxe o lead."""
    conversao = await conn.fetchrow(
        """SELECT lc.page_slug, lc.form_id, s.nome AS site_nome, lc.page_url,
                  to_char(lc.converted_at AT TIME ZONE 'UTC',
                          'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS converted_at, lc.canal,
                  (SELECT v.gclid FROM visitas v
                    WHERE lc.visitor_id IS NOT NULL AND v.visitor_id = lc.visitor_id
                      AND v.gclid IS NOT NULL AND v.criado_em <= lc.converted_at
                    ORDER BY v.criado_em DESC LIMIT 1) AS gclid
             FROM lead_conversions lc LEFT JOIN sites s ON s.id = lc.site_id
            WHERE lc.lead_id = $1::uuid
            ORDER BY lc.converted_at DESC LIMIT 1""", lead_id)
    consentimento = await conn.fetchrow(
        """SELECT base_legal, versao, provisoria,
                  to_char(criado_em AT TIME ZONE 'UTC',
                          'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS criado_em
             FROM lead_consents WHERE lead_id = $1::uuid
            ORDER BY criado_em DESC LIMIT 1""", lead_id)
    return (dict(conversao) if conversao else None,
            dict(consentimento) if consentimento else None)


def espera_transitoria(tentativas: int) -> timedelta:
    """Quanto esperar depois da `tentativas`-ésima falha transitória."""
    return min(ESPERA_BASE * (2 ** max(tentativas - 1, 0)), ESPERA_MAXIMA)


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


async def _reivindicar(limite: int, somente_lead: list[str] | None) -> list[dict]:
    """O prazo da reivindicação escala com o tamanho do lote (achado I2 do
    round 1): um lote de 20 pedidos, cada um com várias chamadas de até
    `TIMEOUT` segundos mais alguns segundos de escrita, não pode expirar
    antes do worker terminar de processá-lo — senão o pedido é reivindicado
    de novo NO MEIO do processamento do primeiro worker, e dois pedirem o
    mesmo card. `× 2` é folga; o piso de 5 min cobre o caso comum de lote
    pequeno.

    Devolve `criado_em` do pedido: é contra ele que a entrega reconhece o
    card que uma tentativa anterior deste pedido criou (ver `_escolher`)."""
    prazo = max(PRAZO_MINIMO_DA_REIVINDICACAO,
               timedelta(seconds=(growthhs.TIMEOUT * CHAMADAS_POR_PEDIDO + 5) * 2 * limite))
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            """UPDATE crm_handoffs SET visivel_em = now() + $2::interval,
                      tentativas = tentativas + 1, atualizado_em = now()
                WHERE id IN (SELECT id FROM crm_handoffs
                              WHERE status = 'pendente' AND visivel_em <= now()
                                AND ($3::uuid[] IS NULL OR lead_id = ANY($3::uuid[]))
                              ORDER BY visivel_em LIMIT $1
                              FOR UPDATE SKIP LOCKED)
            RETURNING id, lead_id::text AS lead_id, acao, origem, rule_id::text AS rule_id,
                      journey_run_id::text AS journey_run_id, tentativas, criado_em""",
            limite, prazo, somente_lead)
    return [dict(l) for l in linhas]


async def _registrar_evento(conn, lead: dict, tipo: str, titulo: str, metadata: dict) -> None:
    await conn.execute(
        """INSERT INTO contact_events (dnia_id, lead_id, source_app, event_type, title, metadata)
           VALUES ($1::uuid, $2::uuid, 'marketinghs', $3, $4, $5::jsonb)""",
        lead.get("dnia_id"), lead["id"], tipo, titulo, metadata)


async def _devolver(pedidos: list[dict], espera: timedelta, erro: str | None = None) -> None:
    """Devolve à fila pedidos reivindicados e NÃO tentados (ou pausados): a
    reivindicação somou uma tentativa que não aconteceu — desfaz. Com `erro`
    (a pausa), grava o motivo; `atualizado_em` só anda se o pedido ainda não
    estava pausado, para `fila.pausada.desde` dizer desde quando."""
    if not pedidos:
        return
    async with sessao(role="service_role") as conn:
        await conn.execute(
            """UPDATE crm_handoffs
                  SET visivel_em = now() + $2::interval,
                      tentativas = greatest(tentativas - 1, 0),
                      erro = coalesce($3, erro),
                      atualizado_em = CASE WHEN $3::text IS NOT NULL
                                            AND erro LIKE $4 || '%' THEN atualizado_em
                                           ELSE now() END
                WHERE id = ANY($1::bigint[]) AND status = 'pendente'""",
            [p["id"] for p in pedidos], espera, erro[:1000] if erro else None, PREFIXO_PAUSA)


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


async def _adiar(pedido: dict, erro: Exception) -> None:
    async with sessao(role="service_role") as conn:
        await conn.execute(
            """UPDATE crm_handoffs SET visivel_em = now() + $2::interval, erro = $3,
                      atualizado_em = now() WHERE id = $1""",
            pedido["id"], espera_transitoria(pedido["tentativas"]), str(erro)[:1000])


async def _lista_do_pedido(conn, pedido: dict):
    """O modo teste da jornada que pediu a entrega, como está AGORA (A5,
    pergunta 66). Só pedido de jornada tem `journey_run_id`; manual e regra
    = `None` (sem modo teste). Run ou jornada que sumiu = `None`, como em
    `modo_teste.lista_da_jornada`."""
    if not pedido.get("journey_run_id"):
        return None
    jornada = await conn.fetchval(
        "SELECT journey_id::text FROM journey_runs WHERE id = $1::uuid",
        pedido["journey_run_id"])
    return await modo_teste.lista_da_jornada(conn, jornada)


async def _marcar_entregue(pedido_id: int, card_id: int | None, person_id: int | None) -> None:
    async with sessao(role="service_role") as conn:
        await conn.execute(
            """UPDATE crm_handoffs SET status = 'entregue', card_id = $2, person_id = $3,
                      erro = NULL, atualizado_em = now() WHERE id = $1""",
            pedido_id, card_id, person_id)


def _id_inteiro(valor) -> int | None:
    return valor if isinstance(valor, int) and not isinstance(valor, bool) else None


def _aberto(card: dict) -> bool:
    return (_id_inteiro(card.get("id")) is not None
            and not card.get("is_won") and not card.get("is_lost"))


def _escolher(abertos: list[dict],
              criado_em: datetime | None) -> tuple[dict | None, dict | None]:
    """(o card que ESTE pedido já criou, o card aberto a atualizar) — no
    máximo um dos dois.

    O primeiro é um aberto com `created_at >= crm_handoffs.criado_em`: uma
    tentativa anterior deste pedido criou e a resposta se perdeu (§6 de lá).
    ⚠️ Card sem `created_at` legível nunca é "o nosso": na dúvida, atualiza
    (um bloco a mais no card do vendedor) em vez de calar a conversão. Sem o
    nosso, o aberto de `created_at` mais recente — sem data conta como o
    mais antigo de todos."""
    datados = [(growthhs.criado_em_utc(c), c) for c in abertos]
    if criado_em is not None:
        nossos = [(d, c) for d, c in datados if d is not None and d >= criado_em]
        if nossos:
            return min(nossos, key=lambda par: (par[0], par[1]["id"]))[1], None
    if not datados:
        return None, None
    piso = datetime.min.replace(tzinfo=timezone.utc)
    return None, max(datados, key=lambda par: (par[0] or piso, par[1]["id"]))[1]


async def _tratar_erro(pedido: dict, lead: dict, erro: Exception) -> str:
    """A política de erro, a mesma em todo passo ANTES do 2xx que muda o lado
    de lá: 401/403/404 pausam a fila; outro 4xx falha o pedido; transitório
    adia até `MAX_TENTATIVAS`."""
    if isinstance(erro, growthhs.ErroDefinitivo):
        if erro.status in STATUS_DE_CONFIGURACAO:
            # Revisão final do 8D (I3): configuração, não o lead — pausa.
            await _devolver([pedido], ESPERA_DA_PAUSA,
                            f"{PREFIXO_PAUSA} — o GrowthHS respondeu {erro}. Confira o "
                            f"client_id, o segredo, o endereço da API e a lista de entrada "
                            f"em Configurações → GrowthHS; nova tentativa a cada "
                            f"{int(ESPERA_DA_PAUSA.total_seconds() // 60)} min.")
            return "pausadas"
        await _falhar(pedido, lead, str(erro))
        return "falhas"
    if pedido["tentativas"] >= MAX_TENTATIVAS:
        await _falhar(pedido, lead, f"{erro} (desistiu após {pedido['tentativas']} tentativas)")
        return "falhas"
    await _adiar(pedido, erro)
    return "adiadas"


async def _concluir(pedido: dict, lead: dict, card_id: int | None, person_id: int | None,
                    titulo: str, extra: dict) -> None:
    """O lado de lá JÁ mudou (card criado, reconhecido ou atualizado).

    Achado I1(a) do round 1: `entregue` grava SOZINHO, numa sessão curta e à
    parte — não pode falhar por causa do que vem depois e devolver o pedido a
    'pendente' (seria o segundo card, ou o segundo bloco e a segunda nota).
    Revisão final do 8D (I5): e blindado (`asyncio.shield`) — o worker
    parando, ou desistindo de esperar e cancelando a tarefa, não corta a
    gravação entre o 2xx e o `entregue`.

    O resto é registro, não é a entrega: se falhar (gatilho de evento, banco
    fora do ar no meio, o que for), só loga — nunca re-tenta por isso."""
    await asyncio.shield(_marcar_entregue(pedido["id"], card_id, person_id))
    try:
        async with sessao(role="service_role") as conn:
            if lead["dnia_id"]:
                # M2: 2xx sem `id` não apaga o card já anotado.
                await conn.execute(
                    """UPDATE ecosystem_identities
                          SET growthhs_card_id = coalesce($2, growthhs_card_id),
                              growthhs_person_id = coalesce($3, growthhs_person_id)
                        WHERE dnia_id = $1::uuid""", lead["dnia_id"], card_id, person_id)
            await _registrar_evento(conn, lead, "crm_handoff", titulo,
                                    {"origem": pedido["origem"], "rule_id": pedido["rule_id"],
                                     "card_id": card_id, "person_id": person_id, **extra})
    except Exception:
        logger.exception("[crm] pedido %s: entregue, mas falhou ao gravar "
                         "identidade/linha do tempo", pedido["id"])


def texto_da_nota(conversao: dict | None, quando: datetime) -> str:
    return (f"Lead converteu de novo pelo MarketingHS "
            f"({growthhs.origem_do_card_texto(conversao)}) em "
            f"{growthhs.data_do_vendedor(quando)}. Descrição do card atualizada.")


async def _entregar(pedido: dict, cfg: growthhs.Config, cliente: growthhs.Cliente) -> str:
    async with sessao(role="service_role") as conn:
        lead = await conn.fetchrow(
            f"SELECT {_COLUNAS_LEAD} FROM leads WHERE id = $1::uuid", pedido["lead_id"])
        lead = dict(lead) if lead else None
        conversao, consentimento = (await origem_do_card(conn, pedido["lead_id"])
                                    if lead else (None, None))
        lista = await _lista_do_pedido(conn, pedido) if lead else None

    if lead is None or lead["deleted_at"] is not None:
        await _falhar(pedido, None, "O contato foi excluído antes da entrega.")
        return "falhas"
    if not modo_teste.na_lista(lista, lead["email"]):
        # A5 (pergunta 66): a segunda trava do modo teste, a mesma do e-mail,
        # do aviso e do webhook. O nó já conferiu; a lista pode ter mudado
        # entre o nó e a saída. O GrowthHS nem é consultado.
        await _falhar(pedido, lead, "modo teste: fora da lista da jornada")
        return "falhas"
    if pedido["acao"] == "mover":
        await _falhar(pedido, lead, MOTIVO_MOVER)
        return "falhas"

    frontend_url = settings.FRONTEND_URL
    quando = datetime.now(timezone.utc)
    try:
        person_id = await cliente.achar_ou_criar_pessoa(lead)
        abertos = [c for c in await cliente.cards_da_pessoa(person_id) if _aberto(c)]
        nosso, alvo = _escolher(abertos, pedido.get("criado_em"))
        if nosso is not None:
            # O card já nasceu com a descrição deste pedido: nem atualiza nem
            # anota.
            await _concluir(pedido, lead, nosso["id"], person_id,
                            "Enviado ao comercial (GrowthHS)", {"recuperado": True})
            return "entregues"
        if alvo is None:
            resposta = await cliente.criar_card(growthhs.montar_card(
                lead, cfg, conversao=conversao, consentimento=consentimento,
                person_id=person_id, frontend_url=frontend_url))
        else:
            card_id = alvo["id"]
            descricao = (await cliente.ler_card(card_id)).get("description") or ""
            # Review Focus 1: a tentativa anterior deste pedido pode ter feito
            # o PUT e perdido a resposta — a marca no cabeçalho diz que sim, e
            # o segundo bloco não entra.
            if not growthhs.bloco_ja_aplicado(descricao, pedido["id"]):
                await cliente.atualizar_descricao(card_id, descricao + growthhs.bloco_de_atualizacao(
                    lead, conversao=conversao, consentimento=consentimento,
                    frontend_url=frontend_url, pedido_id=pedido["id"], quando=quando))
    except (growthhs.ErroDefinitivo, growthhs.ErroTransitorio) as erro:
        return await _tratar_erro(pedido, lead, erro)

    if alvo is None:
        # Achado I1(b) do round 1: `resposta` é sempre um dict (o cliente
        # nunca levanta num 2xx do `POST /cards`), mas o CONTEÚDO pode vir
        # torto. `id` que não é inteiro vira NULL, com aviso — nunca motivo
        # para não gravar `entregue`. O `person_id` é o achado, não o da
        # resposta: sobrevive ao corpo torto.
        card_id = _id_inteiro(resposta.get("id"))
        if card_id is None and resposta.get("id") is not None:
            logger.warning("[crm] pedido %s: id do GrowthHS não é inteiro (%r) — "
                           "gravando entregue sem card_id", pedido["id"], resposta.get("id"))
        await _concluir(pedido, lead, card_id, person_id, "Enviado ao comercial (GrowthHS)", {})
        return "entregues"

    # A descrição já está atualizada (agora ou numa tentativa anterior). A
    # nota é o aviso ao vendedor.
    erro_da_nota = None
    try:
        await cliente.anotar(card_id, texto_da_nota(conversao, quando))
    except growthhs.ErroTransitorio as erro:
        if pedido["tentativas"] < MAX_TENTATIVAS:
            # No retry a marca evita o segundo bloco e só a nota sai.
            await _adiar(pedido, erro)
            return "adiadas"
        erro_da_nota = f"{erro} (desistiu após {pedido['tentativas']} tentativas)"
    except growthhs.ErroDefinitivo as erro:
        # ⚠️ Falhar o pedido mentiria: a descrição do card JÁ mudou. Entrega,
        # e o erro da nota fica na linha do tempo. Vale também para 401/403/
        # 404 aqui: pausar re-tentaria um pedido cujo efeito principal já
        # aconteceu.
        erro_da_nota = str(erro)
    extra = {"ja_entregue": True, "atualizado": True}
    if erro_da_nota:
        logger.warning("[crm] pedido %s: card %s atualizado, mas a nota falhou: %s",
                       pedido["id"], card_id, erro_da_nota)
        extra["erro_da_nota"] = erro_da_nota[:400]
    await _concluir(pedido, lead, card_id, person_id,
                    "Card atualizado no comercial (GrowthHS)", extra)
    return "atualizadas"


async def rodar_entregas(*, limite: int = 20, cfg: growthhs.Config | None = None,
                         transporte=None, somente_lead: str | list[str] | None = None,
                         parar: asyncio.Event | None = None) -> dict:
    """Um ciclo do worker. Sem configuração, NÃO reivindica — o pedido fica
    pendente, e quem configurar vê a fila andar (mesmo desenho do Resend).

    Um `growthhs.Cliente` só por ciclo: o token do primeiro pedido serve aos
    outros (e fica no cache de módulo para o próximo ciclo).

    ⚠️ `somente_lead` (um id ou uma lista) existe para os testes: eles rodam
    contra o banco de produção, e um ciclo sem filtro reivindicaria os pedidos
    REAIS e os "entregaria" ao transporte falso do teste, com card inventado.

    `parar` (revisão final do 8D, I5) é o evento de parada do worker:
    conferido entre um pedido e outro; o que foi reivindicado e não tentado
    volta à fila na hora, sem gastar tentativa."""
    cfg = cfg or await growthhs.ler_config()
    if not cfg.configurado:
        return {"desligado": True}
    contagem = {"entregues": 0, "atualizadas": 0, "adiadas": 0, "falhas": 0, "pausadas": 0}
    if parar is not None and parar.is_set():
        return contagem
    if isinstance(somente_lead, str):
        somente_lead = [somente_lead]
    pedidos = await _reivindicar(limite, somente_lead)
    if not pedidos:
        return contagem
    async with growthhs.Cliente(cfg, transporte=transporte) as cliente:
        for i, pedido in enumerate(pedidos):
            if parar is not None and parar.is_set():
                await _devolver(pedidos[i:], timedelta(0))
                break
            try:
                resultado = await _entregar(pedido, cfg, cliente)
            except Exception:
                # Defeito nosso (não do GrowthHS): por padrão o prazo da
                # reivindicação vence e o pedido volta, para tentar de novo
                # depois que o defeito for corrigido. Logar é o mínimo — não
                # engolir calado.
                logger.exception("[crm] pedido %s quebrou na entrega", pedido["id"])
                # Achado I1(c) do round 1: mas se já eram as últimas
                # tentativas, deixar 'pendente' para sempre É a falha
                # silenciosa que este projeto mais teve — mesmo teto do erro
                # transitório, para não martelar em loop um defeito que não é
                # do GrowthHS.
                if pedido["tentativas"] >= MAX_TENTATIVAS:
                    await _falhar(pedido, None,
                                  f"defeito interno na entrega (desistiu após "
                                  f"{pedido['tentativas']} tentativas)")
                    contagem["falhas"] += 1
                continue
            contagem[resultado] += 1
            if resultado == "pausadas":
                # I3: a mesma credencial/endereço vale para os outros pedidos
                # do lote — tentá-los só repetiria a recusa. Voltam junto,
                # sem gastar tentativa.
                restantes = pedidos[i + 1:]
                await _devolver(restantes, ESPERA_DA_PAUSA)
                contagem["pausadas"] += len(restantes)
                break
    return contagem
