"""A fila do aviso de lead: a captura enfileira, o worker envia (Task 2)."""

import logging
from datetime import timedelta

from app.avisos import config as config_aviso

logger = logging.getLogger(__name__)

# Dá tempo ao enriquecimento e ao agendamento de terminarem antes do e-mail.
ATRASO_INICIAL = timedelta(seconds=60)

# ⚠️ Constante, não literal inline, só para o teste forçar uma falha DE BANCO
# real (trocando a tabela por uma que não existe) e provar que o SAVEPOINT
# recupera a transação da captura.
SQL_ENFILEIRAR = (
    "INSERT INTO avisos_de_lead (conversao_id, lead_id, contato_novo, agendamento, "
    "visivel_em) VALUES ($1::uuid, $2::uuid, $3, $4, now() + $5) "
    "ON CONFLICT (conversao_id) DO NOTHING"
)


async def enfileirar(conn, *, conversao_id: str, lead_id: str, contato_novo: bool,
                     agendamento: bool) -> None:
    """Põe o aviso da conversão na fila. ⚠️ NUNCA levanta: nenhum caminho de
    falha do aviso pode recusar um lead real. O INSERT roda num SAVEPOINT para
    que um erro de banco não aborte a transação da captura."""
    try:
        if not (await config_aviso.ler_config()).ligado:
            return
        async with conn.transaction():
            await conn.execute(SQL_ENFILEIRAR, conversao_id, lead_id, contato_novo,
                               agendamento, ATRASO_INICIAL)
    except Exception:  # noqa: BLE001 — o aviso é secundário à captura
        logger.error("[aviso-de-lead] não enfileirou a conversão %s", conversao_id,
                     exc_info=True)
