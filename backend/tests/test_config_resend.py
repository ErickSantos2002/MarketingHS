"""A configuração do Resend, restaurada no lote 8A.

As rotas chamam a API do Resend; aqui as funções do cliente são trocadas por
monkeypatch — o cliente em si é testado em `test_resend_cliente.py`.
"""

import pytest

from app.email import resend as cliente_resend

ROTA = "/config/resend"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _resend_falso(monkeypatch, teste=None, dominio=None):
    async def testar_chave(chave):
        return teste or {"valida": True, "escopo": "full", "dominios": []}

    async def ler_dominio(chave, dominio_id):
        return dominio or {"ok": False, "motivo": "not_found"}

    monkeypatch.setattr(cliente_resend, "testar_chave", testar_chave)
    monkeypatch.setattr(cliente_resend, "ler_dominio", ler_dominio)


async def test_leitura_sem_credencial_da_401(cliente):
    r = await cliente.get(ROTA)
    assert r.status_code == 401


async def test_leitura_aceita_chave_de_api_de_leitura(cliente, chave_de,
                                                      segredos_resend, monkeypatch):
    _resend_falso(monkeypatch)
    r = await cliente.get(ROTA, headers=_auth(await chave_de("read")))
    assert r.status_code == 200, r.text


async def test_escrita_recusa_chave_de_api_mesmo_de_escrita(cliente, chave_de,
                                                            segredos_resend):
    """Comentário I2 da origem: chave da tabela `api_keys` que vazasse poderia
    trocar a RESEND_API_KEY por uma de outra conta e exfiltrar a base."""
    r = await cliente.put(ROTA, headers=_auth(await chave_de("write")), json={
        "from_name": "HS", "from_prefix": "contato", "from_domain": "hs.com.br"})
    assert r.status_code == 401
