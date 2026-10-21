"""Sites com token público, visita e conversão de outro domínio (prova do RD,
Tarefa 4).

Os de `mapear` e `origem_permitida` são puros. Os outros usam `cliente` (o
que passa por ele é GRAVADO) e apagam tudo no fim, por id/e-mail/visitante.
"""

import json

import pytest
import pytest_asyncio

from app import database as db
from app.captura.mapa import mapear
from app.routers.rastreio import origem_permitida
from limpeza import apagar_leads, apagar_visitas

DOMINIO = "prova-site.exemplo.invalid"
ORIGEM = f"https://{DOMINIO}"
EMAIL = "sonda-prova-site@exemplo.invalid"
SLUG = "sonda-prova-site"
VISITANTE = "vid-sonda-prova-site"
TAG = "sonda-prova-site-tag"
NOME_DO_SITE = "Sonda prova site"


# ── Puros ────────────────────────────────────────────────────────────────────

def test_mapear_campos_do_site_da_hs():
    email, colunas, extras = mapear(
        {"pnome": "Ana", "pemail": "a@x.com", "pwhatsapp": "31999999999",
         "pmensagem": "oi", "passunto": "Phoebus"}, {})
    assert email == "a@x.com"
    assert colunas == {"nome": "Ana", "whatsapp": "+5531999999999"}
    assert extras == {"mensagem": "oi", "assunto": "Phoebus"}


def test_mapear_nomes_comuns_e_telefone_que_nao_normaliza():
    email, colunas, extras = mapear(
        {"name": "Ana", "E-mail": "a@x.com", "phone": "ramal 22", "company": "X",
         "message": "m", "campo_do_site": "ignorado"}, {})
    assert email == "a@x.com"
    # Telefone que não normaliza fica como veio: é o que a pessoa digitou.
    assert colunas == {"nome": "Ana", "whatsapp": "ramal 22", "empresa": "X"}
    assert extras == {"mensagem": "m"}


def test_mapear_ignora_senha_cartao_e_captcha():
    email, colunas, extras = mapear(
        {"email": "a@x.com", "senha": "123", "password": "x", "card_number": "4111",
         "g-recaptcha-response": "tok", "cvv": "1", "csrf_token": "t"},
        {"senha": "nome", "cvv": "cargo"})
    assert email == "a@x.com" and colunas == {} and extras == {}


def test_mapa_do_site_vence_o_padrao():
    email, colunas, extras = mapear(
        {"pnome": "Ana", "pemail": "a@x.com", "xyz": "Transportes", "obs": "nota"},
        {"pnome": "cargo", "xyz": "empresa", "obs": "observacao", "pemail": "email"})
    assert email == "a@x.com"
    assert colunas == {"cargo": "Ana", "empresa": "Transportes"}
    assert extras == {"observacao": "nota"}


def test_mapa_nao_escreve_estado_nem_origem():
    _, colunas, extras = mapear(
        {"email": "a@x.com", "a": "Venda realizada", "b": "google", "c": "x"},
        {"a": "status", "b": "utm_source", "c": "Chave Ruim"})
    assert colunas == {} and extras == {}


def test_origem_permitida():
    dominios = ["www.healthsafety.com.br", "localhost:8099", "127.0.0.1"]
    assert origem_permitida("https://www.healthsafety.com.br", dominios)
    assert origem_permitida("https://WWW.healthsafety.com.br", dominios)
    assert not origem_permitida("http://www.healthsafety.com.br", dominios)
    assert not origem_permitida("https://healthsafety.com.br", dominios)
    assert not origem_permitida("https://www.healthsafety.com.br.evil.com", dominios)
    assert origem_permitida("http://localhost:8099", dominios)
    assert not origem_permitida("http://localhost:8100", dominios)
    assert origem_permitida("http://127.0.0.1:5500", dominios)
    assert not origem_permitida(None, dominios)
    assert not origem_permitida("null", dominios)
    assert not origem_permitida("", dominios)


class _SessaoFalsa:
    """Conta as idas ao "banco" e responde que o token não existe."""

    def __init__(self):
        self.consultas = 0

    def __call__(self, **_kw):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    async def fetchrow(self, *_a):
        self.consultas += 1
        return None


