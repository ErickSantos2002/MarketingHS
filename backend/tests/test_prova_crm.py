"""A volta do CRM, o receptor de teste do contrato do GrowthHS e a descrição
do card (prova do RD, Tarefa 6; API normal do GrowthHS desde 22/10).

Os testes com `cliente` COMITAM e limpam por e-mail e por hash de chave.
"""

import json
import uuid

import pytest
import pytest_asyncio

import app.database as db
from app.chave_api import gerar_chave
from app.crm import growthhs
from limpeza import apagar_leads

EMAIL = "sonda-prova-crm@exemplo.invalid"
EMAIL_OUTRO = "sonda-prova-crm-outro@exemplo.invalid"
CHAVE_DO_RECEPTOR = "chave-de-teste-do-receptor"
MQL = "MQL - Reunião agendada"
VENDA = "Venda realizada"


def _auth(chave):
    return {"Authorization": f"Bearer {chave}"}


async def _limpar(conn, hashes=()):
    leads = [r["id"] for r in await conn.fetch(
        "SELECT id FROM leads WHERE email = ANY($1::text[])", [EMAIL, EMAIL_OUTRO])]
    await apagar_leads(conn, leads)
    await conn.execute("DELETE FROM ecosystem_identities WHERE email = $1", EMAIL_OUTRO)
    await conn.execute("DELETE FROM api_keys WHERE key_hash = ANY($1::text[])", list(hashes))


@pytest_asyncio.fixture
async def contato():
    await db.init_db()
    if db._pool is None:
        pytest.skip("sem DATABASE_URL")
    async with db.sessao(role="service_role") as conn:
        if not await conn.fetchval(
                "SELECT to_regclass('public.growthhs_receptor_pedidos') IS NOT NULL"):
            pytest.skip("migration 027 ainda não aplicada neste banco")
    escrita, hash_e, pref_e = gerar_chave()
    leitura, hash_l, pref_l = gerar_chave()
    async with db.sessao(role="service_role") as conn:
        await _limpar(conn, (hash_e, hash_l))
        lead = await conn.fetchval(
            "INSERT INTO leads (nome, email, tipo, status) "
            "VALUES ('Sonda CRM', $1, 'teste', 'Lead') RETURNING id::text", EMAIL)
        await conn.execute(
            "INSERT INTO api_keys (name, key_hash, key_prefix, permissions) VALUES "
            "('teste prova crm escrita', $1, $2, 'write'), "
            "('teste prova crm leitura', $3, $4, 'read')", hash_e, pref_e, hash_l, pref_l)
    yield {"lead_id": lead, "escrita": escrita, "leitura": leitura}
    async with db.sessao(role="service_role") as conn:
        await _limpar(conn, (hash_e, hash_l))


def _evento(tipo, **kw):
    corpo = {"source_app": "growthhs", "event_type": tipo,
             "title": "Reunião agendada no GrowthHS", "metadata": {"card_id": 4821}}
    corpo.update(kw)
    return corpo


async def _status(lead_id):
    async with db.sessao(role="service_role") as conn:
        return await conn.fetchval("SELECT status FROM leads WHERE id = $1::uuid", lead_id)


async def _eventos(lead_id, tipo=None):
    async with db.sessao(role="service_role") as conn:
        return await conn.fetch(
            "SELECT source_app, event_type, metadata FROM contact_events "
            "WHERE lead_id = $1::uuid AND ($2::text IS NULL OR event_type = $2)",
            lead_id, tipo)


async def test_evento_growthhs_reuniao_avanca_para_mql(cliente, contato):
    r = await cliente.post("/publico/evento-de-contato", headers=_auth(contato["escrita"]),
                           json=_evento("meeting_scheduled", lead_id=contato["lead_id"]))
    assert r.status_code == 200, r.text
    corpo = r.json()
    assert corpo["lead_id"] == contato["lead_id"]
    assert (corpo["status_anterior"], corpo["status_atual"], corpo["mudou"]) == ("Lead", MQL, True)
    assert corpo["evento_id"]
    assert await _status(contato["lead_id"]) == MQL
    reunioes = await _eventos(contato["lead_id"], "meeting_scheduled")
    # UM evento de reunião (o do GrowthHS) — o de status do painel não se
    # repete, senão o indicador de agendamentos contaria em dobro.
    assert [e["source_app"] for e in reunioes] == ["growthhs"]
    atualizacoes = await _eventos(contato["lead_id"], "contact_updated")
    assert len(atualizacoes) == 1
    meta = atualizacoes[0]["metadata"]
    meta = meta if isinstance(meta, dict) else json.loads(meta)
    assert meta["status_atual"] == MQL and meta["status_anterior"] == "Lead"
    assert meta["source"] == "crm"


