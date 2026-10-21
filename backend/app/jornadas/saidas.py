"""A caixa de saída das jornadas: nós "avisar por e-mail" e "enviar para webhook".

Prova do RD, Tarefa 8. O nó NÃO manda nada na hora: grava uma linha em
`journey_saidas` (uma por run e nó — `uniq_journey_saidas_run_node`, a mesma
garantia de não duplicar que o índice único de (run, nó) dá ao e-mail) e
segue. Quem manda é `rodar_saidas`, num laço próprio do worker.

⚠️ A rede nunca roda dentro de transação (molde de `app/crm/entrega.py`):
reivindica numa sessão curta (`visivel_em = now() + 5 min`, `tentativas + 1`,
`FOR UPDATE SKIP LOCKED`), chama fora, grava o resultado em outra sessão. Se o
worker morrer no meio, a linha volta depois do prazo.

⚠️ O aviso é e-mail INTERNO (endereço nosso, fixo no nó): não passa por
supressão nem descadastro do lead, e sai sem cabeçalho de descadastro. Mas
CONTA NO TETO do Resend — `ritmo.SQL_USO` soma os avisos enviados, e quantos
saem por passada é a `ritmo.cota` daquela hora.

⚠️ Aviso para vários endereços: uma chamada ao Resend por destinatário (o
cliente do Resend manda para um só). Cada um que sai é anotado na hora
(`payload.enviados`, `resend_email_id` acumulado): se o terceiro falhar, a
volta manda só do terceiro em diante — ninguém recebe o aviso duas vezes.
"""

import asyncio
import html as _html
import logging
from datetime import datetime, timedelta, timezone

import httpx

from app import integracoes, ritmo
from app.config import settings
from app.database import sessao
from app.email import resend
from app.texto import html_para_texto

logger = logging.getLogger(__name__)

MAX_TENTATIVAS = 5
ESPERA_BASE = timedelta(minutes=1)
ESPERA_MAXIMA = timedelta(minutes=60)
PRAZO_DA_REIVINDICACAO = timedelta(minutes=5)
TIMEOUT_WEBHOOK = 10
LOTE = 20
# A mesma ordem de prioridade de `worker._remetente` (gravado vence o
# ambiente). Duplicado de propósito: importar o worker daqui seria circular.
REMETENTE_PADRAO = "MarketingHS <noreply@localhost>"
# 4xx que não são "o pedido está errado": tempo esgotado e limite de taxa.
STATUS_TRANSITORIOS = frozenset({408, 429})

# Campos do lead que o aviso e o webhook carregam (o retrato no momento do nó).
CAMPOS_DO_LEAD = ("id", "nome", "email", "whatsapp", "phone_normalized", "empresa",
                  "cargo", "status", "etiqueta", "lead_score", "utm_source",
                  "utm_medium", "utm_campaign", "utm_term", "utm_content")
CAMPOS_DA_CONVERSAO = ("id", "converted_at", "tipo", "source", "page_slug", "form_id",
                       "site_id", "page_url", "page_path", "canal", "utm_source",
                       "utm_medium", "utm_campaign", "utm_term", "utm_content")


def espera(tentativas: int) -> timedelta:
    """Quanto esperar depois da `tentativas`-ésima falha transitória."""
    return min(ESPERA_BASE * (2 ** max(tentativas - 1, 0)), ESPERA_MAXIMA)


def _agora_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def enfileirar(conn, run: dict, no: dict, tipo: str, destino: str,
                     payload: dict) -> int | None:
    """Uma saída por (run, nó). A reexecução do nó (lease expirado, retentativa)
    devolve `None` — nada é duplicado."""
    return await conn.fetchval(
        """INSERT INTO journey_saidas
               (journey_id, journey_run_id, journey_node_id, lead_id, tipo, destino, payload)
           VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6, $7::jsonb)
           ON CONFLICT ON CONSTRAINT uniq_journey_saidas_run_node DO NOTHING
           RETURNING id""",
        run["journey_id"], run["run_id"], str(no.get("id")), run["lead_id"],
        tipo, destino, payload)


def _como_dict(valor) -> dict | None:
    if valor is None:
        return None
    if isinstance(valor, str):
        import json
        valor = json.loads(valor)
    return dict(valor)


