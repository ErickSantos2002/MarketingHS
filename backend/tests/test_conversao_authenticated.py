"""A conversão `service_role` → `authenticated`, router por router.

O risco é o do `CLAUDE.md`: permissão errada, neste banco, devolve NADA — não
erro. Uma rota convertida que zera parece "não tem dado", não "quebrou". Por
isso cada router convertido prova duas coisas:

1. **não zerou** — a contagem que a rota devolve ao admin, agora sob
   `authenticated`, bate com a contagem sob `service_role` (que ignora RLS);
2. **o não-admin leva 403**, não zero — as políticas são admin-only, e a rota
   tem de transformar o silêncio do RLS em recusa explícita (`admin_atual`).
"""

import uuid
from datetime import date, datetime

import pytest_asyncio
from limpeza import apagar_leads
from rodada import EmailDeRodada

import app.database as db


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _contar(sql: str, *args) -> int:
    async with db.sessao(role="service_role") as conn:
        return await conn.fetchval(sql, *args)


# ── semente própria (rodada 7, pergunta 12 (a)) ──────────────────────────────
# Até 02/10 seis testes daqui comparavam o dado ANTIGO de produção (corte fixo
# em 30/09, segmento, segmento dinâmico, fluxo com execução e etiqueta que já
# existiam). O reset de 02/10 apagou tudo isso e os seis passaram a falhar na
# pré-condição. Agora cada um semeia o que precisa e o corte é "antes de o
# teste começar" (o `now()` do banco depois da semeadura).
#
# ⚠️ O que se semeia COMITA em produção, com o worker rodando. Por isso:
# fluxo em 'draft' com execuções já encerradas ('done'/'exited' — o worker só
# reivindica 'active'/'waiting'); evento de tipo que nenhum fluxo escuta;
# etiqueta e segmento com nome que nenhuma regra usa. E a limpeza é SÓ por id
# — nunca por nome, padrão ou critério amplo.

SEMENTE = "teste-conversao-semente"


