"""Balde próprio de `/publico/imagem/` (29/10/2026).

Medido em produção: a landing `phoebus` carrega ~25 imagens por
`/publico/imagem/`, no balde comum de 30/min — o mesmo de `/publico/captura`.
Na 31ª, 429: quem recarregava a página ficava sem imagem e sem formulário.
"""
from app.routers import imagens


def test_imagem_fora_do_balde_comum_e_com_balde_proprio():
    from app.main import app
    from app.middleware.limite_taxa import LimiteTaxaMiddleware
    baldes = [m for m in app.user_middleware if m.cls is LimiteTaxaMiddleware]
    comum = [m for m in baldes if "/publico" in m.kwargs["prefixos"]]
    assert comum and all("/publico/imagem/" in m.kwargs.get("isentos", ())
                         for m in comum)
    proprio = [m for m in baldes if m.kwargs["prefixos"] == ("/publico/imagem/",)]
    assert proprio and proprio[0].kwargs["por_minuto"] == imagens.LIMITE_POR_MINUTO
    assert imagens.LIMITE_POR_MINUTO >= 300
