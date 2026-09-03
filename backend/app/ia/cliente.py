"""O cliente da API da Claude. Uma responsabilidade só: falar com a API.

Separado do resto de propósito — é o único ponto do módulo de IA que faz rede
para fora, e é o que um teste precisa substituir para rodar sem gastar token.
Mesmo desenho do `app/email/resend.py`.

⚠️ A chave sai de `integration_secrets`, não do ambiente de produção. Rotacionar
é gravar pela tela; não precisa de deploy.
"""

import anthropic

from app.integracoes import ler_segredo

# O modelo é decisão do Erick (03/09/2026), não do código. Trocar por um mais
# barato é decisão dele também — a conta estimada é de ~$15/mês.
MODELO = "claude-opus-5"

SEGREDO_CHAVE = "ANTHROPIC_API_KEY"

# 120s: uma pergunta de análise com ferramentas encadeia várias idas ao modelo,
# e o padrão do SDK (10 min) é longo demais para um request de tela — quem
# espera é uma pessoa olhando um spinner.
TIMEOUT = 120


class IANaoConfigurada(RuntimeError):
    """Não há chave da Anthropic gravada. Quem chama transforma em 400 com
    mensagem que diz o que fazer, não em 500."""


async def cliente() -> anthropic.AsyncAnthropic | None:
    """O cliente, ou `None` se a chave não estiver configurada.

    ⚠️ Devolve `None` em vez de levantar porque quem chama precisa distinguir
    "não configurado" (400, a tela explica) de "falhou" (502). `ler_segredo`
    nunca levanta.
    """
    chave = await ler_segredo(SEGREDO_CHAVE)
    if not chave:
        return None
    return anthropic.AsyncAnthropic(api_key=chave, timeout=TIMEOUT)


async def exigir_cliente() -> anthropic.AsyncAnthropic:
    """O cliente, ou `IANaoConfigurada`."""
    c = await cliente()
    if c is None:
        raise IANaoConfigurada(
            "A chave da Anthropic não está configurada. "
            "Preencha em Configurações → Integrações → IA.")
    return c
