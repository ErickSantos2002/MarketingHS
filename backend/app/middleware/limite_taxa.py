"""Limite de taxa da borda pública.

lead-capture, email-unsubscribe, resend-webhook, ab-events e /go são públicos
por desenho — é a landing page chamando, sem autenticação. No Supabase o
gateway fazia alguma contenção; o FastAPI não faz nenhuma. Sem isto, qualquer
um enche a base de leads.

Janela deslizante em memória. É por processo, não distribuído: com uma réplica
basta, e trocar por Redis depois não muda a interface.

⚠️ ISENÇÕES. O webhook do Resend fica sob `/publico` mas NÃO pode ser limitado:
ele vem de um punhado de IPs e uma campanha de mil e-mails gera milhares de
eventos em poucos minutos. Com o teto de 30/min o provedor levaria 429 e
re-tentaria cada evento por até 10 horas — o cenário que a idempotência do
webhook existe para evitar, causado por nós mesmos.

Ele não fica desprotegido: a assinatura Svix é a autenticação dele, e uma
requisição sem assinatura válida morre em 401 antes de tocar o banco.
"""

import time
from collections import defaultdict, deque

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware


class LimiteTaxaMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, por_minuto: int, prefixos: tuple[str, ...],
                 isentos: tuple[str, ...] = ()):
        super().__init__(app)
        self.por_minuto = por_minuto
        self.prefixos = prefixos
        self.isentos = isentos
        self._historico: dict[str, deque] = defaultdict(deque)

    def _cliente(self, request: Request) -> str:
        # Atrás do nginx da VPS o IP real vem no X-Forwarded-For.
        encaminhado = request.headers.get("x-forwarded-for")
        if encaminhado:
            return encaminhado.split(",")[0].strip()
        return request.client.host if request.client else "desconhecido"

    async def dispatch(self, request: Request, call_next):
        if self.isentos and request.url.path.startswith(self.isentos):
            return await call_next(request)
        if not request.url.path.startswith(self.prefixos):
            return await call_next(request)

        agora = time.monotonic()
        marcas = self._historico[self._cliente(request)]
        while marcas and agora - marcas[0] > 60:
            marcas.popleft()

        if len(marcas) >= self.por_minuto:
            return JSONResponse(
                {"detail": "Muitas requisições. Tente novamente em um minuto."},
                status_code=429,
                headers={"Retry-After": "60"},
            )

        marcas.append(agora)
        return await call_next(request)