async def dados_do_lead(conn, lead_id: str) -> tuple[dict, dict | None]:
    """(lead com `campos_extras` e `tags`, última conversão ou None).

    `to_jsonb(l)` em vez de lista de colunas: o retrato leva o que a linha
    tiver, e o laço de montagem escolhe o que mostrar."""
    bruto = await conn.fetchval(
        "SELECT to_jsonb(l) FROM leads l WHERE l.id = $1::uuid", lead_id)
    lead = _como_dict(bruto)
    if lead is None:
        from app.jornadas.executor import ErroDefinitivo
        raise ErroDefinitivo("contato não existe mais")
    lead["campos_extras"] = _como_dict(lead.get("campos_extras")) or {}
    lead["tags"] = list(await conn.fetchval(
        """SELECT coalesce(array_agg(t.name ORDER BY t.name), '{}')
             FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id
            WHERE lt.lead_id = $1::uuid""", lead_id) or [])
    conversao = _como_dict(await conn.fetchval(
        """SELECT to_jsonb(c) FROM lead_conversions c WHERE c.lead_id = $1::uuid
            ORDER BY c.converted_at DESC LIMIT 1""", lead_id))
    return lead, conversao


def _txt(valor) -> str:
    return _html.escape("" if valor is None else str(valor))


def montar_aviso(lead: dict, conversao: dict | None, url_da_ficha: str,
                 assunto: str | None = None) -> tuple[str, str]:
    """(assunto, html) do aviso interno. ⚠️ TODO valor passa por `html.escape`:
    o nome, a mensagem e os extras vêm de formulário público."""
    nome = lead.get("nome") or lead.get("email") or "(sem nome)"
    empresa = lead.get("empresa")
    if not (assunto or "").strip():
        assunto = f"[MarketingHS] Novo lead: {nome}" + (f" — {empresa}" if empresa else "")
    extras = dict(lead.get("campos_extras") or {})
    mensagem = extras.pop("mensagem", None)
    conversao = conversao or {}
    origem = " · ".join(str(v) for v in (conversao.get("page_slug"),
                                          conversao.get("form_id")) if v)

    linhas = [
        ("Nome", lead.get("nome")),
        ("E-mail", lead.get("email")),
        ("Celular", lead.get("whatsapp") or lead.get("phone_normalized")),
        ("Empresa", empresa),
        ("Cargo", lead.get("cargo")),
        ("Página / formulário", origem or None),
        ("Endereço da conversão", conversao.get("page_url")),
        ("Canal", conversao.get("canal")),
    ]
    partes = ["<h2>Novo lead</h2>", "<table>"]
    for rotulo, valor in linhas:
        if valor not in (None, ""):
            partes.append(f"<tr><th align=\"left\">{_txt(rotulo)}</th>"
                          f"<td>{_txt(valor)}</td></tr>")
    partes.append("</table>")
    if mensagem not in (None, ""):
        partes.append(f"<h3>Mensagem</h3><p>{_txt(mensagem)}</p>")
    if extras:
        partes.append("<h3>Outros campos</h3><table>")
        for chave in sorted(extras):
            partes.append(f"<tr><th align=\"left\">{_txt(chave)}</th>"
                          f"<td>{_txt(extras[chave])}</td></tr>")
        partes.append("</table>")
    partes.append(f"<p><a href=\"{_txt(url_da_ficha)}\">Abrir a ficha do contato</a>"
                  f"<br>{_txt(url_da_ficha)}</p>")
    return assunto, "\n".join(partes)


def montar_webhook(lead: dict, conversao: dict | None, run: dict, no: dict) -> dict:
    return {
        "evento": "journey.webhook",
        "journey_id": str(run["journey_id"]),
        "run_id": str(run["run_id"]),
        "node_id": str(no.get("id")),
        "lead": {**{c: lead.get(c) for c in CAMPOS_DO_LEAD},
                 "campos_extras": lead.get("campos_extras") or {},
                 "tags": lead.get("tags") or []},
        "conversao": ({c: conversao.get(c) for c in CAMPOS_DA_CONVERSAO}
                      if conversao else None),
        "gerado_em": _agora_iso(),
    }


def url_da_ficha(lead_id: str) -> str:
    return f"{settings.FRONTEND_URL}/contacts?contato={lead_id}"


# ── O laço ───────────────────────────────────────────────────────────────────

