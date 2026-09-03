"""Segredos de integração — o que o `supabase_vault` guardava.

Portado de `_shared/secrets.ts`, com a mesma ordem de leitura: **banco
primeiro, ambiente como rede de segurança**. O banco vem primeiro porque é a
fonte que dá para rotacionar sem mexer em deploy; o ambiente fica para a
instalação que ainda não gravou o segredo.

Mesmo desenho do `integracoes.py` do HS.OS, que já roda em produção.

⚠️ NUNCA levanta. Falha de leitura no banco cai para o ambiente. Se esta função
lançasse, uma indisponibilidade momentânea do banco derrubaria o envio inteiro —
e, no caso do UNSUBSCRIBE_SECRET, faria todo descadastro dar 401 em silêncio.

⚠️ As duas pontas do HMAC de descadastro (o worker que assina e o endpoint que
verifica) TÊM de passar por aqui. Ler de fontes diferentes é o defeito que o
comentário do `_shared/secrets.ts` descreve em detalhe: as duas metades
calculariam MACs diferentes e todo descadastro passaria a dar 401.
"""

import logging
import os
import time

from app.database import sessao

logger = logging.getLogger(__name__)

# 60s: curto o bastante para uma rotação aparecer rápido, longo o bastante para
# não consultar o banco a cada destinatário de uma campanha de 5.000.
_TTL = 60
_cache: dict[str, tuple[str | None, float]] = {}


async def ler_segredo(nome: str) -> str | None:
    """O valor do segredo, ou `None` se não existir em lugar nenhum."""
    agora = time.monotonic()
    guardado = _cache.get(nome)
    if guardado and agora - guardado[1] < _TTL:
        return guardado[0]

    valor: str | None = None
    try:
        async with sessao(role="service_role") as conn:
            valor = await conn.fetchval(
                "SELECT value FROM public.integration_secrets WHERE name = $1", nome)
    except Exception as e:  # noqa: BLE001 — degradar, não interromper
        logger.warning("Não foi possível ler o segredo %s do banco: %s", nome, e)

    if not valor:
        valor = os.environ.get(nome) or None

    _cache[nome] = (valor, agora)
    return valor


async def gravar_segredo(nome: str, valor: str) -> None:
    """Grava e invalida o cache, para a rotação valer na hora."""
    async with sessao(role="service_role") as conn:
        await conn.execute(
            """INSERT INTO public.integration_secrets (name, value, updated_at)
               VALUES ($1, $2, now())
               ON CONFLICT (name) DO UPDATE
                   SET value = EXCLUDED.value, updated_at = now()""",
            nome, valor)
    esquecer(nome)


def esquecer(nome: str) -> None:
    """Descarta o cache de um segredo. Chamado depois de gravar um valor novo,
    para a rotação valer na hora em vez de esperar o TTL."""
    _cache.pop(nome, None)


async def apagar_segredo(nome: str) -> bool:
    """Remove o segredo e invalida o cache. Devolve se havia algo para remover.

    ⚠️ Apagar do banco NÃO garante que o segredo sumiu: `ler_segredo` cai para
    `os.environ` em seguida. É o comportamento certo — a instalação que ainda
    usa ambiente continua funcionando — mas quem chama precisa saber, para não
    dizer ao usuário que removeu quando o valor do ambiente segue valendo.
    """
    async with sessao(role="service_role") as conn:
        resultado = await conn.execute(
            "DELETE FROM public.integration_secrets WHERE name = $1", nome)
    esquecer(nome)
    return resultado != "DELETE 0"