async def test_evento_growthhs_venda_fechada_avanca(cliente, contato):
    r = await cliente.post("/publico/evento-de-contato", headers=_auth(contato["escrita"]),
                           json=_evento("deal_won", title="Venda", email=EMAIL.upper()))
    assert r.status_code == 200, r.text
    assert r.json()["status_atual"] == VENDA and r.json()["mudou"] is True
    assert await _status(contato["lead_id"]) == VENDA


async def test_evento_growthhs_nao_volta_estagio(cliente, contato):
    async with db.sessao(role="service_role") as conn:
        await conn.execute("UPDATE leads SET status = $2 WHERE id = $1::uuid",
                           contato["lead_id"], VENDA)
    r = await cliente.post("/publico/evento-de-contato", headers=_auth(contato["escrita"]),
                           json=_evento("meeting_scheduled", lead_id=contato["lead_id"]))
    assert r.status_code == 200, r.text
    assert (r.json()["status_atual"], r.json()["mudou"]) == (VENDA, False)
    assert await _status(contato["lead_id"]) == VENDA
    assert len(await _eventos(contato["lead_id"], "meeting_scheduled")) == 1
    assert await _eventos(contato["lead_id"], "contact_updated") == []


async def test_evento_growthhs_outro_tipo_so_registra(cliente, contato):
    r = await cliente.post("/publico/evento-de-contato", headers=_auth(contato["escrita"]),
                           json=_evento("deal_moved", lead_id=contato["lead_id"]))
    assert r.status_code == 200
    assert r.json()["mudou"] is False and await _status(contato["lead_id"]) == "Lead"


async def test_evento_growthhs_acha_por_email_e_por_lead_id(cliente, contato):
    for corpo in (_evento("deal_moved", email=f"  {EMAIL.upper()} "),
                  _evento("deal_moved", lead_id=contato["lead_id"])):
        r = await cliente.post("/publico/evento-de-contato",
                               headers=_auth(contato["escrita"]), json=corpo)
        assert r.status_code == 200, r.text
        assert r.json()["lead_id"] == contato["lead_id"]


async def test_evento_growthhs_lead_inexistente_404(cliente, contato):
    for corpo in (_evento("deal_won", lead_id=str(uuid.uuid4())),
                  _evento("deal_won", email="ninguem-prova-crm@exemplo.invalid"),
                  _evento("deal_won", lead_id="não é uuid")):
        r = await cliente.post("/publico/evento-de-contato",
                               headers=_auth(contato["escrita"]), json=corpo)
        assert r.status_code == 404, (corpo, r.text)
    r = await cliente.post("/publico/evento-de-contato", headers=_auth(contato["escrita"]),
                           json=_evento("deal_won"))
    assert r.status_code == 400


async def test_evento_growthhs_exige_chave_write(cliente, contato):
    r = await cliente.post("/publico/evento-de-contato", headers=_auth(contato["leitura"]),
                           json=_evento("deal_won", lead_id=contato["lead_id"]))
    assert r.status_code == 403
    assert await _status(contato["lead_id"]) == "Lead"


async def test_evento_de_outro_source_app_continua_como_antes(cliente, contato):
    r = await cliente.post("/publico/evento-de-contato", headers=_auth(contato["escrita"]),
                           json={"source_app": "website", "event_type": "page_view",
                                 "title": "Visitou", "email": EMAIL})
    assert r.status_code == 200, r.text
    assert set(r.json()) == {"evento_id", "dnia_id", "lead_id"}
    async with db.sessao(role="service_role") as conn:
        await conn.execute(
            "DELETE FROM ecosystem_identities WHERE email = $1 AND dnia_id = $2::uuid",
            EMAIL, r.json()["dnia_id"])
        await conn.execute("DELETE FROM contact_events WHERE id = $1::uuid",
                           r.json()["evento_id"])


async def test_status_aceita_email_e_lead_id(cliente, contato):
    r = await cliente.post("/publico/contato/status", headers=_auth(contato["escrita"]),
                           json={"email": EMAIL.upper(), "status": "Lead Qualificado"})
    assert r.status_code == 200, r.text
    assert r.json()["lead_id"] == contato["lead_id"]
    assert r.json()["status_atual"] == "Lead Qualificado"
    r = await cliente.post("/publico/contato/status", headers=_auth(contato["escrita"]),
                           json={"lead_id": contato["lead_id"], "status": "Lead"})
    assert r.status_code == 200, r.text
    assert r.json()["status_anterior"] == "Lead Qualificado"
    assert await _status(contato["lead_id"]) == "Lead"


