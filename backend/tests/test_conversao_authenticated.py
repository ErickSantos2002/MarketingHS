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
    # ⚠️ Produção tinha 0 templates em 01/10 — e 0 == 0 não prova nada. Uma
    # linha semeada garante que o total comparado é > 0.
    async with db.sessao(role="service_role") as conn:
        tid = await conn.fetchval(
            "INSERT INTO email_templates (name) VALUES ('teste-conversao-contagem') "
            "RETURNING id::text")
    try:
        esperado = await _contar("SELECT count(*) FROM email_templates")
        assert esperado > 0
        r = await cliente.get("/templates", params={"limit": 1}, headers=_auth(token_admin))
        assert r.status_code == 200, r.text
        assert r.json()["pagination"]["total"] == esperado
    finally:
        async with db.sessao(role="service_role") as conn:
            await conn.execute("DELETE FROM email_templates WHERE id = $1::uuid", tid)


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


# ── chaves.py ────────────────────────────────────────────────────────────────

async def test_chaves_admin_ve_o_mesmo_total_que_service_role(cliente, token_admin):
    # ⚠️ Sem as chaves de teste ('teste 8A', 'teste-conversao…'): o banco é
    # compartilhado com outras rodadas de pytest, que criam e apagam chave no
    # meio — contar tudo deu falso vermelho em 01/10.
    esperado = await _contar("SELECT count(*) FROM api_keys WHERE name NOT LIKE 'teste%'")
    r = await cliente.get("/chaves", headers=_auth(token_admin))
    assert r.status_code == 200, r.text
    assert len([c for c in r.json() if not c["name"].startswith("teste")]) == esperado


async def test_chaves_admin_cria_desativa_e_remove(cliente, token_admin):
    h = _auth(token_admin)
    r = await cliente.post("/chaves", headers=h, json={"nome": "teste-conversao-authenticated"})
    assert r.status_code in (200, 201), r.text
    cid = r.json()["id"]
    try:
        r = await cliente.patch(f"/chaves/{cid}", headers=h, json={"ativa": False})
        assert r.status_code == 200 and r.json()["is_active"] is False, r.text
        assert (await cliente.delete(f"/chaves/{cid}", headers=h)).status_code == 204
    finally:
        async with db.sessao(role="service_role") as conn:
            await conn.execute("DELETE FROM api_keys WHERE id = $1::uuid", cid)
