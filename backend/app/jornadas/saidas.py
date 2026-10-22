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
import ipaddress
import logging
import socket
from urllib.parse import urlsplit
from datetime import datetime, timedelta, timezone

import httpx

from app import integracoes, ritmo
from app.config import settings
from app.database import sessao
from app.email import resend
from app.jornadas import modo_teste
from app.texto import html_para_texto

logger = logging.getLogger(__name__)

MAX_TENTATIVAS = 5
ESPERA_BASE = timedelta(minutes=1)
ESPERA_MAXIMA = timedelta(minutes=60)
PRAZO_DA_REIVINDICACAO = timedelta(minutes=5)
TIMEOUT_WEBHOOK = 10
# O prazo da chamada INTEIRA (conectar, mandar, receber o status). O timeout
# do httpx vale por operação; um servidor que pinga um byte a cada 9 s o
# atravessaria para sempre.
PRAZO_TOTAL_WEBHOOK = 15
LOTE = 20
# A mesma ordem de prioridade de `worker._remetente` (gravado vence o
# ambiente). Duplicado de propósito: importar o worker daqui seria circular.
REMETENTE_PADRAO = "MarketingHS <noreply@localhost>"
# 4xx que não são "o pedido está errado": tempo esgotado e limite de taxa.
STATUS_TRANSITORIOS = frozenset({408, 429})
# ⚠️ Os testes de `rodar_saidas` gravam linha de verdade no banco de produção
# (fora da transação revertida). Com este nó, a linha só sai por uma passada
# com `somente=` — o worker de produção, que passa sem filtro, nunca a vê.
# Medido em 22/10/2026: sem a marca, o worker pegava a linha antes do teste.
NO_DE_TESTE = "__teste__"

# Campos do lead que o aviso e o webhook carregam (o retrato no momento do nó).
CAMPOS_DO_LEAD = ("id", "nome", "email", "whatsapp", "phone_normalized", "empresa",
                  "cargo", "status", "etiqueta", "lead_score", "utm_source",
                  "utm_medium", "utm_campaign", "utm_term", "utm_content")
CAMPOS_DA_CONVERSAO = ("id", "converted_at", "tipo", "source", "page_slug", "form_id",
                       "site_id", "page_url", "page_path", "canal", "utm_source",
                       "utm_medium", "utm_campaign", "utm_term", "utm_content")


# ── SSRF: o webhook nunca chama a rede de dentro ─────────────────────────────
# O backend roda no EasyPanel ao lado do banco, do worker e dos outros
# serviços, todos alcançáveis por nome curto ou IP privado — e o metadata da
# nuvem mora em 169.254.169.254. Uma URL de webhook digitada no construtor não
# pode virar um pedido do servidor para lá.

REDE_CGNAT = ipaddress.ip_network("100.64.0.0/10")


class DestinoRecusado(ValueError):
    """A URL do webhook aponta (ou pode apontar) para a rede interna. Não se
    cura esperando: a saída vira `falhou` sem nova tentativa."""


def _ip_proibido(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
            or ip.is_multicast or ip.is_unspecified
            or (ip.version == 4 and ip in REDE_CGNAT)
            or not ip.is_global)


