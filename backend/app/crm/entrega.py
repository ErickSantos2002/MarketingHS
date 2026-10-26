"""A fila de entrega ao GrowthHS — o que era o handoff-to-nexus, sem o Nexus.

Três caminhos enfileiram (a regra de automação pelo gatilho do banco, o nó de
jornada, o botão manual) e o worker drena. Um caminho de entrega, uma política
de re-tentativa, um lugar para ver falha (`GET /config/growthhs`).

Desde 22/10 a entrega fala com a API NORMAL do GrowthHS (spec
`2026-10-22-growthhs-real-design.md` §3; autoridade:
`hsgrowth-sistema/docs/integracao-marketinghs.md`), por pedido:

    achar/criar a pessoa (SÓ por e-mail exato) → cards dela nos boards →
      aberto criado DEPOIS do pedido E assinado `Pedido MarketingHS: <id>`
        → é o nosso (201 perdido): entregue + nota de abertura
      outro card aberto → anexa um bloco no fim da descrição + nota
      nenhum aberto (inclusive só ganhos/perdidos) → cria + nota de abertura

Pergunta 79 (26/10): a tela do card do GrowthHS NÃO mostra a `description`.
O que o vendedor lê vai em NOTA (`growthhs.nota_de_abertura`, `texto_da_nota`);
a descrição continua sendo escrita porque é a engrenagem da idempotência (a
assinatura do card novo, a marca do bloco).

Lead SEM e-mail nunca casa com pessoa nem card existente: cria pessoa nova
(o id fica no pedido, para o retry não criar outra) e card novo.

⚠️ A rede nunca roda dentro de transação: reivindica (sessão curta, com prazo
escalado ao tamanho do lote — ver `_reivindicar`), chama, grava o resultado
(outra sessão curta). Se o worker morrer entre a chamada e a gravação, o
pedido volta depois do prazo e é tentado de novo.

⚠️ O `POST /cards` de lá NÃO é idempotente (§6 de lá: não há `external_id`).
A defesa é toda daqui, e é a ordem acima: o retry depois de um 201 que se
perdeu acha o card aberto mais novo que `crm_handoffs.criado_em` com a
assinatura deste pedido e o reconhece em vez de criar outro; o retry depois
de um PUT que se perdeu acha a marca `(pedido N)` no cabeçalho do bloco e não
empilha o segundo.

⚠️ Segurança (coordenadora, 22/10): atualizar o card aberto põe dados de um
formulário PÚBLICO no card de um vendedor. As travas: pessoa só por e-mail
exato (telefone lá não tem unicidade); o bloco e a nota dizem "dados
informados no formulário, não verificados"; o PUT só ANEXA à `description`
(nunca título, pessoa ou outro campo); a identidade nunca troca o card/pessoa
já gravados.

⚠️ A guarda local antiga (`_ja_entregue`: lead já entregue não era mandado
de novo, e o `person_id` guardado era reusado) SAIU de propósito (spec §3):
o card anotado aqui pode ter sido ganho ou perdido lá, e o lead que converte
de novo precisa chegar ao vendedor. E nenhum `person_id` guardado na
identidade é reusado sem buscar — os do receptor de teste eram inventados e
podem colidir com pessoas reais do CRM. A única exceção é o lead SEM e-mail:
o retry reusa o `crm_handoffs.person_id` que ESTE pedido gravou ao criar a
pessoa (ver acima) — não há e-mail para buscar, e criar outra duplicaria.

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

from app.captura.informados import divergencias
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
# Tamanho máximo da descrição do card depois de anexar o bloco de reconversão.
TETO_DA_DESCRICAO = 20_000
PREFIXO_PAUSA = "Pausa de configuração"
MOTIVO_MOVER = ("O GrowthHS ainda não tem rota para mover card de etapa — "
                "pedido registrado no contrato (docs/contratos/"
                "2026-09-02-endpoint-card-comercial-growthhs.md).")
# O pior caso real de um pedido: token (+ renovação no 401), busca de pessoa,
# POST /persons (+ nova busca no 400), cards nos 2 boards, leitura do card,
# PUT e nota — umas 10 chamadas de até `TIMEOUT` segundos cada.
CHAMADAS_POR_PEDIDO = 10

# ⚠️ Pedido de lead DE TESTE nunca sai por um ciclo sem `somente_lead` (o do
# worker de produção). Os testes de entrega gravam pedidos FORA de transação
# no banco de produção, com transporte falso; o worker rodando ao lado
# reivindicaria o pedido antes do teste e mandaria ao GrowthHS REAL — pessoa
# e card de verdade para um "Entrega 8D sem e-mail". É a mesma lição de
# 22/10 de `saidas.NO_DE_TESTE` (medido: sem a marca, o worker pegava a linha
# antes do teste). O lead de teste é `tipo = 'teste'` E e-mail nulo ou
# `@exemplo.invalid` — as duas condições, para um contato real marcado
# `teste` à mão (com e-mail de verdade) continuar sendo entregue. `l` é o
# alias de `leads`.
LEAD_DE_TESTE = """(l.tipo = 'teste'
    AND (l.email IS NULL OR lower(l.email) LIKE '%@exemplo.invalid'))"""

# Pergunta 80 (Erick, 26/10/2026): nada que veio do DataCore (ERP Tiny, a base
# de clientes) vai ao comercial — só o que veio de landing, formulário de site
# ou import manual (CSV). É a SEGUNDA linha: a sincronização saiu da tela e da
# API e os contatos foram apagados; isto segura o que sobrar ou voltar. Três
# camadas: `enfileirar` recusa (botão → 409, nó de jornada → passo `skipped`),
# o gatilho da migration 033 descarta o pedido da regra de automação (que é
# gatilho de banco e não passa por aqui), e `_entregar` falha o pedido que já
# estava na fila. Comparação sem caixa e sem espaço, igual à 033.
ORIGENS_RECUSADAS = ("datacore",)
MOTIVO_ORIGEM = ("Contato de origem DataCore (base de clientes do ERP) não vai ao "
                 "comercial — só vai o que veio de landing, formulário de site ou "
                 "importação manual (pergunta 80).")


class ContatoRecusado(Exception):
    """O contato não pode ir ao comercial pela origem (ver `ORIGENS_RECUSADAS`)."""


def origem_recusada(source: str | None) -> bool:
    return (source or "").strip().lower() in ORIGENS_RECUSADAS


_COLUNAS_LEAD = """id::text AS id, nome, email, whatsapp, phone_normalized, empresa,
    cargo, faturamento, funcionarios, desafios, indicacao, utm_source, utm_medium,
    utm_campaign, utm_term, utm_content, lead_score, etiqueta,
    dnia_id::text AS dnia_id, deleted_at, campos_extras, source"""


async def origem_do_card(conn, lead_id: str) -> tuple[dict | None, dict | None]:
    """(última conversão, último consentimento) do lead, para o card (prova
    do RD). `converted_at`/`criado_em` em ISO 8601, como o resto do corpo.

    `gclid` (API normal do GrowthHS, 22/10): o da visita MAIS RECENTE com
    gclid do mesmo `visitor_id` da conversão. ⚠️ "Com gclid" importa: a
    última visita costuma ser a volta direta, sem clique pago — pegar a
    última de todas apagaria a atribuição do anúncio. Conversão sem
    visitante (envio manual, base importada) → `None`. Visita DEPOIS da
    conversão não conta: não foi o clique que trouxe o lead.

    `dados_informados` (031, pergunta 73): o que o lead digitou NESTA
    conversão. ⚠️ Lido por `to_jsonb(lc) -> 'dados_informados'`, não pela
    coluna: sem a 031 no banco dá NULL em vez de derrubar a entrega — o
    worker pode subir antes da migration."""
    conversao = await conn.fetchrow(
        """SELECT lc.page_slug, lc.form_id, s.nome AS site_nome, lc.page_url,
                  to_char(lc.converted_at AT TIME ZONE 'UTC',
                          'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS converted_at, lc.canal,
                  (SELECT v.gclid FROM visitas v
                    WHERE lc.visitor_id IS NOT NULL AND v.visitor_id = lc.visitor_id
                      AND v.gclid IS NOT NULL AND v.criado_em <= lc.converted_at
                    ORDER BY v.criado_em DESC LIMIT 1) AS gclid,
                  to_jsonb(lc) -> 'dados_informados' AS dados_informados
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
    """Um pedido por lead e ação enquanto pendente; o segundo é absorvido.

    Contato de origem recusada (pergunta 80) levanta `ContatoRecusado` — nem
    chega ao INSERT. Quem chama decide o que dizer: o botão responde 409, o nó
    de jornada registra o passo `skipped` e segue."""
    source = await conn.fetchval("SELECT source FROM leads WHERE id = $1::uuid", lead_id)
    if origem_recusada(source):
        raise ContatoRecusado(MOTIVO_ORIGEM)
    return await conn.fetchval(
        """INSERT INTO crm_handoffs (lead_id, acao, origem, rule_id, journey_run_id)
           VALUES ($1::uuid, $2, $3, $4::uuid, $5::uuid)
           ON CONFLICT (lead_id, acao) WHERE status = 'pendente' DO NOTHING
           RETURNING id""",
        lead_id, acao, origem, rule_id, journey_run_id)


async def _reivindicar(limite: int, somente_lead: list[str] | None) -> list[dict]:
    """O prazo da reivindicação escala com o tamanho do lote (achado I2 do
    round 1): um lote de 20 pedidos, cada um com até `CHAMADAS_POR_PEDIDO`
    chamadas de até `TIMEOUT` segundos (+5 s de escrita), não pode expirar
    antes do worker terminar de processá-lo — senão o pedido é reivindicado
    de novo NO MEIO do processamento do primeiro worker, e dois pedirem o
    mesmo card. `× 2` é folga sobre esse pior caso; o piso de 5 min cobre o
    caso comum de lote pequeno. O custo: pedido de worker que morreu volta
    só quando o prazo vence (até ~1 h com lote de 20).

    Sem `somente_lead` (o worker), pedido de lead de teste fica de fora —
    ver `LEAD_DE_TESTE`.

    Devolve `criado_em` (contra ele a entrega procura o card que uma
    tentativa anterior criou, ver `_separar`) e `person_id` (a pessoa que
    uma tentativa anterior criou para lead SEM e-mail, ver `_entregar`)."""
    prazo = max(PRAZO_MINIMO_DA_REIVINDICACAO,
               timedelta(seconds=(growthhs.TIMEOUT * CHAMADAS_POR_PEDIDO + 5) * 2 * limite))
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            f"""UPDATE crm_handoffs SET visivel_em = now() + $2::interval,
                      tentativas = tentativas + 1, atualizado_em = now()
                WHERE id IN (SELECT id FROM crm_handoffs
                              WHERE status = 'pendente' AND visivel_em <= now()
                                AND ($3::uuid[] IS NULL OR lead_id = ANY($3::uuid[]))
                                AND ($3::uuid[] IS NOT NULL OR NOT EXISTS (
                                      SELECT 1 FROM leads l
                                       WHERE l.id = crm_handoffs.lead_id
                                         AND {LEAD_DE_TESTE}))
                              ORDER BY visivel_em LIMIT $1
                              FOR UPDATE SKIP LOCKED)
            RETURNING id, lead_id::text AS lead_id, acao, origem, rule_id::text AS rule_id,
                      journey_run_id::text AS journey_run_id, tentativas, criado_em,
                      person_id, ambiente""",
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


async def _marcar_entregue(pedido_id: int, card_id: int | None, person_id: int | None,
                           ambiente: str) -> None:
    """`ambiente` (030): de qual GrowthHS são o card e a pessoa — o card 26 da
    homologação não é o card 26 da produção."""
    async with sessao(role="service_role") as conn:
        await conn.execute(
            """UPDATE crm_handoffs SET status = 'entregue', card_id = $2, person_id = $3,
                      ambiente = $4, erro = NULL, atualizado_em = now() WHERE id = $1""",
            pedido_id, card_id, person_id, ambiente)


def _id_inteiro(valor) -> int | None:
    return valor if isinstance(valor, int) and not isinstance(valor, bool) else None


def _aberto(card: dict) -> bool:
    return (_id_inteiro(card.get("id")) is not None
            and not card.get("is_won") and not card.get("is_lost"))


# Folga de relógio entre o GrowthHS (que dá o `created_at` do card) e o nosso
# banco (que dá o `criado_em` do pedido): o card do 201 perdido pode parecer
# até uns minutos MAIS VELHO que o pedido. A trava continua sendo a
# assinatura `Pedido MarketingHS: <id>` — a folga só alarga quem é lido.
FOLGA_DE_RELOGIO = timedelta(minutes=5)


def _separar(abertos: list[dict], criado_em: datetime | None) -> tuple[list[dict], list[dict]]:
    """(candidatos a "o card que ESTE pedido criou", todos os abertos do mais
    recente ao mais antigo).

    Candidato é aberto com `created_at >= crm_handoffs.criado_em -
    FOLGA_DE_RELOGIO` (revisão final, M2: relógio de lá atrasado não pode
    esconder o card que ESTE pedido criou e virar o segundo card); ele só
    vira "o nosso" depois que `ler_card` confirma a assinatura
    (`growthhs.card_do_pedido`). ⚠️ Data sozinha não basta: o card que a
    automação do RD, o vendedor à mão durante uma pausa ou o gêmeo criou
    também é mais novo que o pedido, e reconhecê-lo marcaria entregue sem
    entregar. Card sem `created_at` legível nunca é candidato e, na ordem,
    conta como o mais antigo de todos."""
    datados = [(growthhs.criado_em_utc(c), c) for c in abertos]
    candidatos = sorted(((d, c) for d, c in datados
                         if criado_em is not None and d is not None
                         and d >= criado_em - FOLGA_DE_RELOGIO),
                        key=lambda par: (par[0], par[1]["id"]))
    piso = datetime.min.replace(tzinfo=timezone.utc)
    ordem = sorted(datados, key=lambda par: (par[0] or piso, par[1]["id"]), reverse=True)
    return [c for _, c in candidatos], [c for _, c in ordem]


async def _gravar_pessoa_do_pedido(pedido_id: int, person_id: int, ambiente: str) -> None:
    """Lead sem e-mail: a pessoa que ESTE pedido criou fica no pedido logo
    depois de criada — no retry (201 do card perdido, transitório) é ela que
    se reusa, em vez de criar uma segunda pessoa. Com o ambiente (030): se
    trocarem de ambiente entre uma tentativa e outra, a pessoa é de OUTRO
    GrowthHS e não se reusa."""
    async with sessao(role="service_role") as conn:
        await conn.execute(
            "UPDATE crm_handoffs SET person_id = $2, ambiente = $3, atualizado_em = now() "
            "WHERE id = $1", pedido_id, person_id, ambiente)


async def _tratar_erro(pedido: dict, lead: dict, erro: Exception) -> str:
    """A política de erro, a mesma em todo passo ANTES do 2xx que muda o lado
    de lá: 401/403/404 — e qualquer erro marcado `de_configuracao` (o
    `client-credentials`, a URL inválida) — pausam a fila; outro 4xx falha o
    pedido; transitório adia até `MAX_TENTATIVAS`."""
    if isinstance(erro, growthhs.ErroDefinitivo):
        if erro.de_configuracao or erro.status in STATUS_DE_CONFIGURACAO:
            # Revisão final do 8D (I3): configuração, não o lead — pausa.
            # Revisão final da growthhs-real (I1): e todo erro do
            # `client-credentials` ou de URL que não se monta, QUALQUER
            # status (308 do proxy http→https, 405, 400) — o token não leva
            # nada do lead, então falhar pedido a pedido derrubaria a fila.
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
                    titulo: str, extra: dict, ambiente: str, *, marcar: bool = True) -> None:
    """O lado de lá JÁ mudou (card criado, reconhecido ou atualizado) no
    GrowthHS `ambiente`.

    Achado I1(a) do round 1: `entregue` grava SOZINHO, numa sessão curta e à
    parte — não pode falhar por causa do que vem depois e devolver o pedido a
    'pendente' (seria o segundo card, ou o segundo bloco e a segunda nota).
    Revisão final do 8D (I5): e blindado (`asyncio.shield`) — o worker
    parando, ou desistindo de esperar e cancelando a tarefa, não corta a
    gravação entre o 2xx e o `entregue`.

    O resto é registro, não é a entrega: se falhar (gatilho de evento, banco
    fora do ar no meio, o que for), só loga — nunca re-tenta por isso.

    `marcar=False`: quem chama já gravou o `entregue` (card novo, antes da
    nota de abertura — ver `_anotar_abertura`)."""
    if marcar:
        await asyncio.shield(_marcar_entregue(pedido["id"], card_id, person_id, ambiente))
    try:
        async with sessao(role="service_role") as conn:
            if lead["dnia_id"]:
                # ⚠️ Segurança (coordenadora, 22/10, B2): no MESMO ambiente, só
                # PREENCHE. O card e a pessoa já gravados na identidade não são
                # trocados por uma entrega que atualizou outro card — o que o
                # formulário público disser não reescreve o vínculo da pessoa
                # (e 2xx sem `id`, M2, também não apaga nada).
                # Ids de OUTRO ambiente (ou sem ambiente, os da prova de
                # 21–22/10) não valem neste GrowthHS: são sobrescritos, com o
                # carimbo do ambiente desta entrega (030).
                await conn.execute(
                    """UPDATE ecosystem_identities
                          SET growthhs_card_id = CASE WHEN growthhs_ambiente = $4
                                  THEN coalesce(growthhs_card_id, $2) ELSE $2 END,
                              growthhs_person_id = CASE WHEN growthhs_ambiente = $4
                                  THEN coalesce(growthhs_person_id, $3) ELSE $3 END,
                              growthhs_ambiente = $4
                        WHERE dnia_id = $1::uuid""",
                    lead["dnia_id"], card_id, person_id, ambiente)
            await _registrar_evento(conn, lead, "crm_handoff", titulo,
                                    {"origem": pedido["origem"], "rule_id": pedido["rule_id"],
                                     "card_id": card_id, "person_id": person_id,
                                     "ambiente": ambiente, **extra})
    except Exception:
        logger.exception("[crm] pedido %s: entregue, mas falhou ao gravar "
                         "identidade/linha do tempo", pedido["id"])


