"""A outra ponta do `rastreio.js`: visita e conversão de OUTRO domínio
(prova do RD, 21/10/2026).

É o que o "código de monitoramento" do RD faz no `healthsafety.com.br`: o
script colado no site registra a visita e, no envio de qualquer formulário
com e-mail, manda a conversão para cá — sem bloquear nem atrasar o envio
original (`frontend/public/rastreio.js`).

⚠️ **O token (`pub_…`) é público.** Ele está no HTML do site; qualquer um lê.
Por isso ele só faz três coisas — cria/atualiza lead, grava conversão,
grava visita — e só vale com `Origin` de um domínio cadastrado no site. Não
lê dado, não dispara campanha. Sem `Origin` (extensão de privacidade,
`file://`) é 403 e nada é gravado: o site segue funcionando, porque o
script nunca espera a resposta (Review Focus 3 do plano).

⚠️ **O corpo é lido cru** (`await request.body()`): o `sendBeacon` manda
`text/plain` — é o que evita o preflight de CORS —, e o FastAPI só faria o
parse de `application/json`. Teto de 16 KB.

⚠️ O registro da conversão é o MESMO da landing (`app/captura/registro.py`):
não sobrescreve dado, congela o primeiro toque, publica `form_submitted` com o
`form_id` (a jornada filtra por ele, como filtra a landing pela página).
"""

import json
import logging
import re
import time
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import HTMLResponse, JSONResponse

from app.captura.campos import higienizar
from app.captura.canal import canal_do_toque
from app.captura.email import validar_dominio
from app.captura.mapa import mapear
from app.captura.registro import (
    Consentimento, Origem, ip_do_pedido, registrar_captura,
)
from app.config import settings
from app.database import sessao

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/publico", tags=["rastreio"])

CORPO_MAXIMO = 16 * 1024
VISITOR_ID_MAXIMO = 64
FORM_ID_MAXIMO = 120
CAMPOS_MAXIMO = 60
VALOR_MAXIMO = 2000
URL_MAXIMA = 2000
TEXTO_MAXIMO = 500
UTMS = ("utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content")

# A base legal do formulário do site, que não tem caixa de consentimento:
# a pessoa pediu contato (spec 4.3; pergunta ao Nicholson junto do D3).
CONSENTIMENTO_DO_SITE = dict(
    base_legal="legitimo_interesse_pedido_contato",
    texto="Formulário do site sem caixa de consentimento: a pessoa pediu contato.",
    versao="provisoria-2026-10", provisoria=True)

_HOSTS_LOCAIS = frozenset({"localhost", "127.0.0.1"})


# ── Origem ───────────────────────────────────────────────────────────────────

def origem_permitida(origin: str | None, dominios: list[str]) -> bool:
    """O `Origin` casa EXATO com um domínio do site (sem caixa).

    `https` sempre; `http` só para `localhost`/`127.0.0.1` (a página de teste
    local). Domínio cadastrado com porta (`localhost:8099`) exige a porta;
    sem porta, vale qualquer uma.
    """
    if not isinstance(origin, str) or not origin.strip() or origin.strip() == "null":
        return False
    try:
        partes = urlsplit(origin.strip())
        host = (partes.hostname or "").lower()
        porta = partes.port
    except ValueError:
        return False
    if not host:
        return False
    esquema = partes.scheme.lower()
    if esquema != "https" and not (esquema == "http" and host in _HOSTS_LOCAIS):
        return False
    com_porta = f"{host}:{porta}" if porta else host
    for dominio in dominios or []:
        d = str(dominio).strip().lower()
        if d == com_porta or (":" not in d and d == host):
            return True
    return False


def _origem_do_frontend() -> str:
    partes = urlsplit(settings.FRONTEND_URL)
    return f"{partes.scheme}://{partes.netloc}".lower()


# ── Cache token → site ───────────────────────────────────────────────────────
# Como o de `landing.py`: a visita chega a cada carregamento de página do site
# inteiro, e uma ida ao banco por visita só para achar o site é desperdício.
# Rotacionar o token ou desligar o site limpa este cache (`routers/sites.py`);
# em outro processo, vale em até 60 s.
#
# ⚠️ A rota é anônima: quem quiser manda um token inventado por pedido. Por
# isso (revisão de segurança, 21/10): (1) o FORMATO exato do gerador
# (`routers/sites.py::_novo_token` = `pub_` + `token_urlsafe(24)`, 32
# caracteres base64url) é conferido antes de tocar no cache ou no banco;
# (2) resultado NEGATIVO não é guardado — senão cada token inventado viraria
# uma entrada; (3) o cache tem teto (`CACHE_MAXIMO`), despeja a entrada mais
# antiga e descarta a expirada na leitura. Token bem formado e inexistente
# custa uma consulta, dentro do balde de limite da rota.
TTL_SEGUNDOS = 60
CACHE_MAXIMO = 256
FORMATO_DO_TOKEN = re.compile(r"pub_[A-Za-z0-9_-]{32}")  # fullmatch: com `$`, uma quebra de linha no fim passaria
_cache: dict[str, tuple[dict, float]] = {}