async def test_token_de_formato_invalido_nao_consulta_o_banco(monkeypatch):
    from app.routers import rastreio
    falsa = _SessaoFalsa()
    monkeypatch.setattr(rastreio, "sessao", falsa)
    for ruim in (None, 123, "", "pub_", "pub_curto", "pub_" + "x" * 31, "pub_" + "x" * 33,
                 "pub_" + "x" * 31 + "!", "xyz_" + "x" * 32, "pub_" + "x" * 32 + "\n"):
        assert await rastreio._site_do_token(ruim) is None, ruim
    assert falsa.consultas == 0


async def test_tokens_inventados_nao_aumentam_o_cache(monkeypatch):
    import secrets
    from app.routers import rastreio
    falsa = _SessaoFalsa()
    monkeypatch.setattr(rastreio, "sessao", falsa)
    rastreio._limpar_cache()
    for _ in range(1000):
        assert await rastreio._site_do_token("pub_" + secrets.token_urlsafe(24)) is None
    assert falsa.consultas == 1000
    assert len(rastreio._cache) == 0


async def test_cache_tem_teto_e_despeja_o_mais_antigo(monkeypatch):
    import secrets
    from app.routers import rastreio

    class _Achada(_SessaoFalsa):
        async def fetchrow(self, *_a):
            self.consultas += 1
            return {"id": "x", "nome": "n", "dominios": [], "mapa_campos": {}, "tags": []}

    monkeypatch.setattr(rastreio, "sessao", _Achada())
    rastreio._limpar_cache()
    tokens = ["pub_" + secrets.token_urlsafe(24) for _ in range(rastreio.CACHE_MAXIMO + 10)]
    for t in tokens:
        assert await rastreio._site_do_token(t) is not None
    assert len(rastreio._cache) == rastreio.CACHE_MAXIMO
    assert tokens[0] not in rastreio._cache and tokens[-1] in rastreio._cache
    # Expirada some na leitura.
    rastreio._cache[tokens[-1]] = (rastreio._cache[tokens[-1]][0], 0.0)
    await rastreio._site_do_token(tokens[-1])
    assert rastreio._cache[tokens[-1]][1] > 0.0
    rastreio._limpar_cache()


# ── Banco ────────────────────────────────────────────────────────────────────

async def _limpar():
    async with db.sessao(role="service_role") as conn:
        leads = [r["id"] for r in await conn.fetch(
            "SELECT id FROM leads WHERE email = $1", EMAIL)]
        identidades = [r["dnia_id"] for r in await conn.fetch(
            "SELECT dnia_id FROM ecosystem_identities WHERE email = $1", EMAIL)]
        await conn.execute(
            "DELETE FROM contact_events WHERE dnia_id = ANY($1::uuid[])", identidades)
        await conn.execute(
            "DELETE FROM lead_conversions WHERE lead_id = ANY($1::uuid[])", leads)
        await apagar_leads(conn, leads)
        await conn.execute(
            "DELETE FROM ecosystem_identities WHERE dnia_id = ANY($1::uuid[])", identidades)
        await apagar_visitas(conn, [VISITANTE])
        await conn.execute("DELETE FROM sites WHERE nome = $1", NOME_DO_SITE)
        await conn.execute("DELETE FROM pages WHERE slug = $1", SLUG)
        await conn.execute("DELETE FROM tags WHERE name = ANY($1::text[])", [TAG, SLUG])


def _limpar_caches():
    from app.captura import email as vemail
    from app.middleware import cors_sites
    from app.routers import landing, rastreio
    vemail._limpar_cache()
    landing._limpar_cache()
    rastreio._limpar_cache()
    cors_sites._limpar_cache()


@pytest_asyncio.fixture
async def site(monkeypatch):
    """Um site ativo da prova e uma página ativa; devolve o token."""
    from app.captura import email as vemail

    async def sempre_tem_mx(_dominio):
        return True

    monkeypatch.setattr(vemail, "_tem_mx", sempre_tem_mx)
    await db.init_db()
    if db._pool is None:
        pytest.skip("sem DATABASE_URL")
    async with db.sessao(role="service_role") as conn:
        if not await conn.fetchval("SELECT to_regclass('public.sites') IS NOT NULL"):
            pytest.skip("migration 027 ainda não aplicada neste banco")
    _limpar_caches()
    await _limpar()
    async with db.sessao(role="service_role") as conn:
        from app.routers.sites import _novo_token
        token = await conn.fetchval(
            """INSERT INTO sites (nome, dominios, token, tags)
               VALUES ($1, $2, $3, $4) RETURNING token""",
            NOME_DO_SITE, [DOMINIO], _novo_token(), [TAG])
        await conn.execute(
            """INSERT INTO pages (name, slug, component_name, page_type, status, config)
               VALUES ('Sonda site', $1, 'SondaSite', 'landing', 'active', '{}')""", SLUG)
    yield token
    await _limpar()
    _limpar_caches()


