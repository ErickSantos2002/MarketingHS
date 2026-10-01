"""E-mail único por rodada do pytest, para os contatos que os testes COMITAM.

Com e-mail fixo, duas rodadas ao mesmo tempo (decisão 27 do Erick) batem em
`leads_email_unique`, e a pré-limpeza de uma apaga o contato vivo da outra. O
molde é o do `lead_real` (`test_crm_caminhos.py`, rodada 3):

- o e-mail é `<prefixo>-<12 hex>@exemplo.invalid`, sorteado por processo;
- a limpeza pega o desta rodada, o fixo antigo (para a última rodada morta da
  era antiga) e o que uma rodada MORTA deixou: a forma exata (regex ancorada,
  domínio `.invalid` — nenhum contato real casa) E mais de 2 h de vida — nunca
  o de uma rodada viva (a suíte inteira leva ~30 min).

Não é coletado pelo pytest (não começa com `test_`).
"""

import re
import uuid


class EmailDeRodada:
    def __init__(self, prefixo: str, antigo: str | None = None):
        self.atual = f"{prefixo}-{uuid.uuid4().hex[:12]}@exemplo.invalid"
        self.forma = rf"^{re.escape(prefixo)}-[0-9a-f]{{12}}@exemplo\.invalid$"
        self.antigos = [antigo] if antigo else []
        assert re.match(self.forma, self.atual)

    def __str__(self) -> str:
        return self.atual

    def onde(self, n: int, coluna: str = "email", criado: str = "created_at") -> str:
        """Predicado SQL com os parâmetros `$n` (lista) e `$n+1` (regex), na
        ordem de `parametros()`. `criado` é a coluna de nascimento da linha."""
        return (f"(lower({coluna}) = ANY(${n}::text[]) OR "
                f"(lower({coluna}) ~ ${n + 1} AND {criado} < now() - interval '2 hours'))")

    def parametros(self) -> list:
        return [[e.lower() for e in (self.atual, *self.antigos)], self.forma]


# O contato da fixture `envio` (conftest.py), que os testes do webhook põem no
# `to` do evento. Até 01/10 era `a@b.c`, fixo.
ENVIO = EmailDeRodada("webhook-envio", antigo="a@b.c")
