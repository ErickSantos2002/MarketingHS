import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.auth.router import router as auth_router
from app.database import close_db, init_db
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
