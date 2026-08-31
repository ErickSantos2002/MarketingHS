import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.auth.router import router as auth_router
from app.database import close_db, init_db
from app.middleware.limite_taxa import LimiteTaxaMiddleware
from app.routers.configuracao import router as configuracao_router
from app.routers.contatos import router as contatos_router
from app.routers.escrita_contatos import router as escrita_contatos_router
from app.routers.leitura_contatos import router as leitura_contatos_router
from app.routers.usuarios import router as usuarios_router

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def ciclo_de_vida(app: FastAPI):
    await init_db()
    yield
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