def _conversao(token, **kw):
    corpo = {"token": token, "visitor_id": VISITANTE, "form_id": "prova_cap_phoebus",
             "url": f"{ORIGEM}/cotacao.cfm?utm_source=google",
             "campos": {"pnome": "Ana Site", "pemail": EMAIL, "pwhatsapp": "31977776666",
                        "pmensagem": "quero cotação", "passunto": "Phoebus"},
             "toque": {"utm": {"utm_source": "newsletter", "utm_medium": "email"},
                       "referrer": None},
             "primeiro_toque": {"utm": {"utm_source": "google", "utm_medium": "cpc"},
                                "gclid": "g1", "referrer": "https://www.google.com/"}}
    corpo.update(kw)
    return corpo


async def _postar(cliente, caminho, corpo, origem=ORIGEM, tipo="text/plain;charset=UTF-8"):
    cabecalhos = {"Content-Type": tipo}
    if origem:
        cabecalhos["Origin"] = origem
    return await cliente.post(caminho, content=json.dumps(corpo), headers=cabecalhos)


def _json(v):
    return v if isinstance(v, (dict, list)) or v is None else json.loads(v)


async def test_conversao_de_site_cria_lead_com_form_id_e_evento(cliente, site):
    r = await _postar(cliente, "/publico/site/conversao", _conversao(site),
                      tipo="application/json")
    assert r.status_code == 202, r.text
    assert r.json() == {"ok": True}
    async with db.sessao(role="service_role") as conn:
        lead = await conn.fetchrow(
            "SELECT id, nome, whatsapp, utm_source, utm_medium, campos_extras FROM leads "
            "WHERE email = $1", EMAIL)
        assert lead["nome"] == "Ana Site" and lead["whatsapp"] == "+5531977776666"
        # O PRIMEIRO toque vai para o contato; o toque desta visita, para a conversão.
        assert (lead["utm_source"], lead["utm_medium"]) == ("google", "cpc")
        assert _json(lead["campos_extras"]) == {"mensagem": "quero cotação",
                                                "assunto": "Phoebus"}
        conv = await conn.fetchrow(
            "SELECT * FROM lead_conversions WHERE lead_id = $1", lead["id"])
        assert conv["form_id"] == "prova_cap_phoebus"
        assert conv["visitor_id"] == VISITANTE
        assert conv["page_path"] == "/cotacao.cfm"
        assert conv["page_url"].startswith(ORIGEM)
        assert conv["utm_source"] == "newsletter" and conv["canal"] == "email"
        assert conv["site_id"] is not None and conv["page_slug"] is None
        tags = {t["name"] for t in await conn.fetch(
            "SELECT t.name FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id "
            "WHERE lt.lead_id = $1", lead["id"])}
        assert tags == {TAG}
        evento = await conn.fetchval(
            "SELECT metadata FROM contact_events WHERE lead_id = $1 "
            "AND event_type = 'form_submitted'", lead["id"])
        assert _json(evento)["form_id"] == "prova_cap_phoebus"
        assert _json(evento)["site_id"] == str(conv["site_id"])
        consent = await conn.fetchrow(
            "SELECT * FROM lead_consents WHERE lead_id = $1", lead["id"])
        assert consent["base_legal"] == "legitimo_interesse_pedido_contato"
        assert consent["versao"] == "provisoria-2026-10" and consent["provisoria"] is True
        assert consent["origem_tipo"] == "site" and consent["form_id"] == "prova_cap_phoebus"
        assert consent["conversao_id"] == conv["id"]


async def test_conversao_de_site_repetida_nao_duplica_e_conta_nova_conversao(cliente, site):
    assert (await _postar(cliente, "/publico/site/conversao", _conversao(site))).status_code == 202
    segunda = _conversao(site)
    segunda["campos"]["pnome"] = "Outro Nome"
    assert (await _postar(cliente, "/publico/site/conversao", segunda)).status_code == 202
    async with db.sessao(role="service_role") as conn:
        leads = await conn.fetch("SELECT id, nome FROM leads WHERE email = $1", EMAIL)
        assert len(leads) == 1 and leads[0]["nome"] == "Ana Site"
        assert await conn.fetchval(
            "SELECT count(*) FROM lead_conversions WHERE lead_id = $1", leads[0]["id"]) == 2
        eventos = [_json(e["metadata"]) for e in await conn.fetch(
            "SELECT metadata FROM contact_events WHERE lead_id = $1 "
            "AND event_type = 'form_submitted'", leads[0]["id"])]
        assert len(eventos) == 2
        reconversoes = [e for e in eventos if e.get("reconversao")]
        assert len(reconversoes) == 1
        assert reconversoes[0]["form_id"] == "prova_cap_phoebus"
        assert reconversoes[0]["origem"] == "site"