def conferir_forma_da_url(url: str) -> tuple[str, int]:
    """Só a FORMA (sem DNS) — é o que a rota que salva a jornada confere, para
    o admin ver o erro na hora. Devolve (host, porta).

    Recusa: sem `https://`, sem host, credencial na URL, `localhost` (e
    `*.localhost`), nome sem ponto (serviço interno do EasyPanel) e IP literal
    de rede interna."""
    bruto = (url or "").strip()
    try:
        partes = urlsplit(bruto)
        porta = partes.port or 443
    except ValueError:
        raise DestinoRecusado(f"webhook recusado: URL inválida ({bruto!r})") from None
    if partes.scheme.lower() != "https":
        raise DestinoRecusado("webhook recusado: a URL precisa começar com https://")
    if partes.username is not None or partes.password is not None:
        raise DestinoRecusado("webhook recusado: credencial na URL não é aceita")
    host = (partes.hostname or "").rstrip(".").lower()
    if not host:
        raise DestinoRecusado("webhook recusado: URL sem endereço")
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        ip = None
    if ip is not None:
        if _ip_proibido(ip):
            raise DestinoRecusado(f"webhook recusado: {host} é endereço de rede interna")
        return host, porta
    if host == "localhost" or host.endswith(".localhost"):
        raise DestinoRecusado("webhook recusado: localhost é a própria máquina")
    if "." not in host:
        raise DestinoRecusado(
            f"webhook recusado: {host!r} parece nome de serviço interno (sem domínio)")
    return host, porta


async def _resolver(host: str, porta: int) -> list[str]:
    infos = await asyncio.get_running_loop().getaddrinfo(
        host, porta, type=socket.SOCK_STREAM)
    return [i[4][0] for i in infos]


async def conferir_destino(url: str) -> str:
    """A forma e, para nome, a resolução: recusa se QUALQUER endereço que o
    nome devolve for interno (um nome público apontado para 10.x é o truque).
    Devolve o IP conferido — é NELE que o POST conecta (`_url_no_ip`), para o
    nome não ser resolvido de novo (DNS rebinding).

    `socket.gaierror` (DNS fora do ar) sobe como está — é transitório."""
    host, porta = conferir_forma_da_url(url)
    try:
        return str(ipaddress.ip_address(host))  # IP literal: a forma já conferiu
    except ValueError:
        pass
    enderecos = await _resolver(host, porta)
    if not enderecos:
        raise DestinoRecusado(f"webhook recusado: {host} não resolve para nenhum endereço")
    for e in enderecos:
        if _ip_proibido(ipaddress.ip_address(e.split("%", 1)[0])):
            raise DestinoRecusado(
                f"webhook recusado: {host} resolve para {e}, endereço de rede interna")
    return enderecos[0].split("%", 1)[0]


