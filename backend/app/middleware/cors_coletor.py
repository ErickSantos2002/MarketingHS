"""CORS só do coletor do A/B.

O `CORSMiddleware` global aceita apenas o `FRONTEND_URL`, e responde 400 ao
preflight de qualquer outra origem. O coletor é chamado pelas landing pages,
em outro domínio — e quem manda `application/json` (o agendamento, por
exemplo) dispara preflight.

`*` é seguro aqui: a rota não lê credencial nem devolve dado — só `accepted`.

⚠️ Precisa ser o middleware MAIS DE FORA (registrado por último em
`main.py`): o Starlette executa do último registrado para o primeiro, e o
preflight tem de ser respondido antes do `CORSMiddleware` recusá-lo.
"""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

_CABECALHOS = {"Access-Control-Allow-Origin": "*",
               "Access-Control-Allow-Methods": "POST, OPTIONS",
               "Access-Control-Allow-Headers": "content-type",
               "Access-Control-Max-Age": "86400"}


class CorsDoColetorMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, caminho: str):
        super().__init__(app)
        self.caminho = caminho

    async def dispatch(self, request: Request, call_next):
        if request.url.path != self.caminho:
            return await call_next(request)
        if request.method == "OPTIONS":
            return Response(status_code=204, headers=_CABECALHOS)
        resposta = await call_next(request)
        # M5: quando a Origin bate com o FRONTEND_URL, o CORSMiddleware
        # global (mais interno) já pôs `Allow-Credentials: true` na resposta.
        # ACAO `*` + `Allow-Credentials: true` é combinação inválida — o
        # navegador descarta a resposta inteira. A rota não lê cookie nem
        # credencial nenhuma, então o header sai.
        if "access-control-allow-credentials" in resposta.headers:
            del resposta.headers["access-control-allow-credentials"]
        resposta.headers.update(_CABECALHOS)
        return resposta