async def _nada_gravado():
    async with db.sessao(role="service_role") as conn:
        return await conn.fetchval("SELECT count(*) FROM leads WHERE email = $1", EMAIL) == 0


async def test_conversao_sem_origin_da_403_e_nao_grava(cliente, site):
    r = await _postar(cliente, "/publico/site/conversao", _conversao(site), origem=None)
    assert r.status_code == 403
    assert await _nada_gravado()


async def test_conversao_com_origin_de_outro_dominio_da_403(cliente, site):
    r = await _postar(cliente, "/publico/site/conversao", _conversao(site),
                      origem="https://outro.exemplo.invalid")
    assert r.status_code == 403
    assert "access-control-allow-origin" not in r.headers
    assert await _nada_gravado()


async def test_token_invalido_da_403(cliente, site):
    r = await _postar(cliente, "/publico/site/conversao", _conversao("pub_" + "x" * 32))
    assert r.status_code == 403
    assert await _nada_gravado()


async def test_site_inativo_recusa(cliente, site):
    async with db.sessao(role="service_role") as conn:
        await conn.execute("UPDATE sites SET ativo = false WHERE token = $1", site)
    _limpar_caches()
    r = await _postar(cliente, "/publico/site/conversao", _conversao(site))
    assert r.status_code == 403
    assert await _nada_gravado()


async def test_conversao_sem_email_da_400(cliente, site):
    corpo = _conversao(site)
    del corpo["campos"]["pemail"]
    assert (await _postar(cliente, "/publico/site/conversao", corpo)).status_code == 400
    corpo["campos"]["pemail"] = "sem-arroba"
    assert (await _postar(cliente, "/publico/site/conversao", corpo)).status_code == 400
    assert await _nada_gravado()


async def test_corpo_text_plain_e_aceito(cliente, site):
    r = await _postar(cliente, "/publico/site/conversao", _conversao(site),
                      tipo="text/plain")
    assert r.status_code == 202, r.text
    assert r.headers["access-control-allow-origin"] == ORIGEM
    assert "access-control-allow-credentials" not in r.headers


async def test_corpo_grande_ou_invalido(cliente, site):
    r = await cliente.post("/publico/site/conversao", content="x" * 17000,
                           headers={"Origin": ORIGEM, "Content-Type": "text/plain"})
    assert r.status_code == 413
    r = await cliente.post("/publico/site/conversao", content="não é json",
                           headers={"Origin": ORIGEM, "Content-Type": "text/plain"})
    assert r.status_code == 400


async def test_visita_grava_canal_visitor_e_primeiro_toque(cliente, site):
    corpo = {"token": site, "visitor_id": VISITANTE, "url": f"{ORIGEM}/produtos?gclid=x",
             "titulo": "Produtos", "referrer": "https://www.google.com/",
             "utm": {"utm_source": "google", "utm_medium": "cpc"}, "gclid": "x",
             "primeiro_toque": {"utm": {}, "referrer": "https://www.google.com/"}}
    r = await _postar(cliente, "/publico/site/visita", corpo)
    assert r.status_code == 202, r.text
    async with db.sessao(role="service_role") as conn:
        v = await conn.fetchrow("SELECT * FROM visitas WHERE visitor_id = $1", VISITANTE)
    assert v["canal"] == "pago" and v["path"] == "/produtos" and v["titulo"] == "Produtos"
    assert v["utm_source"] == "google" and v["gclid"] == "x"
    assert v["site_id"] is not None and v["page_slug"] is None
    assert _json(v["primeiro_toque"])["referrer"] == "https://www.google.com/"