def _url_no_ip(url: str, ip: str) -> tuple[str, str, str]:
    """(URL com o IP no lugar do nome, cabeçalho Host, nome para o SNI).

    ⚠️ O TLS continua validando o certificado do NOME original: o httpx usa
    a extensão `sni_hostname` como nome do servidor na verificação."""
    partes = urlsplit(url.strip())
    host = (partes.hostname or "").rstrip(".").lower()
    alvo = f"[{ip}]" if ":" in ip else ip
    if partes.port is not None:
        alvo += f":{partes.port}"
        cabecalho_host = f"{host}:{partes.port}"
    else:
        cabecalho_host = host
    return partes._replace(netloc=alvo).geturl(), cabecalho_host, host


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
    # ⚠️ Esgotou as tentativas e continua pendente: a falha veio DEPOIS da
    # chamada (ex.: `_marcar_enviado` estourando após o 2xx), e a linha
    # voltaria a cada prazo para sempre — mandando de novo. Vira `falhou`.
    await conn.execute(
        """UPDATE journey_saidas
              SET status = 'falhou', atualizado_em = now(),
                  erro = left(concat_ws(' — ', erro,
                         'desistiu: ' || tentativas || ' tentativas esgotadas'), 1000)
            WHERE status = 'pendente' AND visivel_em <= now() AND tipo = $1
              AND tentativas >= $2
              AND ($3::bigint[] IS NULL OR id = ANY($3::bigint[]))
              AND ($3::bigint[] IS NOT NULL OR journey_node_id <> $4)""",
        tipo, MAX_TENTATIVAS, somente, NO_DE_TESTE)
    if limite <= 0:
        return []
    # ⚠️ Para aviso, `limite` é de DESTINATÁRIOS (o teto do Resend conta
    # e-mail, não linha): cada aviso custa os endereços que ainda faltam, e
    # entram na ordem enquanto a soma couber. Webhook custa 1.
    linhas = await conn.fetch(
        """WITH cand AS (
               SELECT id, visivel_em,
                      CASE WHEN tipo = 'aviso_email'
                           THEN greatest(cardinality(string_to_array(destino, ','))
                                - coalesce(jsonb_array_length(payload->'enviados'), 0), 1)
                           ELSE 1 END AS custo
                 FROM journey_saidas
                WHERE status = 'pendente' AND visivel_em <= now()
                  AND tipo = $1 AND tentativas < $5
                  AND ($4::bigint[] IS NULL OR id = ANY($4::bigint[]))
                  AND ($4::bigint[] IS NOT NULL OR journey_node_id <> $7)
                ORDER BY visivel_em, id LIMIT $6
                FOR UPDATE SKIP LOCKED),
           escolhidas AS (
               SELECT id FROM (SELECT id, sum(custo) OVER (ORDER BY visivel_em, id) AS acumulado
                                 FROM cand) x
                WHERE acumulado <= $2)
           UPDATE journey_saidas SET visivel_em = now() + $3::interval,
                  tentativas = tentativas + 1, atualizado_em = now()
            WHERE id IN (SELECT id FROM escolhidas)
        RETURNING id, tipo, destino, payload, tentativas, resend_email_id,
                  journey_id::text AS journey_id, lead_id::text AS lead_id""",
        tipo, limite, PRAZO_DA_REIVINDICACAO, somente, MAX_TENTATIVAS, LOTE,
        NO_DE_TESTE)
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
    _, contato_ok = await _modo_teste_agora(s)
    if not contato_ok:
        await _falhar(s["id"], MOTIVO_CONTATO_FORA)
        return "falhos"
    try:
        # O nó e a rota já conferem a forma; aqui vai também a resolução — o
        # nome pode ter passado a apontar para dentro depois de salvo.
        ip = await conferir_destino(url)
    except DestinoRecusado as e:
        await _falhar(s["id"], str(e))
        return "falhos"
    except OSError as e:  # DNS fora do ar: tenta de novo depois
        return await _reagendar(s, f"DNS: {e}")
    no_ip, cabecalho_host, sni = _url_no_ip(url, ip)

    async def postar() -> int:
        async with httpx.AsyncClient(timeout=TIMEOUT_WEBHOOK, transport=transporte,
                                     follow_redirects=False) as cliente:
            # ⚠️ Conecta no IP conferido, nunca no nome: o httpx resolveria
            # de novo, e um DNS que troca de resposta (rebinding) levaria o
            # pedido para dentro depois da conferência.
            # ⚠️ `stream` e só o status: o corpo da resposta NUNCA é lido
            # (um destino hostil poderia mandar gigabytes); sair do bloco
            # fecha a conexão sem consumi-lo.
            async with cliente.stream(
                    "POST", no_ip, json=s["payload"], headers={"Host": cabecalho_host},
                    extensions={"sni_hostname": sni}) as resposta:
                return resposta.status_code

    try:
        codigo = await asyncio.wait_for(postar(), PRAZO_TOTAL_WEBHOOK)
    except asyncio.TimeoutError:
        return await _reagendar(s, f"prazo de {PRAZO_TOTAL_WEBHOOK} s esgotado")
    except Exception as e:  # noqa: BLE001 — rede: transitório
        return await _reagendar(s, f"{type(e).__name__}: {e}")
    if 200 <= codigo < 300:
        await asyncio.shield(_marcar_enviado(s["id"]))
        return "enviados"
    if 300 <= codigo < 500 and codigo not in STATUS_TRANSITORIOS:
        await _falhar(s["id"], f"HTTP {codigo}")
        return "falhos"
    return await _reagendar(s, f"HTTP {codigo}")


