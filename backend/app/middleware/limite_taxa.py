"""Limite de taxa da borda pública.

lead-capture, email-unsubscribe, resend-webhook, ab-events e /go são públicos
por desenho — é a landing page chamando, sem autenticação. No Supabase o
gateway fazia alguma contenção; o FastAPI não faz nenhuma. Sem isto, qualquer
um enche a base de leads.

Janela deslizante em memória. É por processo, não distribuído: com uma réplica
basta, e trocar por Redis depois não muda a interface.
"""

import time
from collections import defaultdict, deque

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware


class LimiteTaxaMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, por_minuto: int, prefixos: tuple[str, ...]):
        super().__init__(app)
        self.por_minuto = por_minuto
        self.prefixos = prefixos
        self._historico: dict[str, deque] = defaultdict(deque)

    def _cliente(self, request: Request) -> str:
        # Atrás do nginx da VPS o IP real vem no X-Forwarded-For.
        encaminhado = request.headers.get("x-forwarded-for")
        if encaminhado:
            return encaminhado.split(",")[0].strip()
        return request.client.host if request.client else "desconhecido"

    async def dispatch(self, request: Request, call_next):
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
