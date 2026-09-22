"""A fila de entrega ao GrowthHS — o que era o handoff-to-nexus, sem o Nexus.

Três caminhos enfileiram (a regra de automação pelo gatilho do banco, o nó de
jornada, o botão manual) e o worker drena. Um caminho de entrega, uma política
de re-tentativa, um lugar para ver falha (`GET /config/growthhs`).

⚠️ A rede nunca roda dentro de transação: reivindica (sessão curta, com prazo
escalado ao tamanho do lote — ver `_reivindicar`), chama, grava o resultado
(outra sessão curta). Se o worker morrer entre a chamada e a gravação, o
pedido volta depois do prazo e é mandado de novo — e é por isso que o
`external_id` vai no corpo: o contrato pede ao GrowthHS a restrição
`(external_source, external_id)` que torna o reenvio inofensivo.

⚠️ Guarda do nosso lado (decisão 4): lead que já tem entrega `entregue` não
é mandado de novo — a restrição do GrowthHS ainda não existe. Revisão final
do 8D (I2): a guarda olha a PESSOA, como a origem — o card anotado na
identidade (`ecosystem_identities.growthhs_card_id`) ou a entrega de outro
lead com o mesmo `dnia_id` (fusão de contatos) também contam.

⚠️ Revisão final do 8D (I3): 401/403/404 são configuração (chave, endereço ou
funil errados), a mesma para todos os pedidos. Em vez de falhar a fila inteira
de uma vez, a fila PAUSA: o pedido volta a pendente daqui a
`ESPERA_DA_PAUSA`, a tentativa não conta, e o ciclo para. O estado aparece em
`GET /config/growthhs` (`fila.pausada`). 422 continua falhando o pedido — é o
corpo daquele lead.

⚠️ Round 1 de revisão (achado I1): um 2xx do GrowthHS JÁ criou o card — dali
em diante NUNCA se re-tenta, mesmo que o que vem depois (gravar identidade,
linha do tempo) falhe. Por isso o sucesso grava em DUAS sessões: a primeira
marca `entregue` sozinha; a segunda (identidade + evento) só loga se falhar,
nunca desfaz a primeira.
"""

import asyncio
import logging
from datetime import timedelta

from app.crm import growthhs
from app.database import sessao

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
# com a chave/endereço que o GrowthHS recusou.
STATUS_DE_CONFIGURACAO = frozenset({401, 403, 404})
ESPERA_DA_PAUSA = timedelta(minutes=10)
# `erro` de um pedido pausado começa com isto — é por este prefixo que
# `GET /config/growthhs` deriva `fila.pausada`.
PREFIXO_PAUSA = "Pausa de configuração"
MOTIVO_MOVER = ("O GrowthHS ainda não tem rota para mover card de etapa — "
                "pedido registrado no contrato (docs/contratos/"
                "2026-09-02-endpoint-card-comercial-growthhs.md).")

_COLUNAS_LEAD = """id::text AS id, nome, email, whatsapp, phone_normalized, empresa,
    cargo, faturamento, funcionarios, desafios, indicacao, utm_source, utm_medium,
    utm_campaign, utm_term, utm_content, lead_score, etiqueta,
    dnia_id::text AS dnia_id, deleted_at"""


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
    round 1): um lote de 20 pedidos, cada um podendo levar até `TIMEOUT`
    segundos de rede mais alguns segundos de escrita, não pode expirar antes
    do worker terminar de processá-lo — senão o pedido é reivindicado de novo
    NO MEIO do processamento do primeiro worker, e dois pedirem o mesmo card.
    `× 2` é folga; o piso de 5 min cobre o caso comum de lote pequeno."""
    prazo = max(PRAZO_MINIMO_DA_REIVINDICACAO,
               timedelta(seconds=(growthhs.TIMEOUT + 5) * 2 * limite))
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
                      journey_run_id::text AS journey_run_id, tentativas""",
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


async def _ja_entregue(conn, lead: dict) -> dict | None:
    """O card que esta PESSOA já tem no GrowthHS, se tiver (revisão final do
    8D, I2 — a origem olhava a pessoa, não o lead). Nesta ordem: entrega do
    próprio lead; entrega de outro lead com o mesmo `dnia_id` (fusão de
    contatos — inclusive lead já apagado: o card dele continua lá); o card
    anotado na identidade."""
    anterior = await conn.fetchrow(
        """SELECT card_id, person_id FROM crm_handoffs h
            WHERE h.acao = 'criar' AND h.status = 'entregue'
              AND (h.lead_id = $1::uuid
                   OR ($2::uuid IS NOT NULL
                       AND h.lead_id IN (SELECT id FROM leads WHERE dnia_id = $2::uuid)))
            ORDER BY (h.lead_id = $1::uuid) DESC, h.id LIMIT 1""",
        lead["id"], lead["dnia_id"])
    if anterior is None and lead["dnia_id"]:
        anterior = await conn.fetchrow(
            """SELECT growthhs_card_id AS card_id, growthhs_person_id AS person_id
                 FROM ecosystem_identities
                WHERE dnia_id = $1::uuid AND growthhs_card_id IS NOT NULL""",
            lead["dnia_id"])
    return dict(anterior) if anterior else None


