"""O redirecionador e o coletor do teste A/B — o que eram as functions `go` e
`ab-events`. Públicos, sem autenticação: o redirecionador é navegação de quem
clicou no anúncio; o coletor é chamado pelo `ab.js` nas landing pages.

⚠️ Os dois NUNCA atrapalham o visitante. O redirecionador não mostra página de
erro enquanto houver para onde mandar (cai no domínio de produção); o coletor
responde na hora. Gravação vai em `BackgroundTasks`, que roda DEPOIS da
resposta sair — o `waitUntil` da origem.

⚠️ `role="service_role"`: não há usuário. Quem autoriza é a natureza da rota,
pública por desenho, como `/publico/captura`.

Em produção os dois ficam atrás do Worker do Cloudflare no subdomínio do
redirecionador (o código está na tela de Configuração do A/B). É isso que faz o
navegador aceitar o cookie `Domain=.<domínio de produção>`: batendo direto no
backend, o cookie é recusado e não há permanência na variante — só serve para
conferência.
"""

import json
import logging
from urllib.parse import parse_qsl, quote, unquote, urlencode, urlsplit, urlunsplit
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse

from app.ab.dominio import host_no_dominio, ler_user_agent, normalizar_dominio, sortear
from app.ab.eventos import (MAX_EVENTOS, ORIGEM, ROBO, SEM_DUPLICATA, inserir,
                            normalizar_evento)
from app.database import sessao

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/publico/ab", tags=["ab-publico"])

VALIDADE_COOKIE = 60 * 60 * 24 * 90  # 90 dias
# Parâmetro de uso interno do redirecionador, que não vai para o destino.
PARAMETROS_INTERNOS = {"t"}
_SEM_CACHE = {"Cache-Control": "no-store, no-cache, must-revalidate",
              "X-Robots-Tag": "noindex, nofollow",
              "Referrer-Policy": "no-referrer-when-downgrade"}


def _redirecionar(destino: str, cookies: list[str] | None = None) -> Response:
    resposta = Response(status_code=status.HTTP_302_FOUND,
                        headers={"Location": destino, **_SEM_CACHE})
    for cookie in cookies or []:
        resposta.headers.append("set-cookie", cookie)
    return resposta


def _reserva(dominio: str) -> Response:
    """Para onde vai o clique sem teste. A origem usava `AB_FALLBACK_URL`
    (padrão https://dnia.ai); aqui é o domínio de produção (decisão 2). Sem
    domínio configurado não há para onde mandar: 404 curto, sem página."""
    if dominio:
        return _redirecionar(f"https://{dominio}")
    return Response("Link de teste indisponível.", status_code=404,
                    headers=_SEM_CACHE, media_type="text/plain")


def _cookie(nome: str, valor: str, dominio: str) -> str:
    partes = [f"{nome}={quote(valor, safe='')}", "Path=/",
              f"Max-Age={VALIDADE_COOKIE}", "SameSite=Lax", "Secure"]
    if dominio:
        partes.insert(1, f"Domain=.{dominio}")
    return "; ".join(partes)


def _definir(pares: list[tuple[str, str]], chave: str, valor: str) -> list[tuple[str, str]]:
    """O `URLSearchParams.set` do JS: troca a primeira ocorrência, apaga as
    outras, acrescenta no fim se não havia."""
    saida, posto = [], False
    for k, v in pares:
        if k != chave:
            saida.append((k, v))
        elif not posto:
            saida.append((chave, valor))
            posto = True
    if not posto:
        saida.append((chave, valor))
    return saida


def _escolher_teste(linhas):
    """Quem responde pela slug pública:
    1. o que está `running` (no máximo um — índice único parcial);
    2. sem ele, o mais recente que JÁ RODOU, servindo a vencedora (ou o
       controle) a 100% — o link do anúncio nunca quebra entre testes;
    3. por último, um rascunho (100% controle)."""
    return (next((t for t in linhas if t["status"] == "running"), None)
            or next((t for t in linhas
                     if t["status"] in ("completed", "paused", "archived")), None)
            or (linhas[0] if linhas else None))