@pytest_asyncio.fixture
async def semente():
    """Três contatos, duas etiquetas, um segmento dinâmico (pela etiqueta 0),
    um estático, um fluxo com duas execuções encerradas e dois eventos no
    contato 0. Devolve os ids e o `corte`."""
    await db.init_db()
    marca = uuid.uuid4().hex[:12]
    emails = [f"{SEMENTE}-{marca}-{i}@exemplo.invalid" for i in range(3)]
    s = {"leads": [], "tags": [], "segmentos": [], "jornada": None, "identidades": []}
    try:
        async with db.sessao(role="service_role") as conn:
            for e in emails:
                s["leads"].append(await conn.fetchval(
                    "INSERT INTO leads (nome, email, tipo, status) "
                    "VALUES ('Semente', $1, 'teste', 'Lead') RETURNING id::text", e))
            s["identidades"] = [r["d"] for r in await conn.fetch(
                "SELECT dnia_id::text AS d FROM leads WHERE id = ANY($1::uuid[]) "
                "AND dnia_id IS NOT NULL", s["leads"])]
            for i in range(2):
                s["tags"].append(await conn.fetchval(
                    "INSERT INTO tags (name) VALUES ($1) RETURNING id::text",
                    f"{SEMENTE}-{marca}-{i}"))
            l0, l1, _ = s["leads"]
            t0, t1 = s["tags"]
            await conn.execute(
                "INSERT INTO lead_tags (lead_id, tag_id) VALUES "
                "($1::uuid, $3::uuid), ($1::uuid, $4::uuid), ($2::uuid, $3::uuid)",
                l0, l1, t0, t1)
            for titulo in ("semente 1", "semente 2"):
                await conn.execute(
                    """INSERT INTO contact_events (lead_id, source_app, event_type, title)
                       VALUES ($1::uuid, 'marketinghs', 'teste_conversao', $2)""",
                    l0, titulo)
            s["dinamico"] = await conn.fetchval(
                "INSERT INTO segments (name, type, rules, logic) "
                "VALUES ($1, 'dynamic', $2::jsonb, 'and') RETURNING id::text",
                f"{SEMENTE}-{marca}-dinamico",
                [{"field": "tag", "operator": "is", "value": t0}])
            s["segmentos"].append(s["dinamico"])
            s["estatico"] = await conn.fetchval(
                "INSERT INTO segments (name, type, rules) VALUES ($1, 'static', '[]'::jsonb) "
                "RETURNING id::text", f"{SEMENTE}-{marca}-estatico")
            s["segmentos"].append(s["estatico"])
            await conn.execute(
                "INSERT INTO segment_contacts (segment_id, lead_id) "
                "VALUES ($1::uuid, $2::uuid), ($1::uuid, $3::uuid)", s["estatico"], l0, l1)
            s["jornada"] = await conn.fetchval(
                """INSERT INTO journeys (name, status, entry_type, entry_config,
                                         entry_node_id, nodes)
                   VALUES ($1, 'draft', 'event', '{"event_type": "teste-conversao-nunca"}',
                           'a', '[{"id": "a", "next": null, "type": "delay",
                                   "config": {"minutes": 1}}]')
                   RETURNING id::text""", f"{SEMENTE}-{marca}-fluxo")
            await conn.execute(
                "INSERT INTO journey_runs (journey_id, lead_id, current_node_id, state) "
                "VALUES ($1::uuid, $2::uuid, 'a', 'done'), ($1::uuid, $3::uuid, 'a', 'exited')",
                s["jornada"], l0, l1)
        s["corte"] = await _contar("SELECT now()")
        yield s
    finally:
        async with db.sessao(role="service_role") as conn:
            if s["jornada"]:
                # O guard recusa apagar fluxo com execução: as execuções antes.
                await conn.execute("DELETE FROM journey_runs WHERE journey_id = $1::uuid",
                                   s["jornada"])
                await conn.execute("DELETE FROM journeys WHERE id = $1::uuid", s["jornada"])
            await conn.execute("DELETE FROM segments WHERE id = ANY($1::uuid[])",
                               s["segmentos"])
            await conn.execute("DELETE FROM tags WHERE id = ANY($1::uuid[])", s["tags"])
            await apagar_leads(conn, s["leads"])
            # A identidade que a captura deu a cada um — só a que tem o e-mail
            # exato de um contato da semente.
            await conn.execute(
                "DELETE FROM ecosystem_identities WHERE dnia_id = ANY($1::uuid[]) "
                "AND lower(email) = ANY($2::text[])", s["identidades"], emails)


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


async def test_automacoes_previa_bate_com_service_role(cliente, token_admin, semente):
    """A prévia lê `leads`, `ecosystem_identities` (e `lead_tags`/`tags`), as
    três sob política admin-only. O corte é o dia em que o teste começou (a
    prévia só aceita data); a semente garante que há contato antes dele."""
    corte = semente["corte"].date().isoformat()
    esperado = await _contar(
        """SELECT count(*) FROM leads l
            WHERE l.created_at < ($1::date + 1)
              AND NOT EXISTS (SELECT 1 FROM ecosystem_identities ei
                               WHERE l.dnia_id IS NOT NULL AND ei.dnia_id = l.dnia_id
                                 AND ei.growthhs_card_id IS NOT NULL)""",
        date.fromisoformat(corte))
    assert esperado >= len(semente["leads"])
    r = await cliente.post("/automacoes/previa", headers=_auth(token_admin),
                           json={"conditions": [{"type": "created_at", "operator": "before",
                                                 "value": corte}]})
    assert r.status_code == 200, r.text
    assert r.json()["total"] == esperado
    # Os outros dois operadores de data também respondiam 500 (texto num
    # parâmetro date/timestamptz). Só provam que respondem.
    for op, val in (("after", "2026-01-01"), ("between", f"2026-01-01|{corte}")):
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


