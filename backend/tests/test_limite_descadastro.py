"""O descadastro de um clique fica fora do limite de 30/min (02/10/2026).

O POST one-click da RFC 8058 vem dos servidores do Gmail e do Yahoo — poucos
IPs para milhares de destinatários. Com o balde comum de `/publico`, o
provedor levaria 429 depois do 30º descadastro do minuto e o contato
continuaria na lista: exatamente o que faz o destinatário marcar spam. A
rota se autentica pelo HMAC, como o webhook se autentica pela assinatura.

Nada aqui grava: o token é inválido e a rota responde 400 antes do banco.
"""

from collections import deque, defaultdict

from app.main import app as _app
from app.middleware.limite_taxa import LimiteTaxaMiddleware

UM_CLIQUE = "/publico/descadastro/um-clique?lid=x&e=%21%21&t=y"


def _balde_comum() -> LimiteTaxaMiddleware:
    camada = _app.middleware_stack
    while camada is not None:
        if isinstance(camada, LimiteTaxaMiddleware) and "/publico" in camada.prefixos:
            return camada
        camada = getattr(camada, "app", None)
    raise AssertionError("balde comum de /publico não achado")


async def test_um_clique_nao_gasta_nem_leva_o_429_do_balde_comum(cliente, monkeypatch):
    await cliente.get("/health")  # monta a pilha de middleware
    balde = _balde_comum()
    monkeypatch.setattr(balde, "por_minuto", 3)
    monkeypatch.setattr(balde, "_historico", defaultdict(deque))
    ip = {"x-forwarded-for": "203.0.113.61"}

    for _ in range(10):
        r = await cliente.post(UM_CLIQUE, headers=ip)
        assert r.status_code != 429, r.text

    # O balde continua de pé para o resto de /publico — e o um clique não
    # gastou nada dele: as 3 primeiras passam, a 4ª leva 429.
    for _ in range(3):
        r = await cliente.post("/publico/descadastro", json={}, headers=ip)
        assert r.status_code != 429
    r = await cliente.post("/publico/descadastro", json={}, headers=ip)
    assert r.status_code == 429