async def test_visita_por_pagina_exige_origin_do_frontend(cliente, site):
    from app.config import settings
    corpo = {"pagina": SLUG, "visitor_id": VISITANTE, "url": f"{settings.FRONTEND_URL}/p/{SLUG}",
             "referrer": None, "utm": {}}
    r = await _postar(cliente, "/publico/site/visita", corpo, origem=ORIGEM)
    assert r.status_code == 403
    r = await _postar(cliente, "/publico/site/visita", {**corpo, "pagina": "nao-existe"},
                      origem=settings.FRONTEND_URL)
    assert r.status_code == 403
    r = await _postar(cliente, "/publico/site/visita", corpo, origem=settings.FRONTEND_URL)
    assert r.status_code == 202, r.text
    async with db.sessao(role="service_role") as conn:
        v = await conn.fetchrow("SELECT * FROM visitas WHERE visitor_id = $1", VISITANTE)
    assert v["page_slug"] == SLUG and v["site_id"] is None and v["canal"] == "direto"


async def test_cors_reflete_so_dominio_cadastrado(cliente, site):
    cabecalhos = {"Access-Control-Request-Method": "POST",
                  "Access-Control-Request-Headers": "content-type"}
    r = await cliente.options("/publico/site/conversao",
                              headers={**cabecalhos, "Origin": ORIGEM})
    assert r.status_code == 204
    assert r.headers["access-control-allow-origin"] == ORIGEM
    assert "origin" in r.headers.get("vary", "").lower()
    assert "access-control-allow-credentials" not in r.headers
    r = await cliente.options("/publico/site/conversao",
                              headers={**cabecalhos, "Origin": "https://outro.exemplo.invalid"})
    assert "access-control-allow-origin" not in r.headers


async def test_rotas_de_sites_exigem_admin(cliente, site, token_usuario):
    cab = {"Authorization": f"Bearer {token_usuario}"}
    assert (await cliente.get("/sites", headers=cab)).status_code == 403
    assert (await cliente.post("/sites", headers=cab,
                               json={"nome": "x", "dominios": ["a.com"]})).status_code == 403
    assert (await cliente.get("/sites")).status_code == 401


async def test_cadastro_de_site_normaliza_dominio_e_gera_token(cliente, site, token_admin):
    cab = {"Authorization": f"Bearer {token_admin}"}
    r = await cliente.post("/sites", headers=cab, json={
        "nome": NOME_DO_SITE, "dominios": ["HTTPS://Www.Exemplo-Sonda.invalid/qualquer/coisa",
                                           "localhost:8099"],
        "mapa_campos": {"xyz": "empresa"}, "tags": [TAG]})
    assert r.status_code == 201, r.text
    novo = r.json()
    assert novo["dominios"] == ["www.exemplo-sonda.invalid", "localhost:8099"]
    assert novo["token"].startswith("pub_") and novo["ativo"] is True
    lista = (await cliente.get("/sites", headers=cab)).json()
    assert any(s["id"] == novo["id"] for s in lista)
    r = await cliente.patch(f"/sites/{novo['id']}", headers=cab, json={"ativo": False})
    assert r.status_code == 200 and r.json()["ativo"] is False
    r = await cliente.post("/sites", headers=cab, json={"nome": "x", "dominios": ["a b"]})
    assert r.status_code == 422
    r = await cliente.post("/sites", headers=cab, json={
        "nome": "x", "dominios": ["a.com"], "mapa_campos": {"x": "Chave Ruim"}})
    assert r.status_code == 422


async def test_token_rotacionado_invalida_o_antigo(cliente, site, token_admin):
    cab = {"Authorization": f"Bearer {token_admin}"}
    async with db.sessao(role="service_role") as conn:
        site_id = await conn.fetchval("SELECT id::text FROM sites WHERE token = $1", site)
    # Aquece o cache com o token antigo.
    assert (await _postar(cliente, "/publico/site/visita", {
        "token": site, "visitor_id": VISITANTE, "url": ORIGEM, "utm": {}})).status_code == 202
    r = await cliente.post(f"/sites/{site_id}/token", headers=cab)
    assert r.status_code == 200
    novo = r.json()["token"]
    assert novo != site and novo.startswith("pub_")
    assert (await _postar(cliente, "/publico/site/conversao", _conversao(site))).status_code == 403
    assert (await _postar(cliente, "/publico/site/conversao", _conversao(novo))).status_code == 202


async def test_recebido_desligado_da_404(cliente, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "PROVA_RECEPTOR_TESTE", False)
    assert (await cliente.post("/publico/prova/recebido")).status_code == 404
    monkeypatch.setattr(settings, "PROVA_RECEPTOR_TESTE", True)
    r = await cliente.post("/publico/prova/recebido", data={"pnome": "x"})
    assert r.status_code == 200 and "Recebido." in r.text
