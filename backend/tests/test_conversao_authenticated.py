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


# ── automacoes.py ────────────────────────────────────────────────────────────

# ⚠️ As rotas COMITAM em produção, e regra ativa dispara em lead de verdade
# (o gatilho enfileira entrega ao GrowthHS). Por isso a regra de teste nasce
# INATIVA e com uma etiqueta que nenhum lead tem.
REGRA_TESTE = {"name": "teste-conversao-authenticated", "is_active": False,
               "condition_type": "etiqueta", "condition_operator": "is",
               "condition_value": "teste-conversao-nunca",
               "action_type": "create_in_growthhs"}


async def _apagar_regras_de_teste():
    async with db.sessao(role="service_role") as conn:
        await conn.execute("DELETE FROM automation_rules WHERE name = $1",
                           REGRA_TESTE["name"])


async def test_automacoes_admin_cria_lista_edita_e_apaga(cliente, token_admin):
    """Produção tem 0 regras: a contagem só prova algo com uma semeada — e a
    semeada é a da própria rota, sob `authenticated`."""
    h = _auth(token_admin)
    await _apagar_regras_de_teste()
    try:
        r = await cliente.post("/automacoes", headers=h, json=REGRA_TESTE)
        assert r.status_code == 201, r.text
        rid = r.json()["id"]
        esperado = await _contar("SELECT count(*) FROM automation_rules")
        assert esperado > 0
        r = await cliente.get("/automacoes", headers=h)
        assert r.status_code == 200 and len(r.json()) == esperado, r.text
        r = await cliente.patch(f"/automacoes/{rid}", headers=h, json={"priority": 3})
        assert r.status_code == 200, r.text
        assert await _contar("SELECT priority FROM automation_rules WHERE id = $1::uuid",
                             rid) == 3
        assert (await cliente.delete(f"/automacoes/{rid}", headers=h)).status_code == 204
    finally:
        await _apagar_regras_de_teste()


async def test_automacoes_previa_bate_com_service_role(cliente, token_admin):
    """A prévia lê `leads`, `ecosystem_identities` (e `lead_tags`/`tags`), as
    três sob política admin-only. Corte no passado: lead de teste criado por
    outra rodada não entra na conta no meio do teste."""
    corte = "2026-09-30"
    esperado = await _contar(
        """SELECT count(*) FROM leads l
            WHERE l.created_at < ($1::date + 1)
              AND NOT EXISTS (SELECT 1 FROM ecosystem_identities ei
                               WHERE l.dnia_id IS NOT NULL AND ei.dnia_id = l.dnia_id
                                 AND ei.growthhs_card_id IS NOT NULL)""", corte)
    assert esperado > 0
    r = await cliente.post("/automacoes/previa", headers=_auth(token_admin),
                           json={"conditions": [{"type": "created_at", "operator": "before",
                                                 "value": corte}]})
    assert r.status_code == 200, r.text
    assert r.json()["total"] == esperado


async def test_automacoes_exige_admin(cliente, token_usuario):
    r = await cliente.get("/automacoes", headers=_auth(token_usuario))
    assert r.status_code == 403, r.text
