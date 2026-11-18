"""Configuração do aviso de lead: quem recebe e se está ligado.

Mora em `integration_secrets` (editável no card "Aviso de lead" da tela de
Configurações): `AVISO_LEAD_PARA` (endereços separados por vírgula) e
`AVISO_LEAD_LIGADO` (`"0"` desliga; qualquer outro valor, ou ausente, liga).
"""

from dataclasses import dataclass

from app import integracoes

PARA_PADRAO = ["vendas@healthsafetytech.com"]


@dataclass(frozen=True)
class ConfigAviso:
    ligado: bool
    para: list[str]


def separar_enderecos(texto: str | None) -> list[str]:
    """Separa por vírgula, tira espaço e vazio, e descarta repetido (sem
    diferenciar maiúscula; vale a primeira grafia)."""
    vistos: set[str] = set()
    saida: list[str] = []
    for parte in (texto or "").split(","):
        endereco = parte.strip()
        if not endereco or endereco.lower() in vistos:
            continue
        vistos.add(endereco.lower())
        saida.append(endereco)
    return saida


async def ler_config() -> ConfigAviso:
    ligado = await integracoes.ler_segredo("AVISO_LEAD_LIGADO")
    para = separar_enderecos(await integracoes.ler_segredo("AVISO_LEAD_PARA"))
    return ConfigAviso(ligado=ligado != "0", para=para or list(PARA_PADRAO))
