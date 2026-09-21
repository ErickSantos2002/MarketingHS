"""As rotas de admin do A/B — o que as telas de Experiments faziam direto no
banco pelo alias `const db = supabase as any`.

O modo de falhar é o do `CLAUDE.md`: permissão errada devolve NADA, não erro.
Um admin veria testes; um usuário comum veria uma tela vazia e acharia que
ninguém criou teste. Por isso o primeiro teste prova o 403.
"""

from uuid import uuid4

import app.database as db

ALGUM_ID = str(uuid4())


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def test_rotas_de_ab_exigem_admin(cliente, token_usuario):
    rotas = [("GET", "/ab/config", None), ("PUT", "/ab/config", {"production_domain": "x.com"})]
    for metodo, caminho, corpo in rotas:
        r = await cliente.request(metodo, caminho, json=corpo, headers=_auth(token_usuario))
        assert r.status_code == 403, (metodo, caminho, r.text)


async def test_config_vazia_devolve_nulos(cliente, token_admin, config_ab):
    await config_ab(None)
    r = await cliente.get("/ab/config", headers=_auth(token_admin))
    assert r.status_code == 200
    assert r.json() == {"production_domain": None, "redirector_base": None}


async def test_config_normaliza_o_dominio_e_grava_parcial(cliente, token_admin, config_ab):
    await config_ab(None)
    r = await cliente.put("/ab/config", headers=_auth(token_admin),
                          json={"production_domain": " https://www.Exemplo.invalid/lp "})
    assert r.status_code == 200, r.text
    assert r.json() == {"production_domain": "exemplo.invalid", "redirector_base": None}

    # Só o redirecionador: o domínio fica como estava.
    r = await cliente.put("/ab/config", headers=_auth(token_admin),
                          json={"redirector_base": "https://go.exemplo.invalid/"})
    assert r.json() == {"production_domain": "exemplo.invalid",
                        "redirector_base": "https://go.exemplo.invalid"}

    async with db.sessao(role="service_role") as conn:
        assert await conn.fetchval("SELECT count(*) FROM ab_config") == 1


async def test_config_recusa_dominio_vazio_e_redirecionador_sem_protocolo(
        cliente, token_admin, config_ab):
    await config_ab(None)
    r = await cliente.put("/ab/config", headers=_auth(token_admin),
                          json={"production_domain": "   "})
    assert r.status_code == 422
    r = await cliente.put("/ab/config", headers=_auth(token_admin),
                          json={"redirector_base": "go.exemplo.invalid"})
    assert r.status_code == 422