async def test_status_sem_identificador_400(cliente, contato):
    r = await cliente.post("/publico/contato/status", headers=_auth(contato["escrita"]),
                           json={"status": "Lead"})
    assert r.status_code == 400
    r = await cliente.post("/publico/contato/status", headers=_auth(contato["escrita"]),
                           json={"lead_id": str(uuid.uuid4()), "status": "Lead"})
    assert r.status_code == 404


# ── Ordem da busca do lead (contrato: lead_id → e-mail → dnia_id) ──────────

async def _identidade_de_outro_lead():
    """Um SEGUNDO lead, com identidade própria — para provar que o `dnia_id`
    só é usado depois do e-mail."""
    async with db.sessao(role="service_role") as conn:
        outro = await conn.fetchval(
            "INSERT INTO leads (nome, email, tipo, status) "
            "VALUES ('Outro', $1, 'teste', 'Lead') RETURNING id::text", EMAIL_OUTRO)
        dnia = await conn.fetchval(
            "INSERT INTO ecosystem_identities (email, dndash_lead_id) "
            "VALUES ($1, $2::uuid) RETURNING dnia_id::text", EMAIL_OUTRO, outro)
        await conn.execute("UPDATE leads SET dnia_id = $2::uuid WHERE id = $1::uuid",
                           outro, dnia)
    return outro, dnia


async def test_busca_email_vem_antes_do_dnia_id(cliente, contato):
    outro, dnia = await _identidade_de_outro_lead()
    r = await cliente.post("/publico/evento-de-contato", headers=_auth(contato["escrita"]),
                           json=_evento("deal_moved", email=EMAIL, dnia_id=dnia))
    assert r.status_code == 200, r.text
    assert r.json()["lead_id"] == contato["lead_id"]


async def test_lead_id_inexistente_cai_para_o_email(cliente, contato):
    r = await cliente.post("/publico/evento-de-contato", headers=_auth(contato["escrita"]),
                           json=_evento("deal_moved", lead_id=str(uuid.uuid4()), email=EMAIL))
    assert r.status_code == 200, r.text
    assert r.json()["lead_id"] == contato["lead_id"]


async def test_lead_id_e_email_inexistentes_caem_para_o_dnia_id(cliente, contato):
    outro, dnia = await _identidade_de_outro_lead()
    r = await cliente.post("/publico/evento-de-contato", headers=_auth(contato["escrita"]),
                           json=_evento("deal_moved", lead_id=str(uuid.uuid4()),
                                        email="ninguem-prova-crm@exemplo.invalid",
                                        dnia_id=dnia))
    assert r.status_code == 200, r.text
    assert r.json()["lead_id"] == outro


async def test_dnia_id_mal_formado_da_400_nos_dois_caminhos(cliente, contato):
    """Antes: o texto ia direto para `$1::uuid` e virava 500."""
    for corpo in (_evento("deal_won", dnia_id="nao-e-uuid"),
                  {"source_app": "website", "event_type": "page_view", "title": "x",
                   "dnia_id": "nao-e-uuid"}):
        r = await cliente.post("/publico/evento-de-contato",
                               headers=_auth(contato["escrita"]), json=corpo)
        assert r.status_code == 400, (corpo, r.text)
        assert "dnia_id" in r.text


async def test_lead_excluido_nao_e_achado(cliente, contato):
    """Contato excluído (`deleted_at`) não recebe estágio do CRM nem da API —
    nem por `lead_id`, nem por e-mail, nem por `dnia_id`."""
    outro, dnia = await _identidade_de_outro_lead()
    async with db.sessao(role="service_role") as conn:
        await conn.execute(
            "UPDATE leads SET deleted_at = now() WHERE id = ANY($1::uuid[])",
            [contato["lead_id"], outro])
    cab = _auth(contato["escrita"])
    for corpo in (_evento("deal_won", lead_id=contato["lead_id"]),
                  _evento("deal_won", email=EMAIL),
                  _evento("deal_won", dnia_id=dnia)):
        r = await cliente.post("/publico/evento-de-contato", headers=cab, json=corpo)
        assert r.status_code == 404, (corpo, r.text)
    for corpo in ({"lead_id": contato["lead_id"], "status": VENDA},
                  {"email": EMAIL, "status": VENDA},
                  {"dnia_id": dnia, "status": VENDA}):
        r = await cliente.post("/publico/contato/status", headers=cab, json=corpo)
        assert r.status_code == 404, (corpo, r.text)
    async with db.sessao(role="service_role") as conn:
        assert await conn.fetchval(
            "SELECT count(*) FROM leads WHERE id = ANY($1::uuid[]) AND status = $2",
            [contato["lead_id"], outro], VENDA) == 0


