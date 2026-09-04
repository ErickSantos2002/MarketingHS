import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.auth.router import router as auth_router
from app.database import close_datacore, close_db, init_datacore, init_db
from app.middleware.limite_taxa import LimiteTaxaMiddleware
from app.routers.automacoes import router as automacoes_router
from app.routers.campanhas import router as campanhas_router
from app.routers.envio import router as envio_router
from app.routers.chaves import router as chaves_router
from app.routers.configuracao import router as configuracao_router
from app.routers.contatos import router as contatos_router
from app.routers.datacore import router as datacore_router
from app.routers.escrita_contatos import router as escrita_contatos_router
from app.routers.ia import router as ia_router
from app.routers.imagens import router as imagens_router
from app.routers.jornadas import router as jornadas_router
from app.routers.leitura_contatos import router as leitura_contatos_router
from app.routers.painel import router as painel_router
from app.routers.publico import router as publico_router
from app.routers.webhook import router as webhook_router
from app.routers.segmentos import router as segmentos_router
from app.routers.templates import router as templates_router
from app.routers.usuarios import router as usuarios_router

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def ciclo_de_vida(app: FastAPI):
    await init_db()
    await init_datacore()
    yield
    await close_datacore()
    await close_db()


app = FastAPI(title="MarketingHS", lifespan=ciclo_de_vida)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Prefixos públicos. Cresce conforme os lotes 3 e 7 trouxerem as rotas de
# captura, descadastro, webhook e A/B.
app.add_middleware(
    LimiteTaxaMiddleware,
    por_minuto=settings.LIMITE_PUBLICO_POR_MINUTO,
    prefixos=("/publico", "/auth/login"),
    # ⚠️ O webhook do Resend vem de poucos IPs e uma campanha de mil e-mails
    # gera milhares de eventos em minutos. Limitá-lo faria o provedor levar 429
    # e re-tentar cada evento por 10 horas. Ele se autentica por assinatura
    # Svix — ver o cabeçalho do middleware.
    isentos=("/publico/webhook/",),
)


@app.exception_handler(RuntimeError)
async def banco_indisponivel(request: Request, exc: RuntimeError):
    """A `sessao()` levanta RuntimeError quando o pool não subiu. Sem este
    handler viraria 500 — e 500 diz "o servidor tem um bug", quando a verdade
    é "o banco não está de pé". A diferença importa para quem depura."""
    if str(exc) == "banco indisponível":
        return JSONResponse({"detail": "Banco de dados indisponível."}, status_code=503)
    raise exc


@app.get("/health")
async def health():
    return {"ok": True}


app.include_router(auth_router)
app.include_router(usuarios_router)
app.include_router(contatos_router)
app.include_router(configuracao_router)
app.include_router(leitura_contatos_router)
app.include_router(escrita_contatos_router)
app.include_router(chaves_router)
app.include_router(segmentos_router)
app.include_router(templates_router)
app.include_router(campanhas_router)
app.include_router(envio_router)
app.include_router(jornadas_router)
app.include_router(automacoes_router)
app.include_router(datacore_router)
app.include_router(ia_router)
app.include_router(imagens_router)
app.include_router(painel_router)
app.include_router(publico_router)
app.include_router(webhook_router)
