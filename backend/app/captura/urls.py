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

**Seções (frente landing-secoes, 26/10).** `config.secoes` é uma lista, e
cada seção (`texto_imagem`) ou item (`cartoes`, `logos`) pode trazer
`imagem_url`. Os caminhos fixos ficam como estão; soma-se a caminhada da
lista, com o índice no caminho (`secoes.3.itens.0.imagem_url`), que é o que
o editor mostra no erro. A caminhada não olha o tipo: qualquer `imagem_url`
de seção ou de item entra na régua — um tipo novo não nasce com buraco.

**Confiança (frente landing-confianca, 27/10).** Três tipos novos:
`certificacoes` (`imagem_url` nos itens, já coberta pela caminhada),
`depoimentos` (`logo_url` nos itens — a caminhada passou a olhar as duas
chaves) e `video`, cuja `url` não é imagem: só vale link de vídeo do YouTube
(`id_do_youtube`). A página nunca usa a URL colada — monta a miniatura e o
player a partir do id —, mas a régua é a mesma: recusa ao salvar
(`secoes.2.url`) e descarta ao servir.
"""

import re
from urllib.parse import parse_qs, urlsplit

# Os caminhos, na config, das URLs que chegam à landing.
URLS_DA_CONFIG = (("redirect_url",), ("imagem_url",), ("consentimento", "link"))

# Os tipos de seção e os limites — os mesmos de `frontend/src/landing/
# secoes.ts`. Ao servir, seção de tipo desconhecido sai e o que passa do
# limite é cortado: a config pode chegar pela chave de API, sem o editor, e a
# página pública não carrega 5.000 cartões porque alguém mandou.
# ⚠️ Aqui o corte é sobre a lista CRUA (itens vazios contam); o cliente conta
# só os aceitos. É teto de carga, não a régua fina: pelo editor nunca se
# passa do limite cru, então os dois só divergem em config vinda pela API.
TIPOS_DE_SECAO = frozenset({"numeros", "comparativo", "passos", "cartoes",
                            "texto_imagem", "logos", "perguntas", "chamada",
                            "certificacoes", "depoimentos", "video"})
LIMITE_SECOES = 20
LIMITE_ITENS = 30
LIMITE_LINHAS = 12


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


# As chaves de imagem que a caminhada das seções olha, na seção e nos itens.
CHAVES_DE_IMAGEM = ("imagem_url", "logo_url")

# YouTube: as mesmas quatro formas de `frontend/src/landing/secoes.ts::
# idDoYoutube` — assistir, curto, shorts e incorporar —, num host do
# YouTube, com o id de 11 caracteres.
_ID_DO_YOUTUBE = re.compile(r"[A-Za-z0-9_-]{11}")
_HOSTS_DO_YOUTUBE = ("youtube.com", "www.youtube.com", "m.youtube.com")
_CAMINHO_SHORTS_EMBED = re.compile(r"/(?:shorts|embed)/([^/]+)/?")
_CAMINHO_CURTO = re.compile(r"/([^/]+)/?")


def id_do_youtube(valor) -> str | None:
    """O id do vídeo, se `valor` for link de vídeo do YouTube; `None` se não."""
    if not isinstance(valor, str):
        return None
    url = valor.strip()
    if not url or any(c.isspace() or c == "\\" or c == "\x00" for c in url):
        return None
    try:
        partes = urlsplit(url)
        porta = partes.port
    except ValueError:
        return None
    if (partes.scheme.lower() not in ("http", "https") or partes.username
            or partes.password or porta is not None):
        return None
    host = (partes.hostname or "").lower()
    achado = None
    if host == "youtu.be":
        m = _CAMINHO_CURTO.fullmatch(partes.path)
        achado = m.group(1) if m else None
    elif host in _HOSTS_DO_YOUTUBE:
        if partes.path in ("/watch", "/watch/"):
            # O primeiro `v`, mesmo vazio — o `URLSearchParams.get` do
            # cliente faz igual, e as duas réguas não podem divergir.
            achado = (parse_qs(partes.query, keep_blank_values=True).get("v") or [None])[0]
        else:
            m = _CAMINHO_SHORTS_EMBED.fullmatch(partes.path)
            achado = m.group(1) if m else None
    return achado if achado and _ID_DO_YOUTUBE.fullmatch(achado) else None


def _ler(config: dict, caminho: tuple[str, ...]):
    atual = config
    for chave in caminho:
        if not isinstance(atual, dict):
            return None
        atual = atual.get(chave)
    return atual


def _ruim(valor) -> bool:
    """Preenchida e insegura. Vazio e ausente não contam — "sem imagem" é
    escolha válida."""
    if valor is None or (isinstance(valor, str) and not valor.strip()):
        return False
    return url_segura(valor) is None


def _video_ruim(valor) -> bool:
    """Preenchida e não é vídeo do YouTube. Vazio e ausente não contam: a
    seção nasce assim no editor, e o salvamento automático não pode
    recusar o que ainda está sendo preenchido."""
    if valor is None or (isinstance(valor, str) and not valor.strip()):
        return False
    return id_do_youtube(valor) is None


def _imagens_das_secoes(config: dict):
    """(caminho, valor) de cada imagem (`CHAVES_DE_IMAGEM`) de seção e de
    item. Tolera qualquer forma: o que não é lista ou objeto é pulado (o
    cliente descarta do mesmo jeito)."""
    secoes = config.get("secoes")
    if not isinstance(secoes, list):
        return
    for i, secao in enumerate(secoes):
        if not isinstance(secao, dict):
            continue
        for chave in CHAVES_DE_IMAGEM:
            if chave in secao:
                yield f"secoes.{i}.{chave}", secao[chave]
        itens = secao.get("itens")
        if not isinstance(itens, list):
            continue
        for j, item in enumerate(itens):
            if not isinstance(item, dict):
                continue
            for chave in CHAVES_DE_IMAGEM:
                if chave in item:
                    yield f"secoes.{i}.itens.{j}.{chave}", item[chave]


def _videos_ruins(config: dict):
    """Caminho (`secoes.2.url`) de cada `url` de seção `video` que não é
    vídeo do YouTube. Só no tipo `video`: em outro tipo a chave não é lida."""
    secoes = config.get("secoes")
    if not isinstance(secoes, list):
        return
    for i, secao in enumerate(secoes):
        if (isinstance(secao, dict) and secao.get("tipo") == "video"
                and _video_ruim(secao.get("url"))):
            yield f"secoes.{i}.url"


def urls_invalidas(config) -> list[str]:
    """Os caminhos (`consentimento.link`) com URL preenchida e insegura.
    Vazio e ausente não contam — "sem link" é escolha válida."""
    if not isinstance(config, dict):
        return []
    saida = [".".join(caminho) for caminho in URLS_DA_CONFIG
             if _ruim(_ler(config, caminho))]
    saida += [caminho for caminho, valor in _imagens_das_secoes(config) if _ruim(valor)]
    saida += list(_videos_ruins(config))
    return saida


def _sem_imagem_ruim(bloco: dict) -> dict:
    copia = dict(bloco)
    for chave in CHAVES_DE_IMAGEM:
        if _ruim(copia.get(chave)):
            copia.pop(chave)
    return copia


def _secoes_seguras(secoes) -> list:
    """Cópia das seções sem `imagem_url` insegura, sem tipo desconhecido e
    dentro dos limites. Cópia rasa por nível tocado — a original é do cache."""
    saida = []
    for secao in secoes if isinstance(secoes, list) else []:
        if len(saida) >= LIMITE_SECOES:
            break
        # `isinstance(str)` antes do `in`: um `tipo` lista ou objeto num
        # frozenset levanta TypeError, e a landing daria 500 a cada acesso.
        tipo = secao.get("tipo") if isinstance(secao, dict) else None
        if not isinstance(tipo, str) or tipo not in TIPOS_DE_SECAO:
            continue
        copia = _sem_imagem_ruim(secao)
        # Vídeo que não é do YouTube sai sem a `url` — e o cliente, sem id,
        # não desenha a seção.
        if tipo == "video" and _video_ruim(copia.get("url")):
            copia.pop("url")
        if isinstance(copia.get("itens"), list):
            copia["itens"] = [_sem_imagem_ruim(item) if isinstance(item, dict) else item
                              for item in copia["itens"][:LIMITE_ITENS]]
        if isinstance(copia.get("linhas"), list):
            copia["linhas"] = copia["linhas"][:LIMITE_LINHAS]
        saida.append(copia)
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
    if "secoes" in copia:
        copia["secoes"] = _secoes_seguras(copia["secoes"])
    return copia