# ── Receptor de teste ────────────────────────────────────────────────────────

def _card(external_id=None, **kw):
    """O corpo do contrato ANTIGO (`POST /integration/cards`), montado à mão.
    O `growthhs.montar_card` agora é o da API normal (22/10); o receptor de
    teste continua implementando o contrato morto, desligado, e continua
    testado até a limpeza que o remover."""
    corpo = {"source": "marketinghs", "external_id": external_id or str(uuid.uuid4()),
             "board_id": 3, "list_id": None, "title": "Sonda — Sonda SA",
             "description": "Campanha: —\nDesafios: —\nIndicação: —",
             "contact": {"name": "Sonda", "email": EMAIL, "phone": None,
                         "company": "Sonda SA", "job_title": None},
             "origin": "Orgânico", "acquisition_channel": "Inbound",
             "utm_source": None, "utm_campaign": None, "utm_term": None,
             "utm_params": None,
             "business_info": {"faturamento": None, "funcionarios": None,
                               "lead_score": None, "etiqueta": None},
             "custom_fields": {}, "conversion": None, "consent": None}
    corpo.update(kw)
    return corpo


async def _limpar_pedidos_da_sonda():
    """Todo pedido com o e-mail da sonda é desta suíte — inclusive o de uma
    rodada que morreu no meio (ou de um teste que falhou antes do `finally`)."""
    async with db.sessao(role="service_role") as conn:
        await conn.execute(
            "DELETE FROM growthhs_receptor_pedidos WHERE corpo->'contact'->>'email' = $1",
            EMAIL)


@pytest_asyncio.fixture
async def receptor(monkeypatch):
    from app.config import settings
    from app.routers import receptor_growthhs

    async def segredo(nome):
        assert nome == "GROWTHHS_API_KEY"
        return CHAVE_DO_RECEPTOR

    await db.init_db()
    if db._pool is None:
        pytest.skip("sem DATABASE_URL")
    await _limpar_pedidos_da_sonda()
    monkeypatch.setattr(settings, "PROVA_RECEPTOR_TESTE", True)
    monkeypatch.setattr(receptor_growthhs, "ler_segredo", segredo)
    yield receptor_growthhs
    await db.init_db()
    await _limpar_pedidos_da_sonda()


async def _limpar_pedidos(*ids):
    async with db.sessao(role="service_role") as conn:
        await conn.execute(
            "DELETE FROM growthhs_receptor_pedidos WHERE external_id = ANY($1::text[])",
            list(ids))


async def test_receptor_desligado_da_404(cliente, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "PROVA_RECEPTOR_TESTE", False)
    assert (await cliente.get("/teste/growthhs/health")).status_code == 404
    r = await cliente.post("/teste/growthhs/api/v1/integration/cards", json=_card(),
                           headers={"X-API-Key": CHAVE_DO_RECEPTOR})
    assert r.status_code == 404


async def test_receptor_health(cliente, receptor):
    assert (await cliente.get("/teste/growthhs/health")).status_code == 200


async def test_receptor_sem_chave_certa_401(cliente, receptor):
    for cab in ({}, {"X-API-Key": "errada"}):
        r = await cliente.post("/teste/growthhs/api/v1/integration/cards", json=_card(),
                               headers=cab)
        assert r.status_code == 401


async def test_receptor_corpo_sem_external_id_422(cliente, receptor):
    cab = {"X-API-Key": CHAVE_DO_RECEPTOR}
    for ruim in ({"external_id": None}, {"external_id": "nao-uuid"}, {"source": "rd"},
                 {"board_id": "x"}, {"title": ""}, {"contact": {"name": "x"}}):
        r = await cliente.post("/teste/growthhs/api/v1/integration/cards",
                               json={**_card(), **ruim}, headers=cab)
        assert r.status_code == 422, ruim