@router.get("/go")
@router.get("/go/{public_slug}")
async def redirecionar(request: Request, tarefas: BackgroundTasks,
                       public_slug: str | None = None):
    """O que era a function `go`. O slug vem do caminho ou de `?t=` (que vence)."""
    dominio = ""
    try:
        async with sessao(role="service_role") as conn:
            dominio = normalizar_dominio(await conn.fetchval(
                "SELECT production_domain FROM ab_config LIMIT 1"))
            slug_publico = (request.query_params.get("t") or "").strip() or public_slug
            if not slug_publico:
                return _reserva(dominio)
            # A mesma slug pública pode ter vários testes ao longo do tempo;
            # por isso lista, em vez de pegar um.
            linhas = await conn.fetch(
                """SELECT slug, status, variants, control_variant, winner_variant
                     FROM ab_tests WHERE public_slug = $1
                    ORDER BY updated_at DESC LIMIT 20""", slug_publico)
        return _decidir(request, tarefas, dominio, _escolher_teste(linhas))
    except Exception:
        logger.exception("[ab/go] falha — o visitante vai para a reserva")
        return _reserva(dominio)


def _decidir(request: Request, tarefas: BackgroundTasks, dominio: str, teste) -> Response:
    if teste is None:
        return _reserva(dominio)
    # Chave INTERNA do teste: é ela que circula em cookie, `ab_test`, eventos.
    # Nunca se repete entre testes, então reusar a slug pública não mistura
    # permanência nem dedupe.
    slug = teste["slug"]
    variantes = teste["variants"] if isinstance(teste["variants"], list) else []
    if not variantes:
        return _reserva(dominio)
    controle = next((v for v in variantes if v.get("key") == teste["control_variant"]),
                    variantes[0])

    cookies = {k: unquote(v) for k, v in request.cookies.items()}
    # Visitante compartilhado entre testes — ajuda a costura de identidade.
    vid = cookies.get("ab_vid")
    vid_novo = not vid
    if vid_novo:
        vid = f"v_{uuid4().hex}"

    # `running`: permanece na variante do cookie ou sorteia. Qualquer outro
    # status: 100% numa variante — a vencedora se o teste foi concluído com
    # uma, senão o controle (o "kill switch" do `paused`).
    escolhida, fixa = None, False
    if teste["status"] == "running":
        anterior = cookies.get(f"ab_{slug}")  # formato "{variante}|{vid}"
        if anterior:
            chave = anterior.split("|")[0]
            escolhida = next((v for v in variantes if v.get("key") == chave), None)
            fixa = escolhida is not None
        if escolhida is None:
            escolhida = sortear(variantes)
    else:
        escolhida = next((v for v in variantes if v.get("key") == teste["winner_variant"]),
                         None) or controle

    partes = urlsplit(str(escolhida.get("url") or ""))
    if partes.scheme not in ("http", "https") or not partes.hostname:
        return _reserva(dominio)
    # Defesa em profundidade: a validação primária é no cadastro. Destino fora
    # do domínio de produção vira cross-domain redirect no anúncio (reprovação
    # "Destination mismatch"). Sem domínio configurado, segue (fail-open).
    if dominio and not host_no_dominio(partes.hostname, dominio):
        logger.warning("[ab/go] destino fora do domínio de produção: %s não "
                       "pertence a %s (teste=%s, variante=%s)",
                       partes.hostname, dominio, slug, escolhida.get("key"))
        return _reserva(dominio)

    pares = parse_qsl(partes.query, keep_blank_values=True)
    for k, v in request.query_params.multi_items():
        if k not in PARAMETROS_INTERNOS:
            pares = _definir(pares, k, v)
    for k, v in (("ab_test", slug), ("ab_var", escolhida["key"]), ("ab_vid", vid)):
        pares = _definir(pares, k, v)
    destino = urlunsplit(partes._replace(query=urlencode(pares)))

    novos = [_cookie(f"ab_{slug}", f"{escolhida['key']}|{vid}", dominio)]
    if vid_novo:
        novos.append(_cookie("ab_vid", vid, dominio))

    ua = request.headers.get("user-agent") or ""
    lido = ler_user_agent(ua)
    comum = {
        "ab_test": slug, "ab_var": escolhida["key"], "ab_vid": vid,
        "referrer": request.headers.get("referer"),
        **{c: request.query_params.get(c) for c in ORIGEM},
        "raw_query": request.url.query or None,
        "device_type": lido["device_type"], "browser": lido["browser"],
        "browser_version": lido["browser_version"] or None, "os": lido["os"],
        "language": (request.headers.get("accept-language") or "").split(",")[0] or None,
    }
    tarefas.add_task(_registrar_clique, comum, destino, ua or None, fixa)
    return _redirecionar(destino, novos)