async def test_segmentos_lista_e_contagens_batem_com_service_role(
        cliente, token_admin, semente):
    """A lista e o `total_contatos` de cada segmento (que passa por
    `evaluate_segment_rules`, em `leads`) sob `authenticated`. Os de nome
    `teste%` de OUTROS testes ficam de fora (nascem e morrem no meio); os da
    semente entram pelo id."""
    async with db.sessao(role="service_role") as conn:
        esperado = {r["id"]: r["total"] for r in await conn.fetch(
            """SELECT s.id::text AS id,
                      CASE WHEN s.type = 'dynamic'
                           THEN (SELECT count(*) FROM evaluate_segment_rules(s.id))
                           ELSE (SELECT count(*) FROM segment_contacts sc
                                  WHERE sc.segment_id = s.id) END AS total
                 FROM segments s
                WHERE s.name NOT LIKE 'teste%' OR s.id = ANY($1::uuid[])""",
            semente["segmentos"])}
    # Dinâmico: os 2 com a etiqueta 0. Estático: os 2 vinculados.
    assert esperado[semente["dinamico"]] == 2 and esperado[semente["estatico"]] == 2
    r = await cliente.get("/segmentos", headers=_auth(token_admin))
    assert r.status_code == 200, r.text
    obtido = {s["id"]: s["total_contatos"] for s in r.json()
              if not s["nome"].startswith("teste") or s["id"] in semente["segmentos"]}
    assert obtido == esperado


async def test_segmentos_contatos_e_audiencia_batem_com_service_role(
        cliente, token_admin, semente):
    h = _auth(token_admin)
    sid = semente["dinamico"]
    async with db.sessao(role="service_role") as conn:
        n_contatos = await conn.fetchval(
            """SELECT count(*) FROM evaluate_segment_rules($1::uuid) r
                 JOIN leads l ON l.id = r.lead_id WHERE l.deleted_at IS NULL""", sid)
        n_audiencia = await conn.fetchval(
            "SELECT count_segment_audience($1::uuid[], '{}'::uuid[])", [sid])
    assert n_contatos == 2
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


async def test_jornadas_execucoes_e_metricas_batem_com_service_role(
        cliente, token_admin, semente):
    """`journey_runs` é SELECT admin: a contagem por estado, a lista de
    execuções e as métricas por nó, sob `authenticated`. O fluxo com execução
    é o da semente (draft, execuções encerradas: o worker não as pega)."""
    com_runs = semente["jornada"]
    async with db.sessao(role="service_role") as conn:
        esperado = {r["id"]: r["n"] for r in await conn.fetch(
            """SELECT j.id::text AS id, count(r.id) AS n FROM journeys j
                 LEFT JOIN journey_runs r ON r.journey_id = j.id
                WHERE j.name NOT LIKE 'teste%' OR j.id = $1::uuid GROUP BY j.id""",
            com_runs)}
        metricas = await conn.fetchval("SELECT journey_node_metrics($1::uuid)", com_runs)
    assert esperado[com_runs] == 2
    h = _auth(token_admin)
    r = await cliente.get("/jornadas", headers=h)
    assert r.status_code == 200, r.text
    obtido = {j["id"]: sum(j["runs"].values()) for j in r.json()["data"]
              if not j["name"].startswith("teste") or j["id"] == com_runs}
    assert obtido == esperado
    r = await cliente.get(f"/jornadas/{com_runs}/execucoes", headers=h)
    assert r.status_code == 200 and len(r.json()) == esperado[com_runs], r.text
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

async def test_contatos_lista_bate_com_service_role(cliente, token_admin, semente):
    """Corte = o `now()` do banco depois da semente: lead que outra rodada
    criar no meio do teste não entra na conta."""
    corte = semente["corte"]
    esperado = await _contar("SELECT count(*) FROM leads WHERE deleted_at IS NULL "
                             "AND created_at < $1", corte)
    assert esperado >= len(semente["leads"])
    h = _auth(token_admin)
    vistos, pagina = set(), 0
    while True:
        r = await cliente.get("/contatos", params={"pagina": pagina, "tamanho": 1000},
                              headers=h)
        assert r.status_code == 200, r.text
        vistos |= {c["id"] for c in r.json()["itens"]
                   if datetime.fromisoformat(c["created_at"]) < corte}
        if not r.json()["tem_mais"]:
            break
        pagina += 1
    assert len(vistos) == esperado
    assert set(semente["leads"]) <= vistos