async def test_receptor_cria_201_e_repete_200_mesmo_id(cliente, receptor):
    external_id = str(uuid.uuid4())
    cab = {"X-API-Key": CHAVE_DO_RECEPTOR}
    try:
        r1 = await cliente.post("/teste/growthhs/api/v1/integration/cards",
                                json=_card(external_id), headers=cab)
        assert r1.status_code == 201, r1.text
        corpo = r1.json()
        assert set(corpo) == {"id", "list_id", "title", "external_source", "external_id",
                              "client_id", "person_id", "created"}
        assert corpo["external_id"] == external_id and corpo["created"] is True
        assert corpo["external_source"] == "marketinghs" and corpo["list_id"] is None
        r2 = await cliente.post("/teste/growthhs/api/v1/integration/cards",
                                json=_card(external_id, title="outro título"), headers=cab)
        assert r2.status_code == 200
        assert r2.json()["id"] == corpo["id"] and r2.json()["created"] is False
        async with db.sessao(role="service_role") as conn:
            linha = await conn.fetchrow(
                "SELECT vezes, corpo FROM growthhs_receptor_pedidos WHERE external_id = $1",
                external_id)
        assert linha["vezes"] == 2
        guardado = linha["corpo"] if isinstance(linha["corpo"], dict) else json.loads(linha["corpo"])
        assert guardado["title"] == "Sonda — Sonda SA"     # o 1º corpo, intacto
    finally:
        await _limpar_pedidos(external_id)


async def test_receptor_card_distinto_por_external_id(cliente, receptor):
    """A3 (achado da prova, 22/10: "o receptor devolve o mesmo `card_id` para
    leads diferentes"). O receptor dá um card por `external_id`. O que a prova
    viu foi outra coisa: os 4 leads do teste tinham o MESMO `dnia_id` (mesmo
    telefone → mesma pessoa no `resolve_ecosystem_identity`), e a entrega
    (`_ja_entregue`) reaproveita o card da pessoa sem chamar o GrowthHS — só
    1 pedido chegou ao receptor (`vezes = 1`). Comportamento desejado: um
    card por pessoa."""
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    cab = {"X-API-Key": CHAVE_DO_RECEPTOR}
    url = "/teste/growthhs/api/v1/integration/cards"
    try:
        ra = await cliente.post(url, json=_card(a), headers=cab)
        rb = await cliente.post(url, json=_card(b), headers=cab)
        assert ra.status_code == rb.status_code == 201
        assert ra.json()["id"] != rb.json()["id"]
        ra2 = await cliente.post(url, json=_card(a), headers=cab)
        assert ra2.status_code == 200 and ra2.json()["id"] == ra.json()["id"]
    finally:
        await _limpar_pedidos(a, b)


async def test_receptor_lista_pedidos_so_admin(cliente, receptor, token_admin, token_usuario):
    r = await cliente.get("/teste/growthhs/pedidos", headers=_auth(token_usuario))
    assert r.status_code == 403
    r = await cliente.get("/teste/growthhs/pedidos", headers=_auth(token_admin))
    assert r.status_code == 200 and isinstance(r.json(), list)


# ── Descrição do card (puro) ─────────────────────────────────────────────────

FRONT = "https://mkt.exemplo.invalid"


def test_descricao_leva_conversao_consentimento_e_campos_extras():
    """Prova do RD: o que ia em `custom_fields`/`conversion`/`consent` no
    contrato antigo vai para a `description` — o card comercial não tem essas
    chaves (§3 de integracao-marketinghs.md)."""
    lead = {"id": str(uuid.uuid4()), "nome": "Ana", "email": "a@x.com",
            "campos_extras": {"ja_faz_testagem": "sim"}}
    conversao = {"page_slug": "phoebus-prova", "form_id": None, "site_nome": None,
                 "page_url": None, "converted_at": "2026-10-21T13:00:00Z",
                 "canal": "pago", "gclid": None}
    consentimento = {"base_legal": "consentimento", "versao": "provisoria-2026-10",
                     "provisoria": True, "criado_em": "2026-10-21T13:00:00Z"}
    texto = growthhs.montar_descricao(lead, conversao=conversao,
                                      consentimento=consentimento, frontend_url=FRONT)
    linhas = texto.split("\n")
    assert "Respostas do formulário:" in linhas and "- ja_faz_testagem: sim" in linhas
    assert "Conversão: página phoebus-prova" in linhas and "Canal: pago" in linhas
    assert "Data da conversão: 21/10/2026 10:00" in linhas
    assert "Base legal: consentimento" in linhas
    assert "Versão do consentimento: provisoria-2026-10 (provisória)" in linhas
    assert "Data do consentimento: 21/10/2026 10:00" in linhas
    assert linhas[-1] == f"Ver no MarketingHS: {FRONT}/contacts?contato={lead['id']}"
    vazio = growthhs.montar_descricao({"id": lead["id"], "email": "a@x.com"},
                                      conversao=None, consentimento=None,
                                      frontend_url=FRONT)
    assert vazio == f"Ver no MarketingHS: {FRONT}/contacts?contato={lead['id']}"


