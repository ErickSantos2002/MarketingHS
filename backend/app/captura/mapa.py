"""O mapa de campos do formulário de OUTRO site (prova do RD, 21/10/2026).

O `rastreio.js` manda os campos do formulário com o `name` que o site deu —
no site da H&S, `pnome`, `pemail`, `pwhatsapp`, `pmensagem`, `passunto`. Aqui
eles viram e-mail, colunas de `leads` e campos personalizados. O mapa padrão
cobre o site da H&S e os nomes comuns; o mapa do site (`sites.mapa_campos`,
editado no admin) vence o padrão.

⚠️ **Só o que está mapeado entra.** Campo sem destino é descartado — o
formulário do site tem oculto de todo tipo (ação, página, id de sessão), e
um formulário anônimo não escolhe as chaves de `campos_extras`.

⚠️ **Nunca lê senha, cartão nem captcha**, mesmo que o mapa do site mande: o
`rastreio.js` já não envia, e isto é a segunda linha. A regra é a do script
(mais larga que a do plano: inclui token anti-CSRF).
"""

import re

from app.captura.campos import CAMPOS_PERMITIDOS, CHAVE_EXTRA, normalizar_celular_br

MAPA_PADRAO: dict[str, str] = {
    # O site da H&S (`contato.cfm`).
    "pnome": "nome", "pemail": "email", "pwhatsapp": "whatsapp",
    "pmensagem": "mensagem", "passunto": "assunto",
    # Os nomes comuns.
    "name": "nome", "nome": "nome",
    "email": "email", "e-mail": "email", "e_mail": "email",
    "phone": "whatsapp", "telefone": "whatsapp", "celular": "whatsapp",
    "whatsapp": "whatsapp",
    "empresa": "empresa", "company": "empresa",
    "cargo": "cargo",
    "mensagem": "mensagem", "message": "mensagem",
}

CAMPO_PROIBIDO = re.compile(
    r"senha|password|card|cartao|cvv|cvc|captcha|^cc[_-]?(num|number|exp|cvv|cvc)"
    r"|turnstile|csrf|_token|authenticity_token", re.I)

# Colunas da lista branca que um formulário de fora NÃO escreve: estado de
# CRM (`status`, `tipo`) e origem (UTMs, `source`, A/B), que vêm do toque
# medido pelo script, nunca de um campo digitável.
DESTINOS_PROIBIDOS = frozenset({
    "status", "tipo", "source", "utm_source", "utm_medium", "utm_campaign",
    "utm_term", "utm_content", "ab_test", "ab_var", "ab_vid",
})

TAMANHO_MAXIMO = 2000


def _destino(nome: str, mapa_do_site: dict) -> str | None:
    if isinstance(mapa_do_site, dict):
        destino = mapa_do_site.get(nome)
        if isinstance(destino, str) and destino.strip():
            return destino.strip()
    return MAPA_PADRAO.get(nome.strip().lower())


def mapear(brutos: dict, mapa_do_site: dict) -> tuple[str | None, dict, dict]:
    """`(email, colunas, extras)` dos campos do formulário.

    O primeiro e-mail encontrado vence. O telefone é normalizado quando dá
    (`+55…`); quando não dá, fica como a pessoa digitou — o formulário de fora
    não tem a nossa validação, e jogar o número fora perderia o contato.
    """
    email = None
    colunas: dict = {}
    extras: dict = {}
    if not isinstance(brutos, dict):
        return None, colunas, extras
    for nome, valor in brutos.items():
        if not isinstance(nome, str) or not isinstance(valor, str):
            continue
        if CAMPO_PROIBIDO.search(nome):
            continue
        valor = valor.strip()[:TAMANHO_MAXIMO]
        if not valor:
            continue
        destino = _destino(nome, mapa_do_site)
        if destino is None:
            continue
        if destino == "email":
            if email is None:
                email = valor
            continue
        if destino in DESTINOS_PROIBIDOS:
            continue
        if destino in CAMPOS_PERMITIDOS:
            if destino == "whatsapp":
                valor = normalizar_celular_br(valor) or valor
            colunas.setdefault(destino, valor)
        elif CHAVE_EXTRA.match(destino):
            extras.setdefault(destino, valor)
    return email, colunas, extras