async def test_contatos_ficha_eventos_e_conversoes_batem_com_service_role(
        cliente, token_admin, semente):
    com_eventos = com_tags = semente["leads"][0]
    async with db.sessao(role="service_role") as conn:
        n_eventos = await conn.fetchval(
            """SELECT count(*) FROM contact_events ce WHERE ce.lead_id = $1::uuid
                  OR ce.dnia_id = (SELECT dnia_id FROM leads WHERE id = $1::uuid)""",
            com_eventos)
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
    # ⚠️ Conversão NÃO se semeia: o gatilho de `lead_conversions` grava evento
    # que fluxo de verdade escuta (`form_submitted`). Com a tabela vazia, as
    # duas rotas de conversão só provam que respondem.
    assert n_eventos >= 2 and n_tags == 2
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


# ── escrita_contatos.py (rodada 2, depois da migration 021) ──────────────────
# O risco aqui é o pior dos dois: um UPDATE barrado pelo RLS afeta 0 linhas
# SEM erro, e a rota responde 200. Por isso cada escrita é conferida no banco,
# sob `service_role`, depois da chamada — o status da resposta não basta.

# Únicos por processo (decisão 27: duas suítes ao mesmo tempo) — ver tests/rodada.py.
_EMAILS_ESCRITA = [EmailDeRodada(f"teste-conversao-escrita-{i}",
                                 antigo=f"teste-conversao-escrita-{i}@exemplo.invalid")
                   for i in range(4)]
EMAILS_ESCRITA = [e.atual for e in _EMAILS_ESCRITA]
TAG_ESCRITA = "teste-conversao-escrita"


async def _apagar_leads_de_escrita():
    async with db.sessao(role="service_role") as conn:
        ids = []
        for e in _EMAILS_ESCRITA:
            ids += [r["id"] for r in await conn.fetch(
                f"SELECT id FROM leads WHERE {e.onde(1)}", *e.parametros())]
        # contact_events é ON DELETE SET NULL: sem isto os eventos do teste
        # ficariam órfãos na timeline (e a cópia em journey_events, sem FK).
        await conn.execute("DELETE FROM journey_events WHERE lead_id = ANY($1::uuid[])", ids)
        await conn.execute("DELETE FROM contact_events WHERE lead_id = ANY($1::uuid[])", ids)
        await conn.execute("DELETE FROM leads WHERE id = ANY($1::uuid[])", ids)
        for e in _EMAILS_ESCRITA:
            await conn.execute(f"DELETE FROM ecosystem_identities WHERE {e.onde(1)}",
                               *e.parametros())
        await conn.execute("DELETE FROM tags WHERE name = $1", TAG_ESCRITA)


@pytest_asyncio.fixture
async def leads_escrita():
    """Dois contatos de teste (status 'Lead', sem cargo). Os outros dois
    e-mails da lista são os que a importação cria."""
    await db.init_db()
    await _apagar_leads_de_escrita()
    async with db.sessao(role="service_role") as conn:
        ids = [await conn.fetchval(
            "INSERT INTO leads (nome, email, tipo, status) "
            "VALUES ('Escrita', $1, 'teste', 'Lead') RETURNING id::text", e)
            for e in EMAILS_ESCRITA[:2]]
    yield ids
    await _apagar_leads_de_escrita()


async def _uid_admin(token: str) -> str:
    """O id do admin da fixture `token_admin`, conferido no banco. O e-mail é
    único por rodada: sai do próprio token, não de uma constante."""
    from app.auth.security import ler_token
    return await _contar("SELECT id::text FROM auth.users WHERE email = $1",
                         ler_token(token)["email"])


