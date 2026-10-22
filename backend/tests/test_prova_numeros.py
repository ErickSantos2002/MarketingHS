"""Números por página e por formulário de site; a casca que mede (prova do
RD, Tarefa 5).

Os dados são semeados COMITADOS (a rota lê pela própria conexão) e apagados
por id no fim.
"""

import re
from datetime import date, timedelta

import pytest
import pytest_asyncio

from app import database as db
from limpeza import apagar_leads, apagar_visitas

SLUG = "sonda-prova-numeros"
EMAILS = ("sonda-numeros-1@exemplo.invalid", "sonda-numeros-2@exemplo.invalid")
VISITANTES = ("vid-numeros-a", "vid-numeros-b", "vid-numeros-c")
NOME_DO_SITE = "Sonda prova números"


async def _limpar():
    async with db.sessao(role="service_role") as conn:
        leads = [r["id"] for r in await conn.fetch(
            "SELECT id FROM leads WHERE email = ANY($1::text[])", list(EMAILS))]
        await conn.execute(
            "DELETE FROM lead_conversions WHERE lead_id = ANY($1::uuid[])", leads)
        await apagar_leads(conn, leads)
        await apagar_visitas(conn, VISITANTES)
        await conn.execute("DELETE FROM sites WHERE nome = $1", NOME_DO_SITE)
        await conn.execute("DELETE FROM pages WHERE slug = $1", SLUG)


@pytest_asyncio.fixture
async def semeado():
    """Página com 3 visitas de 2 visitantes (2 pagas, 1 direta) e 1 conversão
    paga; site com 2 visitas de 1 visitante no `/cotacao` e 1 conversão; um
    lead EXCLUÍDO com conversão na página (não conta)."""
    from app.routers import landing
    await db.init_db()
    if db._pool is None:
        pytest.skip("sem DATABASE_URL")
    async with db.sessao(role="service_role") as conn:
        if not await conn.fetchval("SELECT to_regclass('public.visitas') IS NOT NULL"):
            pytest.skip("migration 027 ainda não aplicada neste banco")
    landing._limpar_cache()
    await _limpar()
    a, b, c = VISITANTES
    async with db.sessao(role="service_role") as conn:
        await conn.execute(
            """INSERT INTO pages (name, slug, component_name, page_type, status, config)
               VALUES ('Sonda números', $1, 'SondaNumeros', 'landing', 'active', '{}')""",
            SLUG)
        site_id = await conn.fetchval(
            """INSERT INTO sites (nome, dominios, token) VALUES ($1, '{x.invalid}',
               'pub_sonda_num_' || gen_random_uuid()) RETURNING id""", NOME_DO_SITE)
        for vid, canal in ((a, "pago"), (a, "pago"), (b, "direto")):
            await conn.execute(
                "INSERT INTO visitas (visitor_id, page_slug, canal) VALUES ($1, $2, $3)",
                vid, SLUG, canal)
        for _ in range(2):
            await conn.execute(
                "INSERT INTO visitas (visitor_id, site_id, path, canal) "
                "VALUES ($1, $2, '/cotacao', 'organico')", c, site_id)
        vivo = await conn.fetchval(
            "INSERT INTO leads (email, tipo) VALUES ($1, 'teste') RETURNING id", EMAILS[0])
        excluido = await conn.fetchval(
            "INSERT INTO leads (email, tipo, deleted_at) VALUES ($1, 'teste', now()) "
            "RETURNING id", EMAILS[1])
        await conn.execute(
            "INSERT INTO lead_conversions (lead_id, tipo, page_slug, visitor_id, canal) "
            "VALUES ($1, 'lead', $2, $3, 'pago')", vivo, SLUG, a)
        await conn.execute(
            "INSERT INTO lead_conversions (lead_id, tipo, page_slug, canal) "
            "VALUES ($1, 'lead', $2, 'direto')", excluido, SLUG)
        await conn.execute(
            "INSERT INTO lead_conversions (lead_id, tipo, site_id, form_id, page_path, "
            "visitor_id) VALUES ($1, 'lead', $2, 'prova_cap_phoebus', '/cotacao', $3)",
            vivo, site_id, c)
    yield str(site_id)
    await _limpar()
    landing._limpar_cache()


async def _numeros(cliente, token, **params):
    r = await cliente.get("/paginas/numeros", params=params,
                          headers={"Authorization": f"Bearer {token}"})
    return r


def _pagina(corpo):
    return next(p for p in corpo["paginas"] if p["slug"] == SLUG)


async def test_numeros_contam_visitas_visitantes_conversoes_e_taxa(cliente, semeado, token_admin):
    r = await _numeros(cliente, token_admin)
    assert r.status_code == 200, r.text
    corpo = r.json()
    hoje = date.fromisoformat(corpo["ate"])
    assert date.fromisoformat(corpo["de"]) == hoje - timedelta(days=29)
    p = _pagina(corpo)
    assert p["nome"] == "Sonda números"
    assert (p["visitas"], p["visitantes"], p["conversoes"]) == (3, 2, 1)
    assert p["taxa"] == 0.5


