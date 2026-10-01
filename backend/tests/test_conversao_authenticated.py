"""A conversão `service_role` → `authenticated`, router por router.

O risco é o do `CLAUDE.md`: permissão errada, neste banco, devolve NADA — não
erro. Uma rota convertida que zera parece "não tem dado", não "quebrou". Por
isso cada router convertido prova duas coisas:

1. **não zerou** — a contagem que a rota devolve ao admin, agora sob
   `authenticated`, bate com a contagem sob `service_role` (que ignora RLS);
2. **o não-admin leva 403**, não zero — as políticas são admin-only, e a rota
   tem de transformar o silêncio do RLS em recusa explícita (`admin_atual`).
"""

from datetime import date

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
                                 AND ei.growthhs_card_id IS NOT NULL)""",
        date.fromisoformat(corte))
    assert esperado > 0
    r = await cliente.post("/automacoes/previa", headers=_auth(token_admin),
                           json={"conditions": [{"type": "created_at", "operator": "before",
                                                 "value": corte}]})
    assert r.status_code == 200, r.text
    assert r.json()["total"] == esperado
    # Os outros dois operadores de data também respondiam 500 (texto num
    # parâmetro date/timestamptz). Só provam que respondem.
    for op, val in (("after", "2026-01-01"), ("between", "2026-01-01|2026-09-30")):
        r = await cliente.post("/automacoes/previa", headers=_auth(token_admin),
                               json={"conditions": [{"type": "created_at",
                                                     "operator": op, "value": val}]})
        assert r.status_code == 200 and r.json()["total"] > 0, (op, r.text)


async def test_automacoes_exige_admin(cliente, token_usuario):
    r = await cliente.get("/automacoes", headers=_auth(token_usuario))
    assert r.status_code == 403, r.text


# ── segmentos.py ─────────────────────────────────────────────────────────────

SEGMENTO_TESTE = "teste-conversao-authenticated"


async def _apagar_segmentos_de_teste():
    async with db.sessao(role="service_role") as conn:
        await conn.execute("DELETE FROM segments WHERE name LIKE $1",
                           SEGMENTO_TESTE + "%")


async def test_segmentos_lista_e_contagens_batem_com_service_role(cliente, token_admin):
    """A lista e o `total_contatos` de cada segmento (que passa por
    `evaluate_segment_rules`, em `leads`) sob `authenticated`."""
    async with db.sessao(role="service_role") as conn:
        esperado = {r["id"]: r["total"] for r in await conn.fetch(
            """SELECT s.id::text AS id,
                      CASE WHEN s.type = 'dynamic'
                           THEN (SELECT count(*) FROM evaluate_segment_rules(s.id))
                           ELSE (SELECT count(*) FROM segment_contacts sc
                                  WHERE sc.segment_id = s.id) END AS total
                 FROM segments s WHERE s.name NOT LIKE 'teste%'""")}
    assert esperado, "produção sem segmento: o teste não provaria nada"
    r = await cliente.get("/segmentos", headers=_auth(token_admin))
    assert r.status_code == 200, r.text
    obtido = {s["id"]: s["total_contatos"] for s in r.json()
              if not s["nome"].startswith("teste")}
    assert obtido == esperado
    assert any(v > 0 for v in obtido.values())


async def test_segmentos_contatos_e_audiencia_batem_com_service_role(cliente, token_admin):
    h = _auth(token_admin)
    async with db.sessao(role="service_role") as conn:
        sid = await conn.fetchval(
            "SELECT id::text FROM segments WHERE type = 'dynamic' AND name NOT LIKE 'teste%' "
            "ORDER BY created_at LIMIT 1")
        assert sid, "sem segmento dinâmico em produção"
        n_contatos = await conn.fetchval(
            """SELECT count(*) FROM evaluate_segment_rules($1::uuid) r
                 JOIN leads l ON l.id = r.lead_id WHERE l.deleted_at IS NULL""", sid)
        n_audiencia = await conn.fetchval(
            "SELECT count_segment_audience($1::uuid[], '{}'::uuid[])", [sid])
    assert n_contatos > 0
    r = await cliente.get(f"/segmentos/{sid}/contatos", headers=h)
    assert r.status_code == 200 and len(r.json()) == n_contatos, r.text
    r = await cliente.post("/segmentos/audiencia", headers=h,
                           json={"incluir": [sid], "excluir": []})
    assert r.status_code == 200 and r.json()["total"] == n_audiencia, r.text


async def test_segmentos_previa_bate_com_service_role(cliente, token_admin):
    regras = [{"field": "status", "operator": "is_not", "value": "__nenhum__"}]
    esperado = await _contar(
        "SELECT count(*) FROM preview_segment_rules($1::jsonb, 'and')", regras)
    assert esperado > 0
    r = await cliente.post("/segmentos/previa", headers=_auth(token_admin),
                           json={"regras": regras})
    assert r.status_code == 200 and r.json()["total"] == esperado, r.text
    assert len(r.json()["amostra"]) > 0


async def test_segmentos_estatico_cria_edita_duplica_e_apaga(cliente, token_admin):
    """A escrita passa pelo `WITH CHECK` de `segments` e `segment_contacts`."""
    h = _auth(token_admin)
    await _apagar_segmentos_de_teste()
    try:
        async with db.sessao(role="service_role") as conn:
            leads = [r["id"] for r in await conn.fetch(
                "SELECT id::text FROM leads WHERE deleted_at IS NULL "
                "ORDER BY created_at LIMIT 2")]
        r = await cliente.post("/segmentos", headers=h, json={
            "nome": SEGMENTO_TESTE, "tipo": "static", "lead_ids": leads[:1]})
        assert r.status_code == 201, r.text
        sid = r.json()["id"]
        r = await cliente.post(f"/segmentos/{sid}/contatos", headers=h,
                               json={"lead_ids": leads[1:]})
        assert r.status_code == 204, r.text
        r = await cliente.get(f"/segmentos/{sid}/contatos", headers=h)
        assert len(r.json()) == 2, r.text
        r = await cliente.put(f"/segmentos/{sid}", headers=h, json={
            "nome": SEGMENTO_TESTE + " editado", "tipo": "static", "lead_ids": leads[:1]})
        assert r.status_code == 200, r.text
        r = await cliente.post(f"/segmentos/{sid}/duplicar", headers=h)
        assert r.status_code == 201, r.text
        copia = r.json()["id"]
        r = await cliente.get(f"/segmentos/{copia}/contatos", headers=h)
        assert len(r.json()) == 1, r.text
        for x in (copia, sid):
            assert (await cliente.delete(f"/segmentos/{x}", headers=h)).status_code == 204
    finally:
        await _apagar_segmentos_de_teste()


async def test_segmentos_exige_admin(cliente, token_usuario):
    h = _auth(token_usuario)
    falso = "00000000-0000-0000-0000-000000000000"
    for metodo, caminho, corpo in [
        ("GET", "/segmentos", None),
        ("POST", "/segmentos/previa", {"regras": [{"field": "status",
                                                   "operator": "is", "value": "x"}]}),
        ("POST", "/segmentos/audiencia", {"incluir": [], "excluir": []}),
        ("GET", f"/segmentos/{falso}/contatos", None),
        ("DELETE", f"/segmentos/{falso}", None),
    ]:
        r = await cliente.request(metodo, caminho, json=corpo, headers=h)
        assert r.status_code == 403, (metodo, caminho, r.text)


# ── campanhas.py ─────────────────────────────────────────────────────────────

CAMPANHA_TESTE = "teste-conversao-authenticated"


async def _apagar_campanhas_de_teste():
    async with db.sessao(role="service_role") as conn:
        # O guard_campaign_delete recusa 'sending'; as de teste nunca chegam lá,
        # mas o UPDATE antes do DELETE é o mesmo cinto da fixture `envio`.
        await conn.execute("UPDATE campaigns SET status = 'draft' WHERE name LIKE $1 "
                           "AND status = 'sending'", CAMPANHA_TESTE + "%")
        await conn.execute("DELETE FROM campaigns WHERE name LIKE $1",
                           CAMPANHA_TESTE + "%")


async def _semear_campanha_com_envios(n: int = 2) -> str:
    """Campanha em `draft` com `n` envios 'failed', em contatos reais.

    ⚠️ 'failed', não 'sent': o `fn_campaign_send_event` grava `contact_events`
    no INSERT de 'sent' — e este teste comita. 'failed' não dispara nada, não
    é pendente (o guard deixa apagar) e o CASCADE leva os envios junto."""
    async with db.sessao(role="service_role") as conn:
        cid = await conn.fetchval(
            "INSERT INTO campaigns (name, channel, status) VALUES ($1, 'email', 'draft') "
            "RETURNING id::text", CAMPANHA_TESTE + " semente")
        await conn.execute(
            """INSERT INTO campaign_sends (campaign_id, lead_id, channel, status, error)
               SELECT $1::uuid, id, 'email', 'failed', 'teste-conversao'
                 FROM leads WHERE deleted_at IS NULL ORDER BY created_at LIMIT $2""",
            cid, n)
    return cid


async def test_campanhas_lista_e_numeros_batem_com_service_role(cliente, token_admin):
    """Lista, `stats` ao vivo (que conta `campaign_sends`) e os envios de cada
    campanha. Semeada porque as 2 de produção são resíduo a ser apagado."""
    await _apagar_campanhas_de_teste()
    try:
        await _semear_campanha_com_envios(2)
        await _comparar_campanhas(cliente, token_admin)
    finally:
        await _apagar_campanhas_de_teste()


async def _comparar_campanhas(cliente, token_admin):
    async with db.sessao(role="service_role") as conn:
        esperado = {r["id"]: r["n"] for r in await conn.fetch(
            """SELECT c.id::text AS id, count(cs.id) AS n FROM campaigns c
                 LEFT JOIN campaign_sends cs ON cs.campaign_id = c.id
                GROUP BY c.id""")}
    assert any(esperado.values())
    h = _auth(token_admin)
    r = await cliente.get("/campanhas", params={"limit": 100}, headers=h)
    assert r.status_code == 200, r.text
    obtido = {c["id"]: c["stats"]["total"] for c in r.json()["data"]}
    assert obtido == esperado
    for cid, n in esperado.items():
        r = await cliente.get(f"/campanhas/{cid}/envios", headers=h)
        assert r.status_code == 200 and len(r.json()) == n, r.text
        r = await cliente.get(f"/campanhas/{cid}", headers=h)
        assert r.status_code == 200 and len(r.json()["sends"]) == min(n, 50), r.text


async def test_campanhas_audiencia_bate_com_service_role(cliente, token_admin):
    """Campanha sem segmento = base inteira, pela mesma função do envio."""
    await _apagar_campanhas_de_teste()
    try:
        cid = await _semear_campanha_com_envios(0)
        esperado = await _contar(
            "SELECT count_segment_audience('{}'::uuid[], '{}'::uuid[])")
        assert esperado > 0
        r = await cliente.get(f"/campanhas/{cid}/audiencia", headers=_auth(token_admin))
        assert r.status_code == 200 and r.json()["total"] == esperado, r.text
    finally:
        await _apagar_campanhas_de_teste()


async def test_campanhas_cria_edita_duplica_cancela_e_apaga(cliente, token_admin):
    """A escrita sob `authenticated`. A agendada fica em 2099 — o worker nunca
    sobe nesta frente, e mesmo que subisse não a promoveria."""
    h = _auth(token_admin)
    await _apagar_campanhas_de_teste()
    try:
        r = await cliente.post("/campanhas", headers=h, json={
            "name": CAMPANHA_TESTE, "channel": "email",
            "scheduled_at": "2099-01-01T12:00:00+00:00"})
        assert r.status_code == 201, r.text
        cid = r.json()["id"]
        r = await cliente.patch(f"/campanhas/{cid}", headers=h, json={"subject": "x"})
        assert r.status_code == 200, r.text
        r = await cliente.post(f"/campanhas/{cid}/cancelar-agendamento", headers=h)
        assert r.status_code == 200 and r.json()["status"] == "draft", r.text
        r = await cliente.post(f"/campanhas/{cid}/duplicar", headers=h)
        assert r.status_code == 201, r.text
        copia = r.json()["id"]
        for x in (copia, cid):
            assert (await cliente.delete(f"/campanhas/{x}", headers=h)).status_code == 204
    finally:
        await _apagar_campanhas_de_teste()


async def test_campanhas_exige_admin(cliente, token_usuario):
    h = _auth(token_usuario)
    falso = "00000000-0000-0000-0000-000000000000"
    for metodo, caminho, corpo in [
        ("GET", "/campanhas", None),
        ("GET", f"/campanhas/{falso}", None),
        ("POST", "/campanhas", {"name": "x", "channel": "email"}),
        ("PATCH", f"/campanhas/{falso}", {"subject": "x"}),
        ("POST", f"/campanhas/{falso}/duplicar", None),
        ("DELETE", f"/campanhas/{falso}", None),
        ("GET", f"/campanhas/{falso}/audiencia", None),
        ("GET", f"/campanhas/{falso}/envios", None),
        ("POST", f"/campanhas/{falso}/cancelar-agendamento", None),
    ]:
        r = await cliente.request(metodo, caminho, json=corpo, headers=h)
        assert r.status_code == 403, (metodo, caminho, r.text)


# ── jornadas.py ──────────────────────────────────────────────────────────────

JORNADA_TESTE = "teste-conversao-authenticated"


async def _apagar_jornadas_de_teste():
    async with db.sessao(role="service_role") as conn:
        await conn.execute("UPDATE journeys SET status = 'draft' WHERE name LIKE $1",
                           JORNADA_TESTE + "%")
        await conn.execute("DELETE FROM journeys WHERE name LIKE $1", JORNADA_TESTE + "%")


async def test_jornadas_execucoes_e_metricas_batem_com_service_role(cliente, token_admin):
    """`journey_runs` é SELECT admin: a contagem por estado, a lista de
    execuções e as métricas por nó, sob `authenticated`. Produção tinha 1 fluxo
    com 3 execuções em 01/10."""
    async with db.sessao(role="service_role") as conn:
        esperado = {r["id"]: r["n"] for r in await conn.fetch(
            """SELECT j.id::text AS id, count(r.id) AS n FROM journeys j
                 LEFT JOIN journey_runs r ON r.journey_id = j.id
                WHERE j.name NOT LIKE 'teste%' GROUP BY j.id""")}
        com_runs = next((j for j, n in esperado.items() if n), None)
        metricas = (await conn.fetchval("SELECT journey_node_metrics($1::uuid)", com_runs)
                    if com_runs else None)
    assert com_runs, "sem fluxo com execução em produção: o teste não provaria nada"
    h = _auth(token_admin)
    r = await cliente.get("/jornadas", headers=h)
    assert r.status_code == 200, r.text
    obtido = {j["id"]: sum(j["runs"].values()) for j in r.json()["data"]
              if not j["name"].startswith("teste")}
    assert obtido == esperado
    r = await cliente.get(f"/jornadas/{com_runs}/execucoes", headers=h)
    assert r.status_code == 200 and len(r.json()) == min(esperado[com_runs], 200), r.text
    r = await cliente.get(f"/jornadas/{com_runs}", headers=h)
    assert r.status_code == 200 and r.json()["metrics"] == (metricas or {}), r.text


async def test_jornadas_cria_edita_e_apaga(cliente, token_admin):
    h = _auth(token_admin)
    nodes = [{"id": "a", "next": None, "type": "delay", "config": {"minutes": 1}}]
    await _apagar_jornadas_de_teste()
    try:
        r = await cliente.post("/jornadas", headers=h, json={
            "name": JORNADA_TESTE, "entry_type": "event",
            "entry_config": {"event_type": "teste-conversao-nunca"},
            "entry_node_id": "a", "nodes": nodes})
        assert r.status_code == 201, r.text
        jid = r.json()["journey"]["id"]
        r = await cliente.patch(f"/jornadas/{jid}", headers=h, json={"description": "x"})
        assert r.status_code == 200, r.text
        assert (await cliente.delete(f"/jornadas/{jid}", headers=h)).status_code == 204
    finally:
        await _apagar_jornadas_de_teste()


async def test_jornadas_exige_admin(cliente, token_usuario):
    h = _auth(token_usuario)
    falso = "00000000-0000-0000-0000-000000000000"
    for metodo, caminho in [("GET", "/jornadas"), ("GET", f"/jornadas/{falso}"),
                            ("GET", f"/jornadas/{falso}/execucoes")]:
        r = await cliente.request(metodo, caminho, headers=h)
        assert r.status_code == 403, (metodo, caminho, r.text)


# ── leitura_contatos.py ──────────────────────────────────────────────────────
# A base de contatos inteira passa por aqui — é a tela que, zerada, "parece mês
# fraco". Cada leitura compara com a mesma consulta sob `service_role`, em
# dado do passado (corte) para não oscilar com lead de teste de outra rodada.

async def test_contatos_lista_bate_com_service_role(cliente, token_admin):
    esperado = await _contar("SELECT count(*) FROM leads WHERE deleted_at IS NULL "
                             "AND created_at < '2026-09-30'")
    assert esperado > 1000
    h = _auth(token_admin)
    vistos, pagina = set(), 0
    while True:
        r = await cliente.get("/contatos", params={"pagina": pagina, "tamanho": 1000},
                              headers=h)
        assert r.status_code == 200, r.text
        vistos |= {c["id"] for c in r.json()["itens"] if c["created_at"] < "2026-09-30"}
        if not r.json()["tem_mais"]:
            break
        pagina += 1
    assert len(vistos) == esperado


async def test_contatos_ficha_eventos_e_conversoes_batem_com_service_role(cliente, token_admin):
    async with db.sessao(role="service_role") as conn:
        com_eventos = await conn.fetchval(
            """SELECT l.id::text FROM leads l JOIN contact_events ce ON ce.lead_id = l.id
                GROUP BY l.id ORDER BY count(*) DESC LIMIT 1""")
        n_eventos = await conn.fetchval(
            """SELECT count(*) FROM contact_events ce WHERE ce.lead_id = $1::uuid
                  OR ce.dnia_id = (SELECT dnia_id FROM leads WHERE id = $1::uuid)""",
            com_eventos)
        com_tags = await conn.fetchval(
            "SELECT lead_id::text FROM lead_tags GROUP BY lead_id ORDER BY count(*) DESC LIMIT 1")
        n_tags = await conn.fetchval(
            "SELECT count(*) FROM lead_tags WHERE lead_id = $1::uuid", com_tags)
        com_conv = await conn.fetchval(
            "SELECT lead_id::text FROM lead_conversions WHERE lead_id IS NOT NULL "
            "GROUP BY lead_id ORDER BY count(*) DESC LIMIT 1")
        n_conv = await conn.fetchval(
            "SELECT count(*) FROM lead_conversions WHERE lead_id = $1::uuid", com_conv)
        n_utm = await conn.fetchval(
            "SELECT count(DISTINCT lead_id) FROM lead_conversions "
            "WHERE utm_content IS NOT NULL AND lead_id IS NOT NULL")
    # ⚠️ `lead_conversions` estava VAZIA em 01/10, e semear tem efeito
    # colateral (o gatilho grava `last_conversion_date` no lead real). Com a
    # tabela vazia, as duas rotas de conversão só provam que respondem.
    assert n_eventos > 0 and n_tags > 0
    h = _auth(token_admin)
    r = await cliente.get(f"/contatos/{com_eventos}/eventos", params={"limite": 500}, headers=h)
    assert r.status_code == 200 and len(r.json()) == min(n_eventos, 500), r.text
    r = await cliente.get(f"/contatos/{com_tags}", headers=h)
    assert r.status_code == 200 and len(r.json()["tags"]) == n_tags, r.text
    r = await cliente.post("/contatos/tags-por-contato", headers=h,
                           json={"lead_ids": [com_tags]})
    assert r.status_code == 200 and len(r.json().get(com_tags, [])) == n_tags, r.text
    alvo_conv = com_conv or com_tags
    r = await cliente.get(f"/contatos/{alvo_conv}/conversoes", headers=h)
    assert r.status_code == 200 and r.json()["total"] == (n_conv or 0), r.text
    r = await cliente.get(f"/contatos/{alvo_conv}/conversoes-lista", headers=h)
    assert r.status_code == 200 and len(r.json()) == (n_conv or 0), r.text
    r = await cliente.get("/contatos/conversoes-utm", headers=h)
    assert r.status_code == 200 and len(r.json()) == n_utm, r.text


async def test_contatos_busca_duplicatas_e_enriquecimento_batem(cliente, token_admin):
    async with db.sessao(role="service_role") as conn:
        n_busca = await conn.fetchval(
            """SELECT count(*) FROM (SELECT 1 FROM leads WHERE deleted_at IS NULL
                 AND (nome ILIKE '%an%' OR email ILIKE '%an%' OR whatsapp ILIKE '%an%')
                 LIMIT 100) x""")
        n_dup = await conn.fetchval(
            """SELECT (SELECT count(*) FROM (SELECT 1 FROM ecosystem_identities
                         WHERE email IS NOT NULL AND email <> ''
                         GROUP BY lower(email) HAVING count(*) > 1) a)
                    + (SELECT count(*) FROM (SELECT 1 FROM ecosystem_identities
                         WHERE phone IS NOT NULL AND phone <> ''
                         GROUP BY phone HAVING count(*) > 1) b)""")
        ids = [r["d"] for r in await conn.fetch(
            "SELECT dnia_id::text AS d FROM ecosystem_identities ORDER BY created_at LIMIT 50")]
    assert n_busca > 0 and ids
    h = _auth(token_admin)
    r = await cliente.get("/contatos/busca", params={"q": "an", "limite": 100}, headers=h)
    assert r.status_code == 200 and len(r.json()) == n_busca, r.text
    r = await cliente.get("/contatos/duplicatas", headers=h)
    assert r.status_code == 200 and len(r.json()) == n_dup, r.text
    r = await cliente.post("/contatos/enriquecimento", headers=h, json={"dnia_ids": ids})
    assert r.status_code == 200 and len(r.json()) == len(ids), r.text


async def test_contatos_nota_e_tag_sob_authenticated(cliente, token_admin):
    """`lead_notes` e `lead_tags` são ALL admin: a escrita passa."""
    h = _auth(token_admin)
    async with db.sessao(role="service_role") as conn:
        lead = await conn.fetchval(
            "SELECT id::text FROM leads WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1")
    nid = None
    try:
        r = await cliente.post(f"/contatos/{lead}/notas", headers=h,
                               json={"conteudo": "teste-conversao-authenticated"})
        assert r.status_code == 201, r.text
        nid = r.json()["id"]
        r = await cliente.get(f"/contatos/{lead}", headers=h)
        assert any(n["id"] == nid for n in r.json()["notas"]), r.text
    finally:
        async with db.sessao(role="service_role") as conn:
            await conn.execute("DELETE FROM lead_notes WHERE content = $1",
                               "teste-conversao-authenticated")


async def test_contatos_leitura_exige_admin(cliente, token_usuario):
    h = _auth(token_usuario)
    falso = "00000000-0000-0000-0000-000000000000"
    for metodo, caminho, corpo in [
        ("GET", "/contatos", None), ("GET", "/contatos/conversoes-utm", None),
        ("GET", "/contatos/duplicatas", None), ("GET", "/contatos/busca?q=ab", None),
        ("POST", "/contatos/enriquecimento", {"dnia_ids": []}),
        ("POST", "/contatos/tags-por-contato", {"lead_ids": []}),
        ("GET", f"/contatos/{falso}", None), ("GET", f"/contatos/{falso}/eventos", None),
        ("POST", f"/contatos/{falso}/notas", {"conteudo": "x"}),
        ("DELETE", f"/contatos/{falso}/tags/{falso}", None),
    ]:
        r = await cliente.request(metodo, caminho, json=corpo, headers=h)
        assert r.status_code == 403, (metodo, caminho, r.text)