async def reivindicar(conn, tipo: str, limite: int, *,
                      somente: list[int] | None = None) -> list[dict]:
    """As saídas vencidas de um tipo, escondidas por 5 min e com a tentativa
    somada. ⚠️ `somente` existe para os testes: eles rodam contra o banco de
    produção, e uma passada sem filtro mandaria as saídas reais."""
    if limite <= 0:
        return []
    linhas = await conn.fetch(
        """UPDATE journey_saidas SET visivel_em = now() + $3::interval,
                  tentativas = tentativas + 1, atualizado_em = now()
            WHERE id IN (SELECT id FROM journey_saidas
                          WHERE status = 'pendente' AND visivel_em <= now()
                            AND tipo = $1
                            AND ($4::bigint[] IS NULL OR id = ANY($4::bigint[]))
                          ORDER BY visivel_em, id LIMIT $2
                          FOR UPDATE SKIP LOCKED)
        RETURNING id, tipo, destino, payload, tentativas, resend_email_id""",
        tipo, limite, PRAZO_DA_REIVINDICACAO, somente)
    return [{**dict(l), "payload": _como_dict(l["payload"]) or {}} for l in linhas]


async def _marcar_enviado(saida_id: int) -> None:
    async with sessao(role="service_role") as conn:
        await conn.execute(
            """UPDATE journey_saidas SET status = 'enviado', enviado_em = now(),
                      erro = NULL, atualizado_em = now() WHERE id = $1""", saida_id)


async def _falhar(saida_id: int, erro: str) -> None:
    async with sessao(role="service_role") as conn:
        await conn.execute(
            """UPDATE journey_saidas SET status = 'falhou', erro = $2, atualizado_em = now()
                WHERE id = $1""", saida_id, erro[:1000])


async def _reagendar(s: dict, erro: str) -> str:
    """Falha transitória: espera e tenta de novo; na quinta, desiste."""
    if s["tentativas"] >= MAX_TENTATIVAS:
        await _falhar(s["id"], f"{erro} (desistiu após {s['tentativas']} tentativas)")
        return "falhos"
    async with sessao(role="service_role") as conn:
        await conn.execute(
            """UPDATE journey_saidas SET visivel_em = now() + $2::interval, erro = $3,
                      atualizado_em = now() WHERE id = $1""",
            s["id"], espera(s["tentativas"]), erro[:1000])
    return "reagendados"


async def _devolver(ids: list[int], segundos: float) -> None:
    """Reivindicadas e NÃO tentadas (429 do Resend, parada do worker): voltam
    sem gastar tentativa."""
    if not ids:
        return
    async with sessao(role="service_role") as conn:
        await conn.execute(
            """UPDATE journey_saidas
                  SET visivel_em = now() + make_interval(secs => $2),
                      tentativas = greatest(tentativas - 1, 0), atualizado_em = now()
                WHERE id = ANY($1::bigint[]) AND status = 'pendente'""",
            ids, float(segundos))


def _classificar(erro: Exception) -> str:
    """'definitivo' para 3xx (redirecionamento não é seguido de propósito) e
    4xx (menos 408/429); 'transitorio' para o resto (5xx, rede, timeout)."""
    if isinstance(erro, httpx.HTTPStatusError):
        codigo = erro.response.status_code
        if 300 <= codigo < 500 and codigo not in STATUS_TRANSITORIOS:
            return "definitivo"
    return "transitorio"


async def _mandar_webhook(s: dict, transporte) -> str:
    url = (s["destino"] or "").strip()
    if not url.lower().startswith("https://"):
        # O nó já recusa; a reconferência cobre linha escrita por outro caminho.
        await _falhar(s["id"], "webhook exige https://")
        return "falhos"
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_WEBHOOK, transport=transporte,
                                     follow_redirects=False) as cliente:
            resposta = await cliente.post(url, json=s["payload"])
        resposta.raise_for_status()
    except Exception as e:  # noqa: BLE001 — rede, timeout, status: tudo classificado
        motivo = (f"HTTP {e.response.status_code}" if isinstance(e, httpx.HTTPStatusError)
                  else f"{type(e).__name__}: {e}")
        if _classificar(e) == "definitivo":
            await _falhar(s["id"], motivo)
            return "falhos"
        return await _reagendar(s, motivo)
    await asyncio.shield(_marcar_enviado(s["id"]))
    return "enviados"