async def test_numeros_por_canal(cliente, semeado, token_admin):
    p = _pagina((await _numeros(cliente, token_admin)).json())
    canais = {c["canal"]: c for c in p["por_canal"]}
    assert set(canais) == {"pago", "direto"}
    assert (canais["pago"]["visitas"], canais["pago"]["visitantes"],
            canais["pago"]["conversoes"], canais["pago"]["taxa"]) == (2, 1, 1, 1.0)
    assert (canais["direto"]["visitas"], canais["direto"]["visitantes"],
            canais["direto"]["conversoes"], canais["direto"]["taxa"]) == (1, 1, 0, 0.0)


async def test_numeros_taxa_nula_sem_visitante(cliente, semeado, token_admin):
    async with db.sessao(role="service_role") as conn:
        await apagar_visitas(conn, VISITANTES[:2])
    p = _pagina((await _numeros(cliente, token_admin)).json())
    assert (p["visitas"], p["visitantes"], p["conversoes"]) == (0, 0, 1)
    assert p["taxa"] is None
    assert {c["canal"]: c["taxa"] for c in p["por_canal"]} == {"pago": None}


async def test_numeros_ignoram_lead_excluido(cliente, semeado, token_admin):
    p = _pagina((await _numeros(cliente, token_admin)).json())
    assert p["conversoes"] == 1
    assert "desconhecido" not in {c["canal"] for c in p["por_canal"]}


async def test_numeros_de_formulario_de_site(cliente, semeado, token_admin):
    corpo = (await _numeros(cliente, token_admin)).json()
    f = next(x for x in corpo["formularios"] if x["site_id"] == semeado)
    assert f["site_nome"] == NOME_DO_SITE and f["form_id"] == "prova_cap_phoebus"
    assert f["page_path"] == "/cotacao"
    assert (f["visitantes"], f["conversoes"], f["taxa"]) == (1, 1, 1.0)
    canais = {c["canal"]: c for c in f["por_canal"]}
    # A conversão sem canal vira "desconhecido"; a visita foi orgânica.
    assert canais["desconhecido"]["conversoes"] == 1
    assert canais["organico"]["visitantes"] == 1 and canais["organico"]["conversoes"] == 0


async def test_numeros_periodo_fora_nao_conta(cliente, semeado, token_admin):
    corpo = (await _numeros(cliente, token_admin, de="2020-01-01", ate="2020-01-31")).json()
    assert corpo["de"] == "2020-01-01" and corpo["ate"] == "2020-01-31"
    p = _pagina(corpo)
    assert (p["visitas"], p["conversoes"], p["taxa"]) == (0, 0, None)
    assert not any(x["site_id"] == semeado for x in corpo["formularios"])


async def test_numeros_periodo_invertido_400(cliente, semeado, token_admin):
    r = await _numeros(cliente, token_admin, de="2026-10-21", ate="2026-10-01")
    assert r.status_code == 400
    r = await _numeros(cliente, token_admin, de="ontem")
    assert r.status_code == 422


async def test_numeros_nao_admin_403(cliente, token_usuario):
    assert (await _numeros(cliente, token_usuario)).status_code == 403


# ── A casca ──────────────────────────────────────────────────────────────────

async def _casca(cliente, config):
    from app.routers import landing
    async with db.sessao(role="service_role") as conn:
        await conn.execute("UPDATE pages SET config = $2 WHERE slug = $1", SLUG, config)
    landing._limpar_cache()
    r = await cliente.get(f"/p/{SLUG}")
    assert r.status_code == 200
    return r.text


async def test_casca_noindex_quando_config_manda(cliente, semeado):
    corpo = await _casca(cliente, {"noindex": True})
    assert '<meta name="robots" content="noindex,nofollow">' in corpo


async def test_casca_sem_noindex_por_padrao(cliente, semeado):
    corpo = await _casca(cliente, {})
    assert 'name="robots"' not in corpo


async def test_casca_carrega_rastreio_com_a_pagina(cliente, semeado):
    corpo = await _casca(cliente, {})
    assert (f'<script src="/rastreio.js" defer data-pagina="{SLUG}" data-api="/api" '
            'data-captura="off"></script>') in corpo


async def test_casca_da_previa_nao_carrega_rastreio(cliente, semeado):
    # A2: a prévia do editor (`?previa=1`) não conta visita.
    from app.routers import landing
    await _casca(cliente, {})
    landing._limpar_cache()
    r = await cliente.get(f"/p/{SLUG}?previa=1")
    assert r.status_code == 200
    assert "rastreio.js" not in r.text
    assert 'id="config-da-pagina"' in r.text


def test_montar_casca_previa_sem_rastreio():
    from app.routers.landing import montar_casca
    assert "rastreio.js" in montar_casca("x", {})
    assert "rastreio.js" not in montar_casca("x", {}, previa=True)


def test_casca_escapa_o_slug_do_rastreio():
    from app.routers.landing import montar_casca
    corpo = montar_casca('a"><script>x</script>', {})
    assert 'data-pagina="a&quot;&gt;&lt;script&gt;x&lt;/script&gt;"' in corpo


async def test_casca_descarta_url_insegura_da_config(cliente, semeado):
    corpo = await _casca(cliente, {"imagem_url": "javascript:alert(1)",
                                   "consentimento": {"texto": "t", "link": "data:x"},
                                   "redirect_url": "/p/obrigado"})
    bloco = re.search(r'id="config-da-pagina">(.*?)</script>', corpo, re.S).group(1)
    assert "javascript:" not in bloco and "data:x" not in bloco
    assert "/p/obrigado" in bloco