async def test_escrita_status_individual_e_em_lote_afetam_o_lead(
        cliente, token_admin, leads_escrita):
    h = _auth(token_admin)
    a, b = leads_escrita
    r = await cliente.patch(f"/contatos/{a}/status", headers=h, json={"status": "Iniciado"})
    assert r.status_code == 200 and r.json() == {"status": "Iniciado", "anterior": "Lead"}, r.text
    assert await _contar("SELECT status FROM leads WHERE id = $1::uuid", a) == "Iniciado"
    assert await _contar(
        "SELECT count(*) FROM contact_events WHERE lead_id = $1::uuid "
        "AND event_type = 'contact_updated'", a) == 1

    r = await cliente.post("/contatos/status-em-lote", headers=h,
                           json={"lead_ids": [a, b], "status": "Lead Qualificado"})
    assert r.status_code == 200 and r.json()["atualizados"] == 2, r.text
    assert await _contar("SELECT count(*) FROM leads WHERE id = ANY($1::uuid[]) "
                         "AND status = 'Lead Qualificado'", [a, b]) == 2
    # O evento específico da qualificação também passou pelo WITH CHECK.
    assert await _contar("SELECT count(*) FROM contact_events WHERE lead_id = ANY($1::uuid[]) "
                         "AND event_type = 'lead_qualified'", [a, b]) == 2


async def test_escrita_tags_em_lote_edicao_e_exclusao_afetam_o_lead(
        cliente, token_admin, leads_escrita):
    h = _auth(token_admin)
    a, b = leads_escrita
    r = await cliente.post("/contatos/tags-em-lote", headers=h,
                           json={"lead_ids": [a, b], "tag": TAG_ESCRITA})
    assert r.status_code == 200 and r.json()["vinculados"] == 2, r.text
    assert await _contar(
        "SELECT count(*) FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id "
        "WHERE t.name = $1", TAG_ESCRITA) == 2

    r = await cliente.patch(f"/contatos/{a}", headers=h, json={"cargo": "Diretor"})
    assert r.status_code == 200, r.text
    assert await _contar("SELECT cargo FROM leads WHERE id = $1::uuid", a) == "Diretor"
    falso = "00000000-0000-0000-0000-000000000000"
    r = await cliente.patch(f"/contatos/{falso}", headers=h, json={"cargo": "x"})
    assert r.status_code == 404, r.text

    r = await cliente.delete(f"/contatos/{b}", headers=h)
    assert r.status_code == 204, r.text
    assert await _contar("SELECT deleted_at IS NOT NULL FROM leads WHERE id = $1::uuid", b)
    assert await _contar("SELECT deleted_by::text FROM leads WHERE id = $1::uuid", b) \
        == await _uid_admin(token_admin)
    # A política de SELECT não filtra `deleted_at`: o segundo DELETE acha a
    # linha, e é o `deleted_at IS NULL` da rota que dá o 404.
    assert (await cliente.delete(f"/contatos/{b}", headers=h)).status_code == 404