async def _marcar_entregue(pedido_id: int, card_id: int | None, person_id: int | None) -> None:
    async with sessao(role="service_role") as conn:
        await conn.execute(
            """UPDATE crm_handoffs SET status = 'entregue', card_id = $2, person_id = $3,
                      erro = NULL, atualizado_em = now() WHERE id = $1""",
            pedido_id, card_id, person_id)


async def _entregar(pedido: dict, cfg: growthhs.Config, transporte) -> str:
    async with sessao(role="service_role") as conn:
        lead = await conn.fetchrow(
            f"SELECT {_COLUNAS_LEAD} FROM leads WHERE id = $1::uuid", pedido["lead_id"])
        lead = dict(lead) if lead else None
        anterior = await _ja_entregue(conn, lead) if lead else None

    if lead is None or lead["deleted_at"] is not None:
        await _falhar(pedido, None, "O contato foi excluído antes da entrega.")
        return "falhas"
    if pedido["acao"] == "mover":
        await _falhar(pedido, lead, MOTIVO_MOVER)
        return "falhas"
    if anterior:
        # Minor 4 (round 1): isto NÃO é um erro — `erro` fica NULL — e o
        # clique manual (ou a regra, ou a jornada) que caiu aqui deixa rastro
        # na linha do tempo, com `ja_entregue: true` para diferenciar do
        # envio original.
        async with sessao(role="service_role") as conn:
            await conn.execute(
                """UPDATE crm_handoffs SET status = 'entregue', card_id = $2, person_id = $3,
                          erro = NULL, atualizado_em = now()
                    WHERE id = $1""", pedido["id"], anterior["card_id"], anterior["person_id"])
            # Revisão final do 8D (M2): a gravação da identidade no sucesso é
            # só registro e pode ter falhado — aqui ela é preenchida, se
            # estiver vazia. Nunca sobrescreve um card já anotado.
            if lead["dnia_id"] and anterior["card_id"] is not None:
                await conn.execute(
                    """UPDATE ecosystem_identities SET growthhs_card_id = $2,
                              growthhs_person_id = coalesce(growthhs_person_id, $3)
                        WHERE dnia_id = $1::uuid AND growthhs_card_id IS NULL""",
                    lead["dnia_id"], anterior["card_id"], anterior["person_id"])
            await _registrar_evento(conn, lead, "crm_handoff",
                                    "Já estava no comercial (GrowthHS)",
                                    {"origem": pedido["origem"], "rule_id": pedido["rule_id"],
                                     "card_id": anterior["card_id"], "ja_entregue": True})
        return "ja_entregues"

    try:
        resposta = await growthhs.criar_card(cfg, growthhs.montar_card(lead, cfg.board_id),
                                             transporte=transporte)
    except growthhs.ErroDefinitivo as erro:
        if erro.status in STATUS_DE_CONFIGURACAO:
            # Revisão final do 8D (I3): configuração, não o lead — pausa.
            await _devolver([pedido], ESPERA_DA_PAUSA,
                            f"{PREFIXO_PAUSA} — o GrowthHS respondeu {erro}. Confira a chave, "
                            f"o endereço da API e o ID do funil em Configurações → GrowthHS; "
                            f"nova tentativa a cada {int(ESPERA_DA_PAUSA.total_seconds() // 60)} min.")
            return "pausadas"
        await _falhar(pedido, lead, str(erro))
        return "falhas"
    except growthhs.ErroTransitorio as erro:
        if pedido["tentativas"] >= MAX_TENTATIVAS:
            await _falhar(pedido, lead, f"{erro} (desistiu após {pedido['tentativas']} tentativas)")
            return "falhas"
        async with sessao(role="service_role") as conn:
            await conn.execute(
                """UPDATE crm_handoffs SET visivel_em = now() + $2::interval, erro = $3,
                          atualizado_em = now() WHERE id = $1""",
                pedido["id"], espera_transitoria(pedido["tentativas"]), str(erro)[:1000])
        return "adiadas"

    # Achado I1(b) do round 1: `resposta` já é sempre um dict (growthhs.py
    # nunca levanta num 2xx — ver o comentário lá), mas o CONTEÚDO pode vir
    # torto (id como string, ausente, etc.). Parse defensivo ANTES de
    # qualquer escrita: id/person_id que não são inteiros viram NULL, com um
    # aviso — nunca um motivo para não gravar `entregue`.
    card_id, person_id = resposta.get("id"), resposta.get("person_id")
    if card_id is not None and not isinstance(card_id, int):
        logger.warning("[crm] pedido %s: id do GrowthHS não é inteiro (%r) — "
                       "gravando entregue sem card_id", pedido["id"], card_id)
        card_id = None
    if person_id is not None and not isinstance(person_id, int):
        logger.warning("[crm] pedido %s: person_id do GrowthHS não é inteiro (%r) — "
                       "gravando entregue sem person_id", pedido["id"], person_id)
        person_id = None

    # Achado I1(a) do round 1: o card JÁ existe do lado do GrowthHS neste
    # ponto. Esta escrita marca `entregue` SOZINHA, numa sessão curta e à
    # parte — ela não pode falhar por causa do que vem depois (identidade,
    # linha do tempo) e devolver o pedido a 'pendente', porque isso re-enviaria
    # e criaria um SEGUNDO card.
    # Revisão final do 8D (I5): e roda blindada (`asyncio.shield`) — o worker
    # parando, ou desistindo de esperar e cancelando a tarefa, não corta a
    # gravação entre o 2xx e o `entregue`.
    await asyncio.shield(_marcar_entregue(pedido["id"], card_id, person_id))

    # O resto é registro, não é a entrega: se falhar aqui (gatilho de evento,
    # banco fora do ar no meio, o que for), só loga. O pedido já está
    # 'entregue' na escrita acima — nunca re-tenta por causa disto.
    try:
        async with sessao(role="service_role") as conn:
            if lead["dnia_id"]:
                # M2: 2xx sem `id` não apaga o card já anotado.
                await conn.execute(
                    """UPDATE ecosystem_identities
                          SET growthhs_card_id = coalesce($2, growthhs_card_id),
                              growthhs_person_id = coalesce($3, growthhs_person_id)
                        WHERE dnia_id = $1::uuid""", lead["dnia_id"], card_id, person_id)
            await _registrar_evento(conn, lead, "crm_handoff", "Enviado ao comercial (GrowthHS)",
                                    {"origem": pedido["origem"], "rule_id": pedido["rule_id"],
                                     "card_id": card_id, "created": resposta.get("created")})
    except Exception:
        logger.exception("[crm] pedido %s: entregue, mas falhou ao gravar "
                         "identidade/linha do tempo", pedido["id"])
    return "entregues"