async def _registrar_clique(comum: dict, destino: str, ua: str | None, fixa: bool) -> None:
    """Roda depois do 302 sair. Nunca propaga: o visitante já foi."""
    try:
        async with sessao(role="service_role") as conn:
            # `ab_assignments` só na PRIMEIRA atribuição — guarda a origem de
            # first-touch.
            if not fixa:
                await inserir(conn, "ab_assignments",
                              {**comum, "landing_url": destino, "user_agent": ua},
                              "ON CONFLICT (ab_vid, ab_test) DO NOTHING")
            # Um evento `assignment` por clique: é o volume de cliques.
            await inserir(conn, "ab_events",
                          {**comum, "event_type": "assignment",
                           "event_name": "sticky" if fixa else "new", "url": destino})
    except Exception:
        logger.exception("[ab/go] falha ao registrar o clique — o redirecionamento já saiu")


@router.post("/eventos", status_code=status.HTTP_202_ACCEPTED)
async def coletar(request: Request, tarefas: BackgroundTasks):
    """O que era a function `ab-events`. Aceita um evento, uma lista ou
    `{"events": [...]}`, com qualquer `content-type` — o `ab.js` manda
    `text/plain` para não disparar preflight (decisão 5)."""
    ua = request.headers.get("user-agent") or ""
    if ROBO.search(ua):
        # 200, e não erro, para o robô não re-tentar.
        return JSONResponse({"accepted": 0, "skipped": "bot"})
    try:
        corpo = json.loads(await request.body())
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "JSON inválido.")

    if isinstance(corpo, list):
        brutos = corpo
    elif isinstance(corpo, dict) and isinstance(corpo.get("events"), list):
        brutos = corpo["events"]
    elif isinstance(corpo, dict):
        brutos = [corpo]
    else:
        brutos = []

    lido = ler_user_agent(ua)
    referer = request.headers.get("referer")
    idioma = (request.headers.get("accept-language") or "").split(",")[0] or None
    linhas = [linha for evento in brutos[:MAX_EVENTOS]
              if (linha := normalizar_evento(evento, lido, referer, idioma))]
    if linhas:
        tarefas.add_task(_gravar_eventos, linhas)
    return {"accepted": len(linhas)}


async def _gravar_eventos(linhas: list[dict]) -> None:
    """Linha a linha, cada uma no seu SAVEPOINT: um evento ruim não leva os
    outros. Duplicata é absorvida pelo índice (`SEM_DUPLICATA`)."""
    try:
        async with sessao(role="service_role") as conn:
            for linha in linhas:
                try:
                    async with conn.transaction():
                        await inserir(conn, "ab_events", linha, SEM_DUPLICATA)
                except Exception:
                    logger.exception("[ab/eventos] evento descartado (%s)",
                                     linha["event_type"])
    except Exception:
        logger.exception("[ab/eventos] banco indisponível — lote de %d perdido",
                         len(linhas))