async def test_fusao_pela_rota_sob_authenticated_leva_o_historico(
        cliente, token_admin, leads_escrita):
    """A migration 022 foi aplicada (01/10/2026) e a fusão foi para
    `authenticated` (rodada 5). Este teste substitui o sentinela que esperava
    por ela. A prova das 15 tabelas, colisões inclusive, está em
    `test_fusao_historico.py` (transação revertida, os dois papéis); aqui é a
    ROTA, comitando: o histórico do descartado tem de chegar ao mantido, e não
    sumir pelo CASCADE do DELETE.

    Só o que não aciona nada fora do banco: o pedido ao comercial nasce
    'entregue' (o worker de produção só pega 'pendente')."""
    h = _auth(token_admin)
    a, b = leads_escrita
    async with db.sessao(role="service_role") as conn:
        # Caso 1 (funde os LEADS) exige a mesma identidade ou nenhuma; o
        # gatilho de captura pode ter dado uma a cada um.
        await conn.execute("UPDATE leads SET dnia_id = NULL WHERE id = ANY($1::uuid[])", [a, b])
        await conn.execute(
            "INSERT INTO lead_notes (lead_id, content) VALUES ($1::uuid, 'nota da fusão')", b)
        await conn.execute(
            "INSERT INTO lead_conversions (lead_id, tipo) VALUES ($1::uuid, 'diagnostico')", b)
        await conn.execute(
            "INSERT INTO crm_handoffs (lead_id, acao, origem, status, card_id) "
            "VALUES ($1::uuid, 'criar', 'manual', 'entregue', 1)", b)

        # A cópia em `journey_events` que o gatilho faz de cada evento: é ela
        # que a fusão tem de levar (pergunta 40). Garante que há o que levar.
        await conn.execute(
            "INSERT INTO journey_events (lead_id, event_type) "
            "VALUES ($1::uuid, 'teste_fusao_rota')", b)

    r = await cliente.post("/contatos/fundir", headers=h,
                           json={"manter": a, "descartar": b})
    # ⚠️ Sem `finally` de limpeza desde a rodada 7 (pergunta 40 (a)): a fusão
    # apaga a fila de jornada do descartado na própria transação. Até a
    # rodada 6 a cópia ficava apontando para lead nenhum, e a limpeza da
    # fixture (por e-mail) já não a achava — era o +1 da suíte.
    assert await _contar(
        "SELECT count(*) FROM journey_events WHERE lead_id = $1::uuid", b) == 0
    assert r.status_code == 200, r.text
    corpo = r.json()
    assert corpo["caso"] == "leads", corpo
    for tabela in ("lead_notes", "lead_conversions", "crm_handoffs"):
        assert corpo["movidos"][tabela] == 1, (tabela, corpo)
        assert await _contar(
            f"SELECT count(*) FROM {tabela} WHERE lead_id = $1::uuid", a) == 1, tabela
    assert await _contar("SELECT count(*) FROM leads WHERE id = $1::uuid", b) == 0


def test_fusao_roda_como_authenticated():
    """O teste de cima passaria também sob `service_role` (BYPASSRLS). Este lê
    o código: a rota abre a sessão como o admin que chamou."""
    import inspect

    from app.routers.escrita_contatos import fundir_contatos
    fonte = inspect.getsource(fundir_contatos)
    assert 'sessao(role="authenticated", user_id=admin.id)' in fonte
    assert 'role="service_role"' not in fonte


async def test_escrita_contatos_exige_admin(cliente, token_usuario):
    h = _auth(token_usuario)
    falso = "00000000-0000-0000-0000-000000000000"
    for metodo, caminho, corpo in [
        ("PATCH", f"/contatos/{falso}/status", {"status": "Lead"}),
        ("POST", "/contatos/status-em-lote", {"lead_ids": [falso], "status": "Lead"}),
        ("POST", "/contatos/tags-em-lote", {"lead_ids": [falso], "tag": "x"}),
        ("POST", "/contatos/fundir", {"manter": falso, "descartar": falso}),
        ("PATCH", f"/contatos/{falso}", {"nome": "x"}),
        ("DELETE", f"/contatos/{falso}", None),
    ]:
        r = await cliente.request(metodo, caminho, json=corpo, headers=h)
        assert r.status_code == 403, (metodo, caminho, r.text)


# ── contatos.py (importação, recálculo, tag avulsa) ──────────────────────────

async def test_importacao_cria_e_atualiza_sob_authenticated(cliente, token_admin, leads_escrita):
    h = _auth(token_admin)
    a, _ = leads_escrita
    novo = EMAILS_ESCRITA[2]
    r = await cliente.post("/contatos/importar", headers=h, json={
        "modo": "enriquecer", "linhas": [
            {"email": EMAILS_ESCRITA[0].upper(), "cargo": "Gerente"},
            {"email": novo, "nome": "Importado", "tipo": "teste"}]})
    assert r.status_code == 200, r.text
    corpo = r.json()
    assert (corpo["criados"], corpo["atualizados"], corpo["erros"]) == (1, 1, []), corpo
    assert await _contar("SELECT cargo FROM leads WHERE id = $1::uuid", a) == "Gerente"
    assert await _contar("SELECT count(*) FROM leads WHERE email = $1", novo) == 1
    # A identidade (SECURITY DEFINER) também foi amarrada sob authenticated.
    assert await _contar("SELECT dnia_id IS NOT NULL FROM leads WHERE email = $1", novo)


