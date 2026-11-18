"""A fila do aviso de lead: a captura enfileira, o worker envia."""

import asyncio
import logging
import os
from datetime import timedelta

from app import integracoes, ritmo
from app.avisos import config as config_aviso
from app.avisos.email import montar_aviso
from app.config import settings
from app.crm import entrega
from app.database import sessao
from app.email import resend

logger = logging.getLogger(__name__)

# Dá tempo ao enriquecimento e ao agendamento de terminarem antes do e-mail.
ATRASO_INICIAL = timedelta(seconds=60)

# ⚠️ Constante, não literal inline, só para o teste forçar uma falha DE BANCO
# real (trocando a tabela por uma que não existe) e provar que o SAVEPOINT
# recupera a transação da captura.
SQL_ENFILEIRAR = (
    "INSERT INTO avisos_de_lead (conversao_id, lead_id, contato_novo, agendamento, "
    "visivel_em) VALUES ($1::uuid, $2::uuid, $3, $4, now() + $5) "
    "ON CONFLICT (conversao_id) DO NOTHING"
)


async def enfileirar(conn, *, conversao_id: str, lead_id: str, contato_novo: bool,
                     agendamento: bool) -> None:
    """Põe o aviso da conversão na fila. ⚠️ NUNCA levanta: nenhum caminho de
    falha do aviso pode recusar um lead real. O INSERT roda num SAVEPOINT para
    que um erro de banco não aborte a transação da captura.

    ⚠️ Lê `AVISO_LEAD_LIGADO` pela PRÓPRIA `conn`: `ler_config()` abriria uma
    segunda conexão do pool enquanto a captura segura a primeira (pool
    esgotado travaria a api)."""
    try:
        async with conn.transaction():
            valor = await conn.fetchval(
                "SELECT value FROM public.integration_secrets "
                "WHERE name = 'AVISO_LEAD_LIGADO'")
            if valor is None:
                valor = os.environ.get("AVISO_LEAD_LIGADO")
            if not config_aviso.ligado_de(valor):
                return
            await conn.execute(SQL_ENFILEIRAR, conversao_id, lead_id, contato_novo,
                               agendamento, ATRASO_INICIAL)
    except Exception:  # noqa: BLE001 — o aviso é secundário à captura
        logger.error("[aviso-de-lead] não enfileirou a conversão %s", conversao_id,
                     exc_info=True)


# ── Envio (o laço do worker) ─────────────────────────────────────────────────

MAX_TENTATIVAS = 8
LOTE = 20
PRAZO_DA_REIVINDICACAO = timedelta(minutes=5)
REMETENTE_PADRAO = "MarketingHS <noreply@localhost>"
ESPERA_BASE = timedelta(minutes=1)
ESPERA_MAXIMA = timedelta(minutes=60)

# ⚠️ Lead de teste (da suíte, do envio manual de prova) nunca sai pela passada
# normal: `somente=` é a única porta, e só os testes a usam.
LEAD_DE_TESTE = "(l.tipo = 'teste' OR lower(l.email) LIKE '%.invalid')"


def espera(tentativas: int) -> timedelta:
    """Quanto esperar depois da `tentativas`-ésima falha: 1, 2, 4... até 60 min."""
    return min(ESPERA_BASE * (2 ** max(tentativas - 1, 0)), ESPERA_MAXIMA)


async def _reivindicar(limite: int, somente: list[str] | None,
                       escopo: list[str] | None = None) -> list[dict]:
    """Os avisos vencidos, escondidos por `PRAZO_DA_REIVINDICACAO` e com a
    tentativa somada (se o worker morrer no meio, volta sozinho)."""
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            f"""UPDATE avisos_de_lead
                   SET visivel_em = now() + $1, tentativas = tentativas + 1,
                       atualizado_em = now()
                 WHERE id IN (
                       SELECT a.id FROM avisos_de_lead a
                         LEFT JOIN leads l ON l.id = a.lead_id
                        WHERE a.status = 'pendente' AND a.visivel_em <= now()
                          AND ($2::uuid[] IS NULL OR a.id = ANY($2::uuid[]))
                          AND ($4::uuid[] IS NULL OR a.id = ANY($4::uuid[]))
                          AND ($2::uuid[] IS NOT NULL OR NOT coalesce({LEAD_DE_TESTE}, false))
                        ORDER BY a.visivel_em LIMIT $3
                          FOR UPDATE OF a SKIP LOCKED)
             RETURNING *""", PRAZO_DA_REIVINDICACAO, somente, limite, escopo)
    return [dict(r) for r in sorted(linhas, key=lambda r: r["criado_em"])]


async def _devolver(ids: list, *, segundos: float = 0.0) -> None:
    """Devolve à fila SEM gastar tentativa (429, parada do worker)."""
    if not ids:
        return
    async with sessao(role="service_role") as conn:
        await conn.execute(
            """UPDATE avisos_de_lead
                  SET tentativas = greatest(tentativas - 1, 0),
                      visivel_em = now() + make_interval(secs => $2),
                      atualizado_em = now()
                WHERE id = ANY($1::uuid[]) AND status = 'pendente'""",
            [str(i) for i in ids], float(segundos))


