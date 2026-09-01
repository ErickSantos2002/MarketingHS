"""Conversão HTML -> texto puro para a parte `text/plain` dos e-mails.

Porte de `_shared/htmlToText.ts`. **Não é um parser** — é uma sequência de
substituições calibrada para o HTML que o Unlayer exporta: tabelas aninhadas,
comentários condicionais do Outlook, `<style>` no `<head>` e entidades HTML.

POR QUE converter aqui, e não guardar um `text` gerado pelo editor: o HTML que
chega nesta função já passou pelas merge tags (trocadas por destinatário) e pela
injeção do rodapé de descadastro. Um texto gerado na hora de salvar não teria
nem uma coisa nem outra. Convertendo o HTML final, a parte texto é sempre o
espelho exato do que foi enviado.

⚠️ Em Python a tabela de entidades Latin-1 do original **não é portada**:
`html.unescape` da biblioteca padrão resolve todas. O que sobra do original é o
tratamento dos codepoints especiais, que `unescape` não faz.
"""

import html as _html
import logging
import re

logger = logging.getLogger(__name__)

# Codepoints invisíveis: zero-width, joiners, o &#847; que o Unlayer usa no
# preheader, e o hífen suave. Todos viram vazio.
INVISIVEIS = "".join(chr(c) for c in
                     (0x034F, 0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF, 0x00AD))

# ⚠️ Espaços que não quebram viram espaço COMUM. O colapso lá embaixo usa
# `[ \t\f\v]+`, que não pega U+00A0 — eles sobreviveriam como espaços duplos
# espalhados pelo texto inteiro.
NAO_QUEBRAM = "   "

_TRADUCAO = {ord(c): None for c in INVISIVEIS}
_TRADUCAO.update({ord(c): " " for c in NAO_QUEBRAM})

_SEM_TAGS = re.compile(r"<[^>]*>")


def _tirar_tags(s: str) -> str:
    return _SEM_TAGS.sub(" ", s)


def _link(m: re.Match) -> str:
    """Link vira "texto (url)".

    O href é preservado porque é o único jeito de o destinatário chegar ao CTA
    na versão texto. Três casos em que anexar a URL só atrapalha: âncora
    interna, `mailto:`/`tel:`, e quando o próprio texto do link JÁ é a URL —
    que viraria "x (x)".
    """
    rotulo = _tirar_tags(m.group(2)).strip()
    url = (m.group(1) or "").strip()
    if not url or url.startswith("#") or re.match(r"^(mailto|tel):", url, re.I):
        return f" {rotulo} "
    if not rotulo:
        return f" {url} "
    if url in rotulo:
        return f" {rotulo} "
    return f" {rotulo} ({url}) "


def html_para_texto(html: str | None) -> str:
    """⚠️ NUNCA levanta: uma exceção aqui derrubaria o envio de um
    destinatário inteiro, e a parte texto é acessório, não requisito."""
    if not html:
        return ""
    try:
        return _converter(str(html))
    except Exception:  # noqa: BLE001
        logger.exception("html_para_texto falhou; seguindo sem parte texto")
        return ""


def _converter(s: str) -> str:
    # 1. Fora tudo que não é conteúdo. Os comentários vão PRIMEIRO porque os
    #    condicionais do Outlook (<!--[if mso]>...<![endif]-->) embrulham markup
    #    de verdade — se as tags fossem processadas antes, esse markup só-Outlook
    #    vazaria para o texto, duplicando botões e espaçadores.
    s = re.sub(r"<!--.*?-->", " ", s, flags=re.S)
    for tag in ("head", "style", "script", "title"):
        s = re.sub(rf"<{tag}\b[^>]*>.*?</{tag}>", " ", s, flags=re.S | re.I)

    # 2. Imagens viram o alt, quando há um. Sem alt somem: o Unlayer deixa
    #    alt="" na maioria dos blocos, e "[imagem]" repetido só poluiria.
    s = re.sub(r'<img\b[^>]*?\balt\s*=\s*"([^"]+)"[^>]*>', r" \1 ", s, flags=re.I)
    s = re.sub(r"<img\b[^>]*>", " ", s, flags=re.I)

    # 3. Links viram "texto (url)".
    s = re.sub(r'<a\b[^>]*?\bhref\s*=\s*"([^"]*)"[^>]*>(.*?)</a>', _link,
               s, flags=re.S | re.I)

    # 4. Quebras estruturais. <td> vira espaço (células da mesma linha ficam
    #    lado a lado); <tr> e blocos viram quebra.
    s = re.sub(r"<br\s*/?>", "\n", s, flags=re.I)
    s = re.sub(r"<li\b[^>]*>", "\n- ", s, flags=re.I)
    s = re.sub(r"</(td|th)>", " ", s, flags=re.I)
    # `li` fica FORA desta lista: a abertura já emitiu o "\n- ", e fechar também
    # com "\n" daria uma linha em branco entre cada item.
    s = re.sub(r"</(p|div|tr|table|h[1-6]|ul|ol|blockquote|section|header|footer)>",
               "\n", s, flags=re.I)
    s = re.sub(r"<hr\b[^>]*>", "\n", s, flags=re.I)

    # 5. O que sobrou de markup sai; SÓ ENTÃO as entidades são decodificadas.
    #    Inverter a ordem faria um "&lt;script&gt;" escrito no e-mail virar tag
    #    de verdade e ser removido como se fosse markup.
    s = _tirar_tags(s)
    s = _html.unescape(s)
    s = s.translate(_TRADUCAO)

    # 6. Normalização. O HTML do Unlayer é cheio de tabelas de espaçamento;
    #    sem isto o texto sai com dezenas de linhas em branco seguidas.
    s = re.sub(r"\r\n?", "\n", s)
    s = re.sub(r"[ \t\f\v]+", " ", s)
    s = "\n".join(linha.strip() for linha in s.split("\n"))
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()