async def test_importacao_linha_ruim_nao_derruba_as_outras(cliente, token_admin, leads_escrita):
    """⚠️ Antes do SAVEPOINT por linha, a linha que o BANCO recusa abortava a
    transação inteira: as seguintes caíam em "current transaction is aborted"
    e o COMMIT virava ROLLBACK calado. Um NUL no texto é recusado pelo
    Postgres (não pelo pydantic) — é a falha de banco mais simples de forjar."""
    h = _auth(token_admin)
    ruim, boa = EMAILS_ESCRITA[2], EMAILS_ESCRITA[3]
    r = await cliente.post("/contatos/importar", headers=h, json={
        "modo": "enriquecer", "linhas": [
            {"email": ruim, "nome": "a\u0000b", "tipo": "teste"},
            {"email": boa, "nome": "Boa", "tipo": "teste"}]})
    assert r.status_code == 200, r.text
    corpo = r.json()
    assert corpo["criados"] == 1 and len(corpo["erros"]) == 1, corpo
    assert corpo["erros"][0].startswith(ruim), corpo
    assert [c["email"] for c in corpo["contatos"]] == [boa]
    assert await _contar("SELECT count(*) FROM leads WHERE email = $1", boa) == 1
    assert await _contar("SELECT count(*) FROM leads WHERE email = $1", ruim) == 0


async def test_tag_avulsa_sob_authenticated(cliente, token_admin, leads_escrita):
    h = _auth(token_admin)
    a, _ = leads_escrita
    r = await cliente.post(f"/contatos/{a}/tags", headers=h, json={"tag": TAG_ESCRITA})
    assert r.status_code == 204, r.text
    assert await _contar(
        "SELECT count(*) FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id "
        "WHERE lt.lead_id = $1::uuid AND t.name = $2", a, TAG_ESCRITA) == 1
    falso = "00000000-0000-0000-0000-000000000000"
    r = await cliente.post(f"/contatos/{falso}/tags", headers=h, json={"tag": TAG_ESCRITA})
    assert r.status_code == 404, r.text


class _Reverter(Exception):
    pass


async def test_recalculo_afeta_a_base_inteira_sob_authenticated(token_admin):
    """A rota reescreve TODOS os leads (e o gatilho de automação reavalia cada
    um): rodá-la de verdade no teste seria escrita em produção. O teste
    executa o MESMO caminho (`recalcular`: marca + `SQL_RECALCULO`) sob
    `authenticated`, como o admin, numa transação revertida, e compara com o
    total que `service_role` vê na mesma transação."""
    from app.routers.contatos import recalcular

    uid = await _uid_admin(token_admin)
    medido = {}
    try:
        async with db.sessao(role="authenticated", user_id=uid) as conn:
            medido["afetadas"] = await recalcular(conn)
            await conn.execute("SET LOCAL ROLE service_role")
            medido["total"] = await conn.fetchval("SELECT count(*) FROM leads")
            raise _Reverter
    except _Reverter:
        pass
    assert medido["total"] > 1000
    assert medido["afetadas"] == medido["total"]


async def test_contatos_importacao_recalculo_e_tag_exigem_admin(cliente, token_usuario):
    h = _auth(token_usuario)
    falso = "00000000-0000-0000-0000-000000000000"
    for metodo, caminho, corpo in [
        ("POST", "/contatos/importar", {"linhas": [{"email": "x@exemplo.invalid"}]}),
        ("POST", "/contatos/recalcular-scores", None),
        ("POST", f"/contatos/{falso}/tags", {"tag": "x"}),
    ]:
        r = await cliente.request(metodo, caminho, json=corpo, headers=h)
        assert r.status_code == 403, (metodo, caminho, r.text)