def _limpar_cache() -> None:
    _cache.clear()


async def _site_do_token(token) -> dict | None:
    if not isinstance(token, str) or not FORMATO_DO_TOKEN.fullmatch(token):
        return None
    em_cache = _cache.get(token)
    if em_cache:
        if em_cache[1] > time.monotonic():
            return em_cache[0]
        del _cache[token]
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            "SELECT id::text, nome, dominios, mapa_campos, tags FROM sites "
            "WHERE token = $1 AND ativo", token)
    if linha is None:
        return None
    site = dict(linha)
    while len(_cache) >= CACHE_MAXIMO:
        # O dict guarda a ordem de inserção: o primeiro é o mais antigo.
        del _cache[next(iter(_cache))]
    _cache[token] = (site, time.monotonic() + TTL_SEGUNDOS)
    return site


# ── Corpo ────────────────────────────────────────────────────────────────────

async def _ler_corpo(request: Request) -> dict:
    """O corpo, sem nunca ler mais que `CORPO_MAXIMO` + 1 pedaço.

    ⚠️ `await request.body()` lê TUDO antes de medir: um POST anônimo de
    centenas de MB ocupava memória antes do 413. Agora o `Content-Length`
    declarado acima do teto é recusado sem ler nada, e sem ele (chunked) a
    leitura para assim que passa do teto.
    """
    declarado = request.headers.get("content-length")
    if declarado is not None:
        try:
            tamanho = int(declarado)
        except ValueError:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Content-Length inválido.")
        if tamanho > CORPO_MAXIMO:
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Corpo grande demais.")
    corpo = bytearray()
    async for pedaco in request.stream():
        corpo += pedaco
        if len(corpo) > CORPO_MAXIMO:
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Corpo grande demais.")
    corpo = bytes(corpo)
    try:
        dados = json.loads(corpo or b"null")
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Corpo inválido.")
    if not isinstance(dados, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Corpo inválido.")
    return dados


def _texto(valor, limite: int) -> str | None:
    if not isinstance(valor, str):
        return None
    valor = valor.strip()
    return valor[:limite] if valor else None


def _visitante(valor) -> str | None:
    v = _texto(valor, VISITOR_ID_MAXIMO + 1)
    return v if v and len(v) <= VISITOR_ID_MAXIMO else None


def _utm(bloco) -> dict:
    """Os UTMs de um toque (`{utm: {...}}` ou o próprio dicionário)."""
    if not isinstance(bloco, dict):
        return {}
    return {k: v for k, v in higienizar(bloco).items() if k in UTMS}


def _toque(dados) -> dict:
    """Um toque do script: `{utm, gclid, fbclid, referrer, url}`."""
    if not isinstance(dados, dict):
        return {"utm": {}, "gclid": None, "fbclid": None, "referrer": None}
    return {"utm": _utm(dados.get("utm")), "gclid": _texto(dados.get("gclid"), TEXTO_MAXIMO),
            "fbclid": _texto(dados.get("fbclid"), TEXTO_MAXIMO),
            "referrer": _texto(dados.get("referrer"), URL_MAXIMA)}


def _canal(toque: dict, host: str | None) -> str:
    return canal_do_toque(
        utm_source=toque["utm"].get("utm_source"), utm_medium=toque["utm"].get("utm_medium"),
        referrer=toque["referrer"], gclid=toque["gclid"], fbclid=toque["fbclid"],
        host_da_pagina=host)


def _caminho(url: str | None) -> str | None:
    if not url:
        return None
    try:
        return (urlsplit(url).path or "/")[:TEXTO_MAXIMO]
    except ValueError:
        return None


def _host(origin: str | None) -> str | None:
    try:
        return urlsplit(origin or "").hostname
    except ValueError:
        return None


def _aceito() -> JSONResponse:
    # Uma resposta NOVA por pedido: o middleware de CORS põe cabeçalho nela.
    return JSONResponse({"ok": True}, status_code=status.HTTP_202_ACCEPTED)

PROIBIDO = "Origem não permitida."


@router.post("/site/visita", status_code=status.HTTP_202_ACCEPTED)
async def visita(request: Request):
    """Uma visita por carregamento de página, do site (`token`) ou da landing
    (`pagina`). Balde de limite próprio (`LIMITE_VISITA_POR_MINUTO`)."""
    dados = await _ler_corpo(request)
    origin = request.headers.get("origin")
    site_id = page_slug = None
    if dados.get("token") is not None:
        site = await _site_do_token(dados.get("token"))
        if site is None or not origem_permitida(origin, site["dominios"]):
            raise HTTPException(status.HTTP_403_FORBIDDEN, PROIBIDO)
        site_id = site["id"]
    else:
        slug = _texto(dados.get("pagina"), 200)
        if not slug or (origin or "").strip().lower() != _origem_do_frontend():
            raise HTTPException(status.HTTP_403_FORBIDDEN, PROIBIDO)
        async with sessao(role="service_role") as conn:
            if not await conn.fetchval(
                    "SELECT 1 FROM pages WHERE slug = $1 AND status = 'active'", slug):
                raise HTTPException(status.HTTP_403_FORBIDDEN, PROIBIDO)
        page_slug = slug

    visitante = _visitante(dados.get("visitor_id"))
    if not visitante:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Visitante inválido.")
    toque = _toque(dados)
    url = _texto(dados.get("url"), URL_MAXIMA)
    primeiro = dados.get("primeiro_toque")
    async with sessao(role="service_role") as conn:
        await conn.execute(
            """INSERT INTO visitas (visitor_id, site_id, page_slug, url, path, titulo,
                                    referrer, utm_source, utm_medium, utm_campaign,
                                    utm_term, utm_content, gclid, fbclid, canal,
                                    primeiro_toque)
               VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                       $14, $15, $16::jsonb)""",
            visitante, site_id, page_slug, url, _caminho(url),
            _texto(dados.get("titulo"), 300), toque["referrer"],
            *(toque["utm"].get(u) for u in UTMS), toque["gclid"], toque["fbclid"],
            _canal(toque, _host(origin)),
            primeiro if isinstance(primeiro, dict) else None)
    return _aceito()


@router.post("/site/conversao", status_code=status.HTTP_202_ACCEPTED)
async def conversao(request: Request):
    """A conversão de um formulário do site cadastrado.

    UTMs do PRIMEIRO toque no contato (o bloco congelado da captura) e do
    TOQUE (último) na conversão. Sem campo-isca: o formulário é do site, não
    nosso — não há onde pôr a isca."""
    dados = await _ler_corpo(request)
    site = await _site_do_token(dados.get("token"))
    origin = request.headers.get("origin")
    if site is None or not origem_permitida(origin, site["dominios"]):
        raise HTTPException(status.HTTP_403_FORBIDDEN, PROIBIDO)

    brutos = dados.get("campos")
    brutos = dict(list(brutos.items())[:CAMPOS_MAXIMO]) if isinstance(brutos, dict) else {}
    brutos = {k: v[:VALOR_MAXIMO] for k, v in brutos.items()
              if isinstance(k, str) and isinstance(v, str)}
    email, colunas, extras = mapear(brutos, site["mapa_campos"] or {})
    email = (email or "").strip().lower()
    if not email or len(email) > 320:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "E-mail ausente ou inválido.")
    valido, motivo = await validar_dominio(email)
    if not valido:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, motivo or "E-mail inválido.")

    toque = _toque(dados.get("toque"))
    primeiro = _toque(dados.get("primeiro_toque"))
    url = _texto(dados.get("url"), URL_MAXIMA)
    form_id = _texto(dados.get("form_id"), FORM_ID_MAXIMO) or (_caminho(url) or "/") + "#form"
    origem = Origem(form_id=form_id, site_id=site["id"], page_url=url,
                    page_path=_caminho(url), visitor_id=_visitante(dados.get("visitor_id")),
                    canal=_canal(toque, _host(origin)))
    consentimento = Consentimento(**CONSENTIMENTO_DO_SITE, ip=ip_do_pedido(request),
                                  user_agent=request.headers.get("user-agent"))

    async with sessao(role="service_role") as conn:
        await registrar_captura(
            conn, email=email, campos={**colunas, **primeiro["utm"]}, extras=extras,
            origem=origem, session_id=None, consentimento=consentimento,
            tags=list(site["tags"] or []), utm_da_conversao=toque["utm"],
            canal_origem="site")
    return _aceito()


@router.post("/prova/recebido", response_class=HTMLResponse)
async def recebido():
    """O `action` do formulário da página de teste (prova do RD): só responde
    "Recebido." — faz o papel do `contato.cfm` do site sem mandar e-mail a
    ninguém. Desligado (404) fora da prova."""
    if not settings.PROVA_RECEPTOR_TESTE:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not Found")
    return HTMLResponse(
        "<!doctype html><html lang=\"pt-BR\"><head><meta charset=\"utf-8\">"
        "<title>Recebido</title></head><body><p>Recebido.</p></body></html>")