# Cada valor informado na nota (uma linha só, é o aviso — a descrição leva
# até `growthhs.MAX_VALOR_EXTRA`).
MAX_VALOR_NA_NOTA = 200


def texto_da_nota(conversao: dict | None, quando: datetime, lead: dict | None = None,
                  *, frontend_url: str | None = None) -> list[str]:
    """A nota do card atualizado, em linhas (`growthhs.Cliente.anotar`).

    Pergunta 79: a tela do card do GrowthHS não mostra a `description`, então
    a nota não fala mais dela ("Descrição do card atualizada…" saiu) — é ela
    que o vendedor lê. Com `lead`, e se a conversão trouxe valores diferentes
    dos do contato (pergunta 73), eles vêm um por linha ("- Rótulo: valor"),
    também quando a descrição já está no teto e o bloco não entrou. Com
    `lead` e `frontend_url`, o link da ficha fecha a nota: o card aberto pode
    ter nascido no RD ou à mão, sem link nenhum para cá."""
    linhas = [f"Lead converteu de novo pelo MarketingHS "
              f"({growthhs.origem_do_card_texto(conversao)}) em "
              f"{growthhs.data_do_vendedor(quando)}."]
    diferentes = (divergencias(lead, (conversao or {}).get("dados_informados"))
                  if lead is not None else [])
    itens = []
    for d in diferentes:
        rotulo = growthhs.uma_linha(d["rotulo"])[:growthhs.MAX_ROTULO_EXTRA]
        valor = growthhs.uma_linha(d["valor"])[:MAX_VALOR_NA_NOTA]
        if rotulo and valor:
            itens.append(f"- {rotulo}: {valor}")
    if itens:
        linhas.append(f"{growthhs.ROTULO_INFORMADOS}:")
        linhas.extend(itens)
    link = growthhs.link_da_ficha(frontend_url, lead.get("id")) if lead else None
    if link:
        linhas.append(link)
    return linhas


