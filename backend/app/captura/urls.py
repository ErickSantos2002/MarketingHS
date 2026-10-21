"""As URLs que a config da página põe na landing pública (prova do RD, 21/10).

`consentimento.link` vira `href`, `imagem_url` vira `src` e `redirect_url` vira
`window.location` — na página PÚBLICA. A config é editada no admin (ou pela
chave de API), mas um `javascript:` no `href` vira script na mão de quem
clica, e `data:` serve página arbitrária. A revisão de segurança da frente
`prova-landing` achou o caminho; o front já filtra (`campos.ts::urlSegura`) e
o servidor é a segunda linha: recusa ao SALVAR e descarta ao SERVIR (o que já
estava gravado antes desta regra).

Aceito: `http(s)://` com host, ou caminho absoluto do próprio site (`/publico/
imagem/<id>`, `/p/obrigado`). Recusado todo o resto — inclusive `//host`
(relativo de protocolo, sai do site) e `/\\host` (o navegador lê `\\` como `/`).
"""

from urllib.parse import urlsplit

# Os caminhos, na config, das URLs que chegam à landing.
URLS_DA_CONFIG = (("redirect_url",), ("imagem_url",), ("consentimento", "link"))


def url_segura(valor) -> str | None:
    """A URL aparada, se for segura; `None` se não for (ou não for texto)."""
    if not isinstance(valor, str):
        return None
    url = valor.strip()
    if not url or any(c in url for c in "\\\x00\r\n\t"):
        return None
    if url.startswith("/"):
        return None if url.startswith("//") else url
    try:
        partes = urlsplit(url)
    except ValueError:
        return None
    if partes.scheme.lower() not in ("http", "https") or not partes.hostname:
        return None
    return url


def _ler(config: dict, caminho: tuple[str, ...]):
    atual = config
    for chave in caminho:
        if not isinstance(atual, dict):
            return None
        atual = atual.get(chave)
    return atual


def urls_invalidas(config) -> list[str]:
    """Os caminhos (`consentimento.link`) com URL preenchida e insegura.
    Vazio e ausente não contam — "sem link" é escolha válida."""
    if not isinstance(config, dict):
        return []
    saida = []
    for caminho in URLS_DA_CONFIG:
        valor = _ler(config, caminho)
        if valor is None or (isinstance(valor, str) and not valor.strip()):
            continue
        if url_segura(valor) is None:
            saida.append(".".join(caminho))
    return saida


def config_com_urls_seguras(config: dict) -> dict:
    """Cópia da config sem as URLs inseguras. A original não muda (ela vem
    do cache de processo da landing)."""
    copia = dict(config or {})
    for caminho in URLS_DA_CONFIG:
        if ".".join(caminho) not in urls_invalidas(copia):
            continue
        if len(caminho) == 1:
            copia.pop(caminho[0], None)
        else:
            bloco = dict(copia[caminho[0]])
            bloco.pop(caminho[1], None)
            copia[caminho[0]] = bloco
    return copia
