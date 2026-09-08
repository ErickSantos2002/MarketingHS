"""Validação de domínio de e-mail na captura pública.

⚠️ ***Fail-open* por decisão, não por descuido.** Erro de resolver, tempo
esgotado ou exceção inesperada devolvem VÁLIDO. A regra da spec é que nenhum
caminho de falha nosso pode recusar um lead real: uma instabilidade de DNS
recusando lead é invisível — o formulário diz "e-mail inválido", a pessoa vai
embora, e ninguém descobre.

O que é recusado, portanto, é só o que temos certeza: formato quebrado,
descartável conhecido, e domínio que o resolver respondeu NÃO TER como receber
e-mail.

⚠️ **E-mail gratuito (gmail, hotmail) NUNCA é recusado.** Na base da HS —
siderúrgica, mineradora, transporte — o corporativo é a norma, mas
transportadora pequena usa gmail de verdade. O sinal, se importar, vira
pontuação na régua de Configurações → Lead Scoring.
"""

import asyncio
import logging
import re
import time

import dns.asyncresolver
import dns.exception
# ⚠️ Explícito: o código abaixo usa `dns.resolver.NoAnswer` e
# `dns.resolver.NXDOMAIN`. O `dns.asyncresolver` importa o `dns.resolver` por
# dentro, então sem esta linha o atributo até resolve — por acidente. Depender
# disso quebra no dia em que a biblioteca reorganizar os módulos.
import dns.resolver

logger = logging.getLogger(__name__)

# Lista herdada da function `validate-email-domain`, ao pé da letra.
DESCARTAVEIS = frozenset({
    "mailinator.com", "tempmail.com", "10minutemail.com", "guerrillamail.com",
    "yopmail.com", "trashmail.com", "throwawaymail.com", "sharklasers.com",
    "getnada.com", "dispostable.com", "maildrop.cc", "fakeinbox.com",
    "tempail.com", "temp-mail.org", "temp-mail.io", "discard.email",
})

# Mesma regex prática da origem: local@domínio.tld, TLD com 2+ caracteres.
_FORMATO = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")

TTL_SEGUNDOS = 3600
TEMPO_LIMITE = 2.5

# domínio -> (valido, motivo, expira_em)
_cache: dict[str, tuple[bool, str | None, float]] = {}


def _limpar_cache() -> None:
    """Só para os testes. Cache de processo não tem invalidação em produção —
    o TTL de uma hora é a invalidação."""
    _cache.clear()


def formato_ok(email: str) -> bool:
    return bool(_FORMATO.match(email or ""))


async def _tem_mx(dominio: str) -> bool:
    """MX, com A como plano B — há domínio que recebe e-mail sem MX.

    Levanta em falha de rede; quem chama trata como *fail-open*.
    """
    resolver = dns.asyncresolver.Resolver()
    resolver.lifetime = TEMPO_LIMITE
    try:
        resposta = await resolver.resolve(dominio, "MX")
        if len(resposta) > 0:
            return True
    except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN):
        pass
    try:
        resposta = await resolver.resolve(dominio, "A")
        return len(resposta) > 0
    except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN):
        return False


async def validar_dominio(email: str) -> tuple[bool, str | None]:
    """`(valido, motivo)`. `motivo` é None quando válido."""
    normalizado = (email or "").strip().lower()
    if not formato_ok(normalizado):
        return False, "Formato de e-mail inválido."

    dominio = normalizado.split("@", 1)[1]

    if dominio in DESCARTAVEIS:
        return False, "Use um e-mail corporativo ou pessoal real."

    em_cache = _cache.get(dominio)
    if em_cache and em_cache[2] > time.monotonic():
        return em_cache[0], em_cache[1]

    try:
        tem = await _tem_mx(dominio)
    except (dns.exception.DNSException, asyncio.TimeoutError, OSError) as exc:
        # ⚠️ Fail-open. NÃO troque por `return False` — ver o cabeçalho.
        logger.warning("MX indisponível para %s (%s) — deixando passar", dominio, exc)
        return True, None

    if tem:
        resultado = (True, None)
    else:
        resultado = (False, "Este domínio não recebe e-mails. Confira o endereço.")

    _cache[dominio] = (resultado[0], resultado[1], time.monotonic() + TTL_SEGUNDOS)
    return resultado