async def _anotar_destinatario(saida_id: int, email: str, resend_id: str) -> None:
    async with sessao(role="service_role") as conn:
        await conn.execute(
            """UPDATE journey_saidas
                  SET resend_email_id = concat_ws(',', resend_email_id, $3::text),
                      payload = jsonb_set(payload, '{enviados}',
                                coalesce(payload->'enviados', '[]'::jsonb) || to_jsonb($2::text)),
                      atualizado_em = now()
                WHERE id = $1""", saida_id, email, resend_id or "")


async def _mandar_aviso(s: dict, chave: str, de: str, compasso, por_segundo: float) -> str:
    payload = s["payload"]
    ja = set(payload.get("enviados") or [])
    destinos = [d.strip() for d in (s["destino"] or "").split(",") if d.strip()]
    if not destinos:
        await _falhar(s["id"], "aviso sem destinatário")
        return "falhos"
    html = payload.get("html") or ""
    for email in destinos:
        if email in ja:
            continue
        try:
            if compasso is not None:
                await compasso.esperar_vez(por_segundo)
            resend_id = await resend.enviar(
                chave=chave, de=de, para=email,
                assunto=payload.get("assunto") or "[MarketingHS] Aviso",
                html=html, texto=payload.get("texto") or html_para_texto(html),
                cabecalhos={})
        except resend.LimiteDoResend:
            raise
        except Exception as e:  # noqa: BLE001
            motivo = (f"Resend HTTP {e.response.status_code}"
                      if isinstance(e, httpx.HTTPStatusError) else f"{type(e).__name__}: {e}")
            if _classificar(e) == "definitivo":
                await _falhar(s["id"], motivo)
                return "falhos"
            return await _reagendar(s, motivo)
        await asyncio.shield(_anotar_destinatario(s["id"], email, resend_id))
    await asyncio.shield(_marcar_enviado(s["id"]))
    return "enviados"


async def rodar_saidas(*, parar: asyncio.Event | None = None,
                       transporte: httpx.AsyncBaseTransport | None = None,
                       compasso: "ritmo.Compasso | None" = None,
                       somente: list[int] | None = None) -> dict:
    """Uma passada da caixa de saída. Devolve {enviados, reagendados, falhos}.

    Webhook: sempre. Aviso: só com `RESEND_API_KEY`, só a `ritmo.cota` da
    passada (0 → nenhum), e nada enquanto o `compasso` estiver segurado por
    um 429. `compasso` é o do worker, para o ritmo valer entre os dois laços.
    """
    contagem = {"enviados": 0, "reagendados": 0, "falhos": 0}
    if parar is not None and parar.is_set():
        return contagem

    async with sessao(role="service_role") as conn:
        webhooks = await reivindicar(conn, "webhook", LOTE, somente=somente)
    for i, s in enumerate(webhooks):
        if parar is not None and parar.is_set():
            await _devolver([x["id"] for x in webhooks[i:]], 0)
            return contagem
        try:
            contagem[await _mandar_webhook(s, transporte)] += 1
        except Exception:  # noqa: BLE001 — defeito nosso: o prazo devolve a linha
            logger.exception("[saidas] webhook %s quebrou", s["id"])

    chave = await integracoes.ler_segredo("RESEND_API_KEY")
    if not chave or (compasso is not None and compasso.segurado()):
        return contagem
    de = (await integracoes.ler_segredo("EMAIL_FROM")) or REMETENTE_PADRAO
    r = await ritmo.ler()
    async with sessao(role="service_role") as conn:
        uso = await ritmo.medir(conn)
        limite = ritmo.cota(
            r, uso.hoje, uso.primeiro_dia,
            enviados_hora=uso.enviados_hora, enviados_dia=uso.enviados_dia,
            lote=LOTE, visibilidade=int(PRAZO_DA_REIVINDICACAO.total_seconds()))
        avisos = await reivindicar(conn, "aviso_email", limite, somente=somente)
    for i, s in enumerate(avisos):
        if parar is not None and parar.is_set():
            await _devolver([x["id"] for x in avisos[i:]], 0)
            break
        try:
            contagem[await _mandar_aviso(s, chave, de, compasso, r.por_segundo)] += 1
        except resend.LimiteDoResend as e:
            logger.warning("[saidas] Resend pediu %ss (429) — %s avisos de volta",
                           e.espera, len(avisos) - i)
            if compasso is not None:
                compasso.segurar(e.espera)
            await _devolver([x["id"] for x in avisos[i:]], e.espera)
            break
        except Exception:  # noqa: BLE001
            logger.exception("[saidas] aviso %s quebrou", s["id"])
    return contagem