async def _montar(aviso: dict) -> tuple[dict, str, str, str]:
    """`(lead, assunto, html, texto)` — lê o que o e-mail mostra."""
    async with sessao(role="service_role") as conn:
        lead = await conn.fetchrow("SELECT * FROM leads WHERE id = $1::uuid",
                                   str(aviso["lead_id"]))
        if lead is None:
            raise LookupError(f"lead {aviso['lead_id']} não existe mais")
        conversao = await conn.fetchrow(
            "SELECT * FROM lead_conversions WHERE id = $1::uuid",
            str(aviso["conversao_id"]))
        if conversao is None:
            raise LookupError(f"conversão {aviso['conversao_id']} não existe mais")
        lead, conversao = dict(lead), dict(conversao)
        nome_do_site = None
        if conversao.get("site_id"):
            nome_do_site = await conn.fetchval(
                "SELECT nome FROM sites WHERE id = $1::uuid", str(conversao["site_id"]))
        rotulos = await entrega.rotulos_da_conversao(conn, conversao)
    assunto, corpo, texto = montar_aviso(
        lead, conversao, contato_novo=aviso["contato_novo"],
        agendamento=aviso["agendamento"], rotulos=rotulos, nome_do_site=nome_do_site,
        url_contato=f"{settings.FRONTEND_URL}/contacts?contato={aviso['lead_id']}")
    return lead, assunto, corpo, texto


async def _marcar_destinatario(aviso_id, destino: str, resend_id: str) -> None:
    async with sessao(role="service_role") as conn:
        await conn.execute(
            """UPDATE avisos_de_lead
                  SET enviados = array_append(enviados, $2), resend_id = $3,
                      atualizado_em = now()
                WHERE id = $1::uuid""", str(aviso_id), destino, resend_id)


async def _concluir(aviso_id) -> None:
    async with sessao(role="service_role") as conn:
        await conn.execute(
            """UPDATE avisos_de_lead
                  SET status = 'enviado', enviado_em = now(), erro = NULL,
                      atualizado_em = now()
                WHERE id = $1::uuid""", str(aviso_id))


async def _falhou(aviso: dict, erro: Exception) -> bool:
    """Erro comum: adia com espera crescente, ou desiste na última tentativa.
    Devolve True se desistiu."""
    texto = f"{type(erro).__name__}: {erro}"[:500]
    desistiu = aviso["tentativas"] >= MAX_TENTATIVAS
    if desistiu:
        logger.error("[aviso-de-lead] AVISO DE LEAD NÃO ENVIADO — conversão %s, "
                     "lead %s: %s", aviso["conversao_id"], aviso["lead_id"], texto)
    async with sessao(role="service_role") as conn:
        if desistiu:
            await conn.execute(
                "UPDATE avisos_de_lead SET status = 'falhou', erro = $2, "
                "atualizado_em = now() WHERE id = $1::uuid", str(aviso["id"]), texto)
        else:
            await conn.execute(
                "UPDATE avisos_de_lead SET visivel_em = now() + $3, erro = $2, "
                "atualizado_em = now() WHERE id = $1::uuid",
                str(aviso["id"]), texto, espera(aviso["tentativas"]))
    return desistiu


async def rodar_avisos(*, parar: asyncio.Event | None = None, compasso=None,
                       somente: list[str] | None = None,
                       escopo: list[str] | None = None,
                       por_segundo: float = 2.0) -> dict:
    """Uma passada: envia os avisos vencidos, um e-mail por destinatário.

    `{"enviados", "adiados", "falhos"}`; `{"desligado": True}` ou
    `{"sem_chave": True}` quando não há o que fazer (nada é reivindicado, então
    nenhuma tentativa é gasta). ⚠️ `somente` existe para os testes: sem ele a
    passada não toca lead de teste.
    """
    cfg = await config_aviso.ler_config()
    if not cfg.ligado:
        return {"desligado": True}
    chave = await integracoes.ler_segredo("RESEND_API_KEY")
    if not chave:
        return {"sem_chave": True}
    compasso = compasso or ritmo.Compasso()
    resultado = {"enviados": 0, "adiados": 0, "falhos": 0}
    if compasso.segurado():
        return resultado
    de = (await integracoes.ler_segredo("EMAIL_FROM")) or REMETENTE_PADRAO

    avisos = await _reivindicar(LOTE, somente, escopo)
    for i, aviso in enumerate(avisos):
        if parar is not None and parar.is_set():
            await _devolver([a["id"] for a in avisos[i:]])
            break
        try:
            lead, assunto, corpo, texto = await _montar(aviso)
            enviados = list(aviso["enviados"] or [])
            for destino in cfg.para:
                if destino.lower() in {e.lower() for e in enviados}:
                    continue
                await compasso.esperar_vez(por_segundo)
                resend_id = await resend.enviar(
                    chave=chave, de=de, para=destino, assunto=assunto, html=corpo,
                    texto=texto, cabecalhos={}, responder_para=lead.get("email"))
                await _marcar_destinatario(aviso["id"], destino, resend_id)
                enviados.append(destino)
            await _concluir(aviso["id"])
            resultado["enviados"] += 1
        except resend.LimiteDoResend as limite:
            await _devolver([a["id"] for a in avisos[i:]], segundos=limite.espera)
            compasso.segurar(limite.espera)
            break
        except Exception as erro:  # noqa: BLE001 — um aviso não derruba os outros
            try:
                desistiu = await _falhou(aviso, erro)
            except Exception:  # noqa: BLE001
                logger.exception("[aviso-de-lead] não registrou a falha do aviso %s",
                                 aviso["id"])
                continue
            resultado["falhos" if desistiu else "adiados"] += 1
    return resultado
