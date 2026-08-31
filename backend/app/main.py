import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import close_db, init_db

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


@app.get("/health")
async def health():
    return {"ok": True}
