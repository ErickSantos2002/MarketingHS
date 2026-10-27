"""A casca da landing deixa o player fechado do YouTube funcionar (frente
landing-nicholson, 27/10): o script da IFrame API vem de `www.youtube.com`,
o frame de `www.youtube-nocookie.com`, e o embed precisa do Referer (sem
ele, o YouTube mostra "Erro 153" e não toca).

Os testes da casca são puros; o da resposta passa pelo app inteiro
(middlewares inclusive), com a config trocada por uma fixa — não lê página
do banco, mas a fixture `cliente` abre o pool.
"""

import re

import pytest

from app.routers import landing
from app.routers.landing import montar_casca

REFERRER = '<meta name="referrer" content="strict-origin-when-cross-origin">'
CONFIG = {"headline": "Phoebus", "secoes": [
    {"id": "v", "tipo": "video", "url": "https://www.youtube.com/watch?v=sByexR1w9vw"}]}


def _head(html: str) -> str:
    return re.search(r"<head>(.*?)</head>", html, re.S).group(1)


def test_casca_declara_a_politica_de_referer_no_head():
    head = _head(montar_casca("phoebus", CONFIG))
    assert REFERRER in head
    assert head.count('name="referrer"') == 1
    # Antes de qualquer recurso de fora (fonte, CSS): a política vale para
    # o que vier depois dela.
    assert head.index(REFERRER) < head.index("fonts.googleapis.com")


def test_referer_tambem_na_previa():
    assert REFERRER in montar_casca("phoebus", CONFIG, previa=True)


def test_casca_nao_carrega_nada_do_youtube_antes_do_clique():
    """A fachada: a API do YouTube é o `Secoes.tsx` que injeta, no clique.
    A casca não pode pré-carregar nem pré-conectar o YouTube."""
    html = montar_casca("phoebus", CONFIG)
    sem_config = re.sub(r'<script type="application/json".*?</script>', "", html, flags=re.S)
    assert "youtube" not in sem_config.lower()


def _diretivas(csp: str) -> dict[str, str]:
    saida = {}
    for parte in csp.split(";"):
        nome, _, valor = parte.strip().partition(" ")
        if nome:
            saida[nome.lower()] = valor
    return saida


async def test_resposta_nao_bloqueia_o_player(cliente, monkeypatch):
    async def config_fixa(slug):
        return dict(CONFIG)

    monkeypatch.setattr(landing, "_config_da_pagina", config_fixa)
    resposta = await cliente.get("/p/qualquer")
    assert resposta.status_code == 200
    assert REFERRER in resposta.text

    # Sem `no-referrer` no cabeçalho: o embed precisa da origem.
    politica = resposta.headers.get("referrer-policy", "")
    assert "no-referrer" not in [p.strip() for p in politica.split(",")]

    # Hoje não há CSP. Se uma entrar, ela tem de liberar o player.
    csp = resposta.headers.get("content-security-policy")
    if csp:
        d = _diretivas(csp)
        script = d.get("script-src", d.get("default-src", ""))
        frame = d.get("frame-src", d.get("child-src", d.get("default-src", "")))
        assert "https://www.youtube.com" in script
        assert "https://www.youtube-nocookie.com" in frame
