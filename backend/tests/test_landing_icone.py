"""A casca da landing pública declara o ícone da H&S (frente icone-landing,
27/10): o mesmo `<link rel="icon">` do admin (`frontend/index.html`), com
caminho absoluto `/hs.ico` — servido pelo mesmo domínio. Puro: nenhum teste
toca o banco.
"""

import re

from app.routers.landing import montar_casca

ICONE = '<link rel="icon" type="image/x-icon" href="/hs.ico">'


def test_casca_declara_o_icone_da_casa_no_head():
    html = montar_casca("phoebus", {"headline": "Phoebus"})
    head = re.search(r"<head>(.*?)</head>", html, re.S).group(1)
    assert ICONE in head
    assert html.count('rel="icon"') == 1


def test_icone_vale_tambem_na_previa():
    assert ICONE in montar_casca("phoebus", {}, previa=True)
