"""A conversão `service_role` → `authenticated`, router por router.

O risco é o do `CLAUDE.md`: permissão errada, neste banco, devolve NADA — não
erro. Uma rota convertida que zera parece "não tem dado", não "quebrou". Por
isso cada router convertido prova duas coisas:

1. **não zerou** — a contagem que a rota devolve ao admin, agora sob
   `authenticated`, bate com a contagem sob `service_role` (que ignora RLS);
2. **o não-admin leva 403**, não zero — as políticas são admin-only, e a rota
   tem de transformar o silêncio do RLS em recusa explícita (`admin_atual`).
"""

import app.database as db


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _contar(sql: str, *args) -> int:
    async with db.sessao(role="service_role") as conn:
        return await conn.fetchval(sql, *args)


# ── templates.py ─────────────────────────────────────────────────────────────

async def test_templates_admin_ve_o_mesmo_total_que_service_role(cliente, token_admin):
    esperado = await _contar("SELECT count(*) FROM email_templates")
    r = await cliente.get("/templates", params={"limit": 1}, headers=_auth(token_admin))
    assert r.status_code == 200, r.text
    assert r.json()["pagination"]["total"] == esperado


async def test_templates_admin_cria_le_edita_e_apaga(cliente, token_admin):
    """A escrita também passa pela política (`WITH CHECK`): um INSERT barrado
    levantaria erro, um UPDATE/DELETE barrado afetaria 0 linhas e viraria 404."""
    h = _auth(token_admin)
    r = await cliente.post("/templates", headers=h,
                           json={"name": "teste-conversao-authenticated"})
    assert r.status_code == 201, r.text
    tid = r.json()["id"]
    try:
        assert (await cliente.get(f"/templates/{tid}", headers=h)).status_code == 200
        r = await cliente.patch(f"/templates/{tid}", headers=h, json={"category": "x"})
        assert r.status_code == 200 and r.json()["category"] == "x"
        assert (await cliente.delete(f"/templates/{tid}", headers=h)).status_code == 204
    finally:
        async with db.sessao(role="service_role") as conn:
            await conn.execute("DELETE FROM email_templates WHERE id = $1::uuid", tid)


async def test_templates_exige_admin(cliente, token_usuario):
    h = _auth(token_usuario)
    falso = "00000000-0000-0000-0000-000000000000"
    for metodo, caminho, corpo in [
        ("GET", "/templates", None),
        ("GET", f"/templates/{falso}", None),
        ("POST", "/templates", {"name": "x"}),
        ("PATCH", f"/templates/{falso}", {"name": "x"}),
        ("DELETE", f"/templates/{falso}", None),
    ]:
        r = await cliente.request(metodo, caminho, json=corpo, headers=h)
        assert r.status_code == 403, (metodo, caminho, r.text)