async def test_entrega_le_ultima_conversao_e_consentimento(conexao):
    from app.crm import entrega
    lead = await conexao.fetchval(
        "INSERT INTO leads (email, tipo, campos_extras) VALUES ($1, 'teste', $2::jsonb) "
        "RETURNING id::text", "prova-crm-entrega@exemplo.invalid", {"x": "1"})
    visitante = f"vis-prova-crm-{uuid.uuid4()}"
    conv = await conexao.fetchval(
        "INSERT INTO lead_conversions (lead_id, tipo, page_slug, canal, converted_at, "
        "visitor_id) VALUES ($1::uuid, 'lead', 'phoebus-prova', 'pago', now(), $2) "
        "RETURNING id", lead, visitante)
    await conexao.execute(
        "INSERT INTO lead_conversions (lead_id, tipo, page_slug, converted_at) "
        "VALUES ($1::uuid, 'lead', 'antiga', now() - interval '1 day')", lead)
    await conexao.execute(
        "INSERT INTO lead_consents (lead_id, conversao_id, base_legal, texto, versao, "
        "provisoria) VALUES ($1::uuid, $2, 'consentimento', 't', 'v1', true)", lead, conv)
    # O gclid é o da visita MAIS RECENTE com gclid do mesmo visitante: a
    # visita mais nova de todas não tem gclid (voltou direto) e não apaga o
    # clique pago; a mais velha com gclid perde para a mais nova com gclid;
    # a de outro visitante não conta; a visita DEPOIS da conversão não foi o
    # clique que a trouxe.
    await conexao.execute(
        "INSERT INTO visitas (visitor_id, page_slug, canal, gclid, criado_em) VALUES "
        "($1, 'phoebus-prova', 'pago', 'gclid-velho', now() - interval '3 hours'), "
        "($1, 'phoebus-prova', 'pago', 'gclid-novo', now() - interval '2 hours'), "
        "($1, 'phoebus-prova', 'direto', NULL, now() - interval '1 hour'), "
        "($1, 'phoebus-prova', 'pago', 'gclid-depois', now() + interval '1 hour'), "
        "($2, 'phoebus-prova', 'pago', 'gclid-de-outro', now())",
        visitante, f"{visitante}-outro")
    conversao, consentimento = await entrega.origem_do_card(conexao, lead)
    assert conversao["page_slug"] == "phoebus-prova" and conversao["canal"] == "pago"
    assert conversao["gclid"] == "gclid-novo"
    assert consentimento["versao"] == "v1" and consentimento["provisoria"] is True
    linha = dict(await conexao.fetchrow(
        f"SELECT {entrega._COLUNAS_LEAD} FROM leads WHERE id = $1::uuid", lead))
    cfg = growthhs.Config(base_url="https://x.invalid", client_id="c", client_secret="s",
                          list_id=22, boards_conferidos=(6, 7), app_url=None)
    card = growthhs.montar_card(linha, cfg, conversao=conversao, consentimento=consentimento,
                                person_id=1, frontend_url=FRONT, pedido_id=1)
    assert "- x: 1" in card["description"].split("\n")
    assert card["origin"] == "Landing Page phoebus-prova"
    assert card["gclid"] == "gclid-novo"
    assert "Versão do consentimento: v1 (provisória)" in card["description"]

    # Conversão sem visitante: gclid nulo, sem erro.
    sem_visitante = await conexao.fetchval(
        "INSERT INTO leads (email, tipo) VALUES ($1, 'teste') RETURNING id::text",
        "prova-crm-entrega-2@exemplo.invalid")
    await conexao.execute(
        "INSERT INTO lead_conversions (lead_id, tipo, form_id, converted_at) "
        "VALUES ($1::uuid, 'lead', 'contato', now())", sem_visitante)
    conversao, _ = await entrega.origem_do_card(conexao, sem_visitante)
    assert conversao["form_id"] == "contato" and conversao["gclid"] is None
