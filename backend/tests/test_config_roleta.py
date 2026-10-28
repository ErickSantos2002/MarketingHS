"""A roleta de reunião no admin (Task 8).

O modo de falhar: não-admin mexendo na fila, vendedor que não existe (ou de
outro ambiente) entrando na roleta e a reunião indo para ninguém, ou a tela
quebrando quando o GrowthHS está fora.
"""

import httpx
import pytest
import pytest_asyncio

import app.database as db
from app.crm import growthhs
from app.crm.growthhs import Config
from app.routers import configuracao
from growthhs_falso import GrowthHSFalso

V1, V2, V3 = 9401, 9402, 9403


def _cfg(ambiente):
    return Config(base_url="https://growthhs.exemplo.invalid", client_id="hsg",
                  client_secret="s", list_id=22, boards_conferidos=(6, 7),
                  app_url=None, ambiente=ambiente)


@pytest.fixture
def falso(monkeypatch):
    f = GrowthHSFalso()
    f.vendedores = [{"id": V1, "nome": "Ana", "email": "Ana@HS.invalid", "ativo": True},
                    {"id": V2, "nome": "Bia", "email": "bia@hs.invalid", "ativo": True},
                    {"id": V3, "nome": "Caio", "email": "caio@hs.invalid", "ativo": False}]
    monkeypatch.setattr(configuracao, "TRANSPORTE_ROLETA", f.transporte())

    async def cfg_do_ambiente(ambiente):
        return _cfg(ambiente)

    monkeypatch.setattr(growthhs, "ler_config_do_ambiente", cfg_do_ambiente)
    growthhs.limpar_tokens()
    yield f
    growthhs.limpar_tokens()


@pytest_asyncio.fixture
async def roleta_guardada():
    """Guarda as duas roletas e as devolve no fim (a rota COMITA)."""
    await db.init_db()
    async with db.sessao(role="service_role") as conn:
        if await conn.fetchval("SELECT to_regclass('public.reuniao_roleta')") is None:
            pytest.skip("migration 036 ainda não aplicada neste banco")
        antes = [dict(r) for r in await conn.fetch("SELECT * FROM reuniao_roleta")]
    yield
    await db.init_db()
    async with db.sessao(role="service_role") as conn:
        await conn.execute("DELETE FROM reuniao_roleta")
        for r in antes:
            await conn.execute(
                "INSERT INTO reuniao_roleta (ambiente, user_id, posicao, nome, email) "
                "VALUES ($1, $2, $3, $4, $5)",
                r["ambiente"], r["user_id"], r["posicao"], r["nome"], r["email"])


def _h(token):
    return {"Authorization": f"Bearer {token}"}


URL = "/config/growthhs/{}/roleta"


async def test_roleta_exige_admin(roleta_guardada, cliente, token_usuario, falso):
    r = await cliente.get(URL.format("homologacao"), headers=_h(token_usuario))
    assert r.status_code == 403
    r = await cliente.put(URL.format("homologacao"), json={"user_ids": [V1]},
                          headers=_h(token_usuario))
    assert r.status_code == 403
    assert (await cliente.get(URL.format("homologacao"))).status_code == 401


async def test_put_grava_ordem_e_get_devolve(roleta_guardada, cliente, token_admin, falso):
    r = await cliente.put(URL.format("homologacao"), json={"user_ids": [V2, V1, V2]},
                          headers=_h(token_admin))
    assert r.status_code == 200
    r = await cliente.get(URL.format("homologacao"), headers=_h(token_admin))
    corpo = r.json()
    assert [(f["user_id"], f["nome"], f["email"], f["posicao"]) for f in corpo["fila"]] == [
        (V2, "Bia", "bia@hs.invalid", 0), (V1, "Ana", "ana@hs.invalid", 1)]
    assert [v["id"] for v in corpo["vendedores"]] == [V1, V2]   # inativo fora
    assert "aviso" not in corpo


async def test_id_desconhecido_422(roleta_guardada, cliente, token_admin, falso):
    for ids in ([V1, 123], [V3]):
        r = await cliente.put(URL.format("homologacao"), json={"user_ids": ids},
                              headers=_h(token_admin))
        assert r.status_code == 422


async def test_ambientes_separados(roleta_guardada, cliente, token_admin, falso):
    await cliente.put(URL.format("homologacao"), json={"user_ids": [V1]},
                      headers=_h(token_admin))
    await cliente.put(URL.format("producao"), json={"user_ids": [V2, V1]},
                      headers=_h(token_admin))
    h = (await cliente.get(URL.format("homologacao"), headers=_h(token_admin))).json()
    p = (await cliente.get(URL.format("producao"), headers=_h(token_admin))).json()
    assert [f["user_id"] for f in h["fila"]] == [V1]
    assert [f["user_id"] for f in p["fila"]] == [V2, V1]
    assert (await cliente.get(URL.format("outro"), headers=_h(token_admin))).status_code == 404


async def test_growthhs_fora_get_avisa(roleta_guardada, cliente, token_admin, falso):
    await cliente.put(URL.format("homologacao"), json={"user_ids": [V1]},
                      headers=_h(token_admin))
    falso.forcar[("GET", "/api/v1/integration/vendedores")] = [
        httpx.Response(503, json={"detail": "x"}), httpx.Response(503, json={"detail": "x"})]
    r = await cliente.get(URL.format("homologacao"), headers=_h(token_admin))
    assert r.status_code == 200
    assert r.json()["vendedores"] == [] and r.json()["aviso"]
    assert [f["user_id"] for f in r.json()["fila"]] == [V1]
    r = await cliente.put(URL.format("homologacao"), json={"user_ids": [V2]},
                          headers=_h(token_admin))
    assert r.status_code == 502
