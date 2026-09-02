"""Sincronização com o DataCore (Tiny ERP). Mão única: só lemos de lá.

⚠️ Admin em tudo: a carga mexe na base de contatos inteira.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, status

from app.config import settings
from app.database import sessao, sessao_datacore
from app.dependencies import Usuario, admin_atual
from app.dominio.datacore import clientes_do_datacore
from app.dominio.sincronizacao_datacore import sincronizar

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/datacore", tags=["datacore"])


def _exigir_datacore() -> None:
    if not settings.DATACORE_URL:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "DATACORE_URL não configurada — a sincronização está desligada.")


@router.get("/previa")
async def previa(_: Usuario = Depends(admin_atual)):
    """Quantos clientes o ERP tem, quantos são alcançáveis, quantos já entraram.

    ⚠️ Devolve os DOIS números de alcance — com e sem varrer nota fiscal — para
    que ligar `DATACORE_EMAIL_DE_NOTAS` seja uma decisão informada e não uma
    surpresa depois da carga.
    """
    _exigir_datacore()
    try:
        async with sessao_datacore() as dc:
            so_cadastro = await clientes_do_datacore(dc, com_email_de_notas=False)
            com_notas = await clientes_do_datacore(dc, com_email_de_notas=True)
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc))

    async with sessao(role="service_role") as conn:
        ja = await conn.fetchval(
            """SELECT count(*) FROM ecosystem_identities
                WHERE datacore_cliente_id IS NOT NULL""")

    return {
        "total": len(so_cadastro),
        "com_email_cadastro": sum(1 for c in so_cadastro if c.email),
        "com_email_incluindo_notas": sum(1 for c in com_notas if c.email),
        "email_de_notas_ligado": settings.DATACORE_EMAIL_DE_NOTAS,
        "ja_importados": ja,
    }


@router.post("/sincronizar")
async def executar(_: Usuario = Depends(admin_atual)):
    """Puxa o ERP inteiro e grava. Idempotente: rodar de novo atualiza.

    ⚠️ Nada é escrito no DataCore. A pool de lá é `read_only` no servidor, não
    só por convenção.
    """
    _exigir_datacore()
    try:
        async with sessao_datacore() as dc:
            clientes = await clientes_do_datacore(
                dc, com_email_de_notas=settings.DATACORE_EMAIL_DE_NOTAS)
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc))

    async with sessao(role="service_role") as conn:
        resumo = await sincronizar(conn, clientes)

    logger.info("DataCore: %d criados, %d atualizados, %d erros",
                resumo.criados, resumo.atualizados, len(resumo.erros))
    return {
        "criados": resumo.criados,
        "atualizados": resumo.atualizados,
        "sem_email": resumo.sem_email,
        "colisoes_de_email": resumo.colisoes_de_email,
        # Os 20 primeiros bastam para diagnosticar; o total diz se foi ponta ou
        # se a carga inteira azedou.
        "erros": resumo.erros[:20],
        "total_de_erros": len(resumo.erros),
    }
