import json
import logging
from contextlib import asynccontextmanager
from typing import Optional

import asyncpg

from app.config import settings

logger = logging.getLogger(__name__)

_pool: Optional[asyncpg.Pool] = None


async def _preparar_conexao(conn: asyncpg.Connection) -> None:
    await conn.set_type_codec("jsonb", encoder=json.dumps, decoder=json.loads,
                              schema="pg_catalog")
    await conn.set_type_codec("json", encoder=json.dumps, decoder=json.loads,
                              schema="pg_catalog")


async def init_db() -> None:
    """Sem DATABASE_URL a API sobe mesmo assim e os endpoints de dado respondem
    503. Mantém /health e /docs utilizáveis durante a portagem."""
    global _pool
    if not settings.DATABASE_URL:
        logger.warning("DATABASE_URL vazio — subindo sem banco.")
        return
    try:
        _pool = await asyncpg.create_pool(
            settings.DATABASE_URL, min_size=2, max_size=10, setup=_preparar_conexao
        )
    except Exception as exc:  # noqa: BLE001 — falha de banco não derruba o processo
        logger.error("Falha ao conectar no Postgres: %s", exc)


async def close_db() -> None:
    if _pool:
        await _pool.close()


# SET LOCAL ROLE não aceita parâmetro — o nome vai concatenado na query, então
# nunca pode vir de entrada do usuário. Daí a lista fechada.
PAPEIS = frozenset({"anon", "authenticated", "service_role"})


@asynccontextmanager
async def sessao(role: str = "anon", user_id: str | None = None):
    """Conexão em transação, com o contexto de RLS já aplicado.

    Toda query de dado passa por aqui. O backend conecta como marketinghs_app,
    NOINHERIT e sem privilégio em public: sem o SET LOCAL ROLE a query falha
    com permissão negada em vez de rodar sem contexto de usuário.

    role="service_role" tem BYPASSRLS — só para operação interna (bootstrap,
    job agendado), nunca para request de usuário.
    """
    if role not in PAPEIS:
        raise ValueError(f"papel inválido: {role!r}")
    if _pool is None:
        raise RuntimeError("banco indisponível")

    async with _pool.acquire() as conn:
        async with conn.transaction():
            # is_local=true equivale a SET LOCAL: reverte no fim da transação,
            # então a conexão volta limpa para o pool.
            await conn.execute(
                "SELECT set_config('app.current_user_id', $1, true)", str(user_id or "")
            )
            await conn.execute(f"SET LOCAL ROLE {role}")
            yield conn
