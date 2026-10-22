"""CORS das rotas do `rastreio.js` (`/publico/site/*`, prova do RD).

O `CORSMiddleware` global só aceita o `FRONTEND_URL` e responde 400 ao
preflight de qualquer outra origem. O script roda no site cadastrado — outro
domínio. O `sendBeacon` com `text/plain` não faz preflight, mas o recuo
(`fetch`) e qualquer integrador que mande `application/json` fazem.

A regra: `Access-Control-Allow-Origin` = a própria origem, com `Vary:
Origin`, **só** se ela é de um site ATIVO (ou o `FRONTEND_URL`, a landing).
Nunca `*` — ao contrário do coletor do A/B, estas rotas gravam lead — e nunca
`Allow-Credentials`: nada aqui lê cookie. Origem fora da lista responde sem
ACAO, e o navegador bloqueia; a rota ainda recusa com 403 por conta própria
(o CORS é só a parte do navegador).

⚠️ Precisa ser o middleware MAIS DE FORA (registrado por último em
`main.py`): o preflight tem de ser respondido antes do `CORSMiddleware`
recusá-lo, e a resposta 429 do limite também tem de levar o cabeçalho.

Cache de 60 s dos domínios ativos, recarregado de `sites`.
"""

import logging
import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.database import sessao

logger = logging.getLogger(__name__)

TTL_SEGUNDOS = 60
_cache: dict = {"dominios": None, "expira": 0.0}


def _limpar_cache() -> None:
    _cache.update(dominios=None, expira=0.0)


async def _dominios_ativos() -> list[str]:
    if _cache["dominios"] is not None and _cache["expira"] > time.monotonic():
        return _cache["dominios"]
    try:
        async with sessao(role="service_role") as conn:
            linhas = await conn.fetch("SELECT dominios FROM sites WHERE ativo")
        dominios = sorted({d for l in linhas for d in (l["dominios"] or [])})
    except Exception as exc:  # noqa: BLE001 — banco fora: sem CORS, nunca 500 no site
        logger.warning("cors dos sites: domínios não carregados: %s", exc)
        return []
    _cache.update(dominios=dominios, expira=time.monotonic() + TTL_SEGUNDOS)
    return dominios


class CorsDosSitesMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, prefixo: str = "/publico/site/"):
        super().__init__(app)
        self.prefixo = prefixo

    async def _permitida(self, origin: str | None) -> bool:
        from app.routers.rastreio import _origem_do_frontend, origem_permitida
        if not origin:
            return False
        if origin.strip().lower() == _origem_do_frontend():
            return True
        return origem_permitida(origin, await _dominios_ativos())

    async def dispatch(self, request: Request, call_next):
        if not request.url.path.startswith(self.prefixo):
            return await call_next(request)
        origin = request.headers.get("origin")
        permitida = await self._permitida(origin)
        cabecalhos = {"Vary": "Origin"}
        if permitida:
            cabecalhos.update({
                "Access-Control-Allow-Origin": origin,
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "content-type",
                "Access-Control-Max-Age": "600",
            })
        if request.method == "OPTIONS":
            return Response(status_code=204, headers=cabecalhos)
        resposta = await call_next(request)
        # O `CORSMiddleware` global (mais interno) pode ter posto ACAO e
        # `Allow-Credentials` para o FRONTEND_URL. Quem decide aqui é esta
        # camada: tira os dois e põe (ou não) o daqui.
        for nome in ("access-control-allow-origin", "access-control-allow-credentials"):
            if nome in resposta.headers:
                del resposta.headers[nome]
        resposta.headers.update(cabecalhos)
        return resposta