async def _anotar_destinatario(saida_id: int, email: str, resend_id: str) -> None:
    async with sessao(role="service_role") as conn:
        await conn.execute(
            """UPDATE journey_saidas
                  SET resend_email_id = concat_ws(',', resend_email_id, $3::text),
                      payload = jsonb_set(payload, '{enviados}',
                                coalesce(payload->'enviados', '[]'::jsonb) || to_jsonb($2::text)),
                      atualizado_em = now()
                WHERE id = $1""", saida_id, email, resend_id or "")


MOTIVO_CONTATO_FORA = "modo teste: contato fora da lista"


async def _modo_teste_agora(s: dict):
    """(lista em vigor, contato permitido?) — relidos na hora de sair. O nó
    conferiu o contato quando rodou; a lista pode ter mudado até o worker
    drenar (antimeta nº 1)."""
    async with sessao(role="service_role") as conn:
        lista = await modo_teste.lista_da_jornada(conn, s.get("journey_id"))
        if not modo_teste.ligado(lista):
            return lista, True
        email = await conn.fetchval(
            "SELECT email FROM leads WHERE id = $1::uuid", s.get("lead_id")) \
            if s.get("lead_id") else None
    return lista, modo_teste.na_lista(lista, email)


async def _anotar_pulados(saida_id: int, pulados: list[str]) -> None:
    async with sessao(role="service_role") as conn:
        await conn.execute(
            """UPDATE journey_saidas SET payload = jsonb_set(payload, '{pulados}', $2::jsonb),
                      atualizado_em = now() WHERE id = $1""", saida_id, pulados)


async def _mandar_aviso(s: dict, chave: str, de: str, compasso, por_segundo: float) -> str:
    payload = s["payload"]
    ja = set(payload.get("enviados") or [])
    destinos = [d.strip() for d in (s["destino"] or "").split(",") if d.strip()]
    if not destinos:
        await _falhar(s["id"], "aviso sem destinatário")
        return "falhos"
    # ⚠️ Antimeta nº 1, de novo na hora de sair: com modo teste ligado, quem
    # RECEBE o aviso também precisa estar na lista (a rota recusa ao salvar;
    # isto cobre a lista que mudou depois). Fora da lista, o destinatário é
    # pulado e anotado em `payload.pulados`.
    lista, contato_ok = await _modo_teste_agora(s)
    if not contato_ok:
        await _falhar(s["id"], MOTIVO_CONTATO_FORA)
        return "falhos"
    pulados = [d for d in destinos if not modo_teste.na_lista(lista, d)]
    if pulados:
        destinos = [d for d in destinos if d not in pulados]
        await _anotar_pulados(s["id"], pulados)
        if not destinos:
            await _falhar(s["id"], "modo teste: nenhum destinatário do aviso está na lista")
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
    # ⚠️ Avisos ANTES dos webhooks: um lote de webhooks lentos (até
    # `PRAZO_TOTAL_WEBHOOK` cada) não pode atrasar o aviso ao comercial.
    await _drenar_avisos(contagem, parar, compasso, somente)
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
    return contagem


async def _drenar_avisos(contagem: dict, parar, compasso, somente) -> None:
    chave = await integracoes.ler_segredo("RESEND_API_KEY")
    if not chave or (compasso is not None and compasso.segurado()):
        return
    de = (await integracoes.ler_segredo("EMAIL_FROM")) or REMETENTE_PADRAO
    r = await ritmo.ler()
    async with sessao(role="service_role") as conn:
        # A mesma trava do `worker._tick`: medir + reivindicar sem o outro
        # laço no meio. `limite` aqui é de DESTINATÁRIOS, não de linhas.
        await ritmo.travar_cota(conn)
        uso = await ritmo.medir(conn)
        limite = ritmo.cota_de(r, uso, lote=LOTE,
                               visibilidade=int(PRAZO_DA_REIVINDICACAO.total_seconds()))
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