async def rodar_entregas(*, limite: int = 20, cfg: growthhs.Config | None = None,
                         transporte=None, somente_lead: str | list[str] | None = None,
                         parar: asyncio.Event | None = None) -> dict:
    """Um ciclo do worker. Sem configuração, NÃO reivindica — o pedido fica
    pendente, e quem configurar vê a fila andar (mesmo desenho do Resend).

    ⚠️ `somente_lead` (um id ou uma lista) existe para os testes: eles rodam
    contra o banco de produção, e um ciclo sem filtro reivindicaria os pedidos
    REAIS e os "entregaria" ao transporte falso do teste, com card inventado.

    `parar` (revisão final do 8D, I5) é o evento de parada do worker:
    conferido entre um pedido e outro; o que foi reivindicado e não tentado
    volta à fila na hora, sem gastar tentativa."""
    cfg = cfg or await growthhs.ler_config()
    if not cfg.configurado:
        return {"desligado": True}
    contagem = {"entregues": 0, "ja_entregues": 0, "adiadas": 0, "falhas": 0, "pausadas": 0}
    if parar is not None and parar.is_set():
        return contagem
    if isinstance(somente_lead, str):
        somente_lead = [somente_lead]
    pedidos = await _reivindicar(limite, somente_lead)
    for i, pedido in enumerate(pedidos):
        if parar is not None and parar.is_set():
            await _devolver(pedidos[i:], timedelta(0))
            break
        try:
            resultado = await _entregar(pedido, cfg, transporte)
        except Exception:
            # Defeito nosso (não do GrowthHS): por padrão o prazo da
            # reivindicação vence e o pedido volta, para tentar de novo depois
            # que o defeito for corrigido. Logar é o mínimo — não engolir
            # calado.
            logger.exception("[crm] pedido %s quebrou na entrega", pedido["id"])
            # Achado I1(c) do round 1: mas se já eram as últimas tentativas,
            # deixar 'pendente' para sempre É a falha silenciosa que este
            # projeto mais teve — mesmo teto do erro transitório, para não
            # martelar em loop um defeito que não é do GrowthHS.
            if pedido["tentativas"] >= MAX_TENTATIVAS:
                await _falhar(pedido, None,
                              f"defeito interno na entrega (desistiu após "
                              f"{pedido['tentativas']} tentativas)")
                contagem["falhas"] += 1
            continue
        contagem[resultado] += 1
        if resultado == "pausadas":
            # I3: a mesma chave/endereço vale para os outros pedidos do lote
            # — tentá-los só repetiria a recusa. Voltam junto, sem gastar
            # tentativa.
            restantes = pedidos[i + 1:]
            await _devolver(restantes, ESPERA_DA_PAUSA)
            contagem["pausadas"] += len(restantes)
            break
    return contagem