# Tentativas do POST da nota de abertura na hora (transitório). Depois disso o
# erro vai para o evento — o pedido não volta à fila por causa da nota.
TENTATIVAS_DA_NOTA_DE_ABERTURA = 2


async def _anotar_abertura(pedido: dict, lead: dict, card_id: int | None,
                           person_id: int | None, extra: dict, *, cfg: growthhs.Config,
                           cliente: growthhs.Cliente, conversao: dict | None,
                           consentimento: dict | None, frontend_url: str,
                           quando: datetime) -> str:
    """Card novo (criado agora, ou reconhecido no retry): grava `entregue`,
    posta a nota de abertura e registra. Pergunta 79: a tela do card do
    GrowthHS não mostra a `description` — a nota é o que o vendedor lê.

    ⚠️ `entregue` grava ANTES da nota (blindado): com a nota no meio, uma
    parada do worker deixaria pendente um pedido cujo card JÁ existe, e o
    retry apostaria o "um card só" no reconhecimento — que falha se o
    vendedor ganhar ou perder o card no intervalo. Pelo mesmo motivo a nota
    NUNCA falha, pausa nem adia o pedido: transitório tenta de novo na hora
    (`TENTATIVAS_DA_NOTA_DE_ABERTURA`); o que sobrar vai em `erro_da_nota`,
    como no caminho de atualizar. ⚠️ O POST da nota não é idempotente: o
    timeout que chegou lá e a segunda tentativa dão nota repetida — ruído
    aceito; nota faltando é vendedor sem contexto."""
    await asyncio.shield(_marcar_entregue(pedido["id"], card_id, person_id, cfg.ambiente))
    erro_da_nota = None
    if card_id is None:
        erro_da_nota = "nota de abertura não enviada: o GrowthHS não devolveu o id do card"
    else:
        linhas = growthhs.nota_de_abertura(lead, conversao=conversao,
                                           consentimento=consentimento,
                                           frontend_url=frontend_url, quando=quando)
        for tentativa in range(1, TENTATIVAS_DA_NOTA_DE_ABERTURA + 1):
            try:
                await cliente.anotar(card_id, linhas)
                erro_da_nota = None
                break
            except growthhs.ErroTransitorio as erro:
                erro_da_nota = f"{erro} ({tentativa} tentativa(s) da nota de abertura)"
            except growthhs.ErroDefinitivo as erro:
                erro_da_nota = str(erro)
                break
    if erro_da_nota:
        logger.warning("[crm] pedido %s: card %s entregue, mas a nota de abertura falhou: %s",
                       pedido["id"], card_id, erro_da_nota)
        extra = {**extra, "erro_da_nota": erro_da_nota[:400]}
    await _concluir(pedido, lead, card_id, person_id, "Enviado ao comercial (GrowthHS)",
                    extra, cfg.ambiente, marcar=False)
    return "entregues"


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
    if origem_recusada(lead.get("source")):
        # Pergunta 80: o pedido que já estava na fila (criado antes da 033, ou
        # o contato que passou a ser `datacore`) falha à vista, na linha do
        # tempo — e o GrowthHS nem é consultado.
        await _falhar(pedido, lead, MOTIVO_ORIGEM)
        return "falhas"
    if pedido["acao"] == "mover":
        await _falhar(pedido, lead, MOTIVO_MOVER)
        return "falhas"

    frontend_url = settings.FRONTEND_URL
    quando = datetime.now(timezone.utc)
    tem_email = bool((lead.get("email") or "").strip())
    try:
        if tem_email:
            # A pessoa é sempre BUSCADA (Review Focus 2: nenhum `person_id`
            # guardado vale sem busca — os do receptor de teste eram
            # inventados).
            person_id = await cliente.achar_ou_criar_pessoa(lead)
            abertos = [c for c in await cliente.cards_da_pessoa(person_id) if _aberto(c)]
        elif (pedido.get("person_id") is not None
              and pedido.get("ambiente") == cfg.ambiente):
            # Sem e-mail, retry: a pessoa é a que ESTE pedido criou; os cards
            # dela só servem para reconhecer o nosso — nunca para atualizar.
            # ⚠️ Só no MESMO ambiente (030): trocaram de ambiente entre as
            # tentativas, a pessoa gravada é de outro GrowthHS — cria outra.
            person_id = pedido["person_id"]
            abertos = [c for c in await cliente.cards_da_pessoa(person_id) if _aberto(c)]
        else:
            person_id = await cliente.achar_ou_criar_pessoa(lead)  # sem e-mail: cria
            await _gravar_pessoa_do_pedido(pedido["id"], person_id, cfg.ambiente)
            abertos = []  # pessoa recém-criada não tem card
        candidatos, ordem = _separar(abertos, pedido.get("criado_em"))
        lidos: dict[int, str] = {}
        for candidato in candidatos:
            lidos[candidato["id"]] = (await cliente.ler_card(candidato["id"])).get(
                "description") or ""
            if growthhs.card_do_pedido(lidos[candidato["id"]], pedido["id"]):
                # O card já nasceu com a descrição deste pedido: não
                # atualiza. Anota a abertura (pergunta 79): a tentativa que
                # criou o card perdeu o 201 (ou morreu antes do `entregue`)
                # e não chegou à nota. Se por acaso chegou, é nota repetida.
                return await _anotar_abertura(
                    pedido, lead, candidato["id"], person_id, {"recuperado": True},
                    cfg=cfg, cliente=cliente, conversao=conversao,
                    consentimento=consentimento, frontend_url=frontend_url, quando=quando)
        # ⚠️ Sem e-mail não há "a pessoa do lead" lá — só a que este pedido
        # criou. Atualizar card dela que não é nosso seria escrever no card
        # de um vendedor por um contato que nunca se provou o mesmo.
        alvo = ordem[0] if ordem and tem_email else None
        if alvo is None:
            resposta = await cliente.criar_card(growthhs.montar_card(
                lead, cfg, conversao=conversao, consentimento=consentimento,
                person_id=person_id, frontend_url=frontend_url, pedido_id=pedido["id"]))
        else:
            card_id = alvo["id"]
            if card_id not in lidos:
                lidos[card_id] = (await cliente.ler_card(card_id)).get("description") or ""
            descricao = lidos[card_id]
            # Review Focus 1: a tentativa anterior deste pedido pode ter feito
            # o PUT e perdido a resposta — a marca no cabeçalho diz que sim, e
            # o segundo bloco não entra. O PUT só ANEXA: descrição atual +
            # bloco, e só a chave `description`.
            if not growthhs.bloco_ja_aplicado(descricao, pedido["id"]):
                bloco = growthhs.bloco_de_atualizacao(
                    lead, conversao=conversao, consentimento=consentimento,
                    frontend_url=frontend_url, pedido_id=pedido["id"], quando=quando)
                # ⚠️ Quem sabe o e-mail de um cliente reconverte quantas vezes
                # quiser e cada vez anexa um bloco ao card dele. Passado o
                # teto, a descrição para de crescer — só a nota sai.
                if len(descricao) + len(bloco) <= TETO_DA_DESCRICAO:
                    await cliente.atualizar_descricao(card_id, descricao + bloco)
    except (growthhs.ErroDefinitivo, growthhs.ErroTransitorio) as erro:
        # ⚠️ 404 em `ler_card`/PUT (card apagado entre a listagem e a
        # leitura) cai na pausa de configuração como qualquer 404: a fila
        # espera 10 min e a próxima listagem já não traz o card. Raro, e
        # resolve sozinho — por isso não ganhou caminho próprio.
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
        return await _anotar_abertura(
            pedido, lead, card_id, person_id, {}, cfg=cfg, cliente=cliente,
            conversao=conversao, consentimento=consentimento, frontend_url=frontend_url,
            quando=quando)

    # A descrição já está atualizada (agora ou numa tentativa anterior). A
    # nota é o aviso ao vendedor.
    # ⚠️ O POST da nota não é idempotente: se ele chegar lá e a resposta se
    # perder (transitório → adia), o retry anota DE NOVO. Aceito: uma nota
    # repetida no histórico do card é ruído; não avisar o vendedor é perder
    # o lead. A descrição, essa, não repete (a marca do bloco).
    erro_da_nota = None
    try:
        await cliente.anotar(card_id, texto_da_nota(conversao, quando, lead,
                                                    frontend_url=frontend_url))
    except growthhs.ErroTransitorio as erro:
        if pedido["tentativas"] < MAX_TENTATIVAS:
            # No retry a marca evita o segundo bloco e só a nota sai.
            await _adiar(pedido, erro)
            return "adiadas"
        erro_da_nota = f"{erro} (desistiu após {pedido['tentativas']} tentativas)"
    except growthhs.ErroDefinitivo as erro:
        # ⚠️ Erro definitivo DEPOIS do PUT e antes da nota: falhar o pedido
        # mentiria — a descrição do card JÁ mudou. Entrega, e o erro da nota
        # fica na linha do tempo (`erro_da_nota`). Vale também para 401/403/
        # 404 aqui (inclusive o card apagado entre o PUT e a nota): pausar
        # re-tentaria um pedido cujo efeito principal já aconteceu.
        erro_da_nota = str(erro)
    extra = {"ja_entregue": True, "atualizado": True}
    if erro_da_nota:
        logger.warning("[crm] pedido %s: card %s atualizado, mas a nota falhou: %s",
                       pedido["id"], card_id, erro_da_nota)
        extra["erro_da_nota"] = erro_da_nota[:400]
    await _concluir(pedido, lead, card_id, person_id,
                    "Card atualizado no comercial (GrowthHS)", extra, cfg.ambiente)
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
