"""Captura da prova do RD (Tarefa 3): campos extras, consentimento, origem,
tags, canal — e a ficha lendo o consentimento.

Os testes de canal e de URL são puros. Os de captura usam `cliente` (o que
passa por ele é GRAVADO) e apagam tudo no fim, por id; os que dependem da
migration 027 PULAM com o motivo enquanto ela não estiver aplicada.
"""

import json

import pytest
import pytest_asyncio

from app import database as db
from app.captura.canal import canal_do_toque
from app.captura.urls import config_com_urls_seguras, url_segura, urls_invalidas
from limpeza import apagar_leads

EMAIL = "sonda-prova-captura@exemplo.invalid"
SLUG = "sonda-prova-captura"
TAG_EXTRA = "sonda-prova-rd"
TELEFONE = "+5531988887777"
TEXTO_DA_CONFIG = "Aceito que a Health & Safety guarde meus dados (sonda)."


# ── Canal (puro) ─────────────────────────────────────────────────────────────

def _canal(**kw):
    base = dict(utm_source=None, utm_medium=None, referrer=None, gclid=None,
                fbclid=None, host_da_pagina="marketinghs.exemplo.com")
    base.update(kw)
    return canal_do_toque(**base)


def test_canal_do_toque_pago_por_gclid_e_por_cpc():
    assert _canal(gclid="abc") == "pago"
    assert _canal(utm_medium="CPC", utm_source="google") == "pago"
    assert _canal(utm_medium="paid") == "pago"
    # gclid vence o referrer de buscador.
    assert _canal(gclid="x", referrer="https://www.google.com/") == "pago"


def test_canal_social_por_fbclid():
    assert _canal(fbclid="x") == "social"
    assert _canal(utm_source="instagram") == "social"
    assert _canal(referrer="https://l.facebook.com/l.php?u=x") == "social"
    assert _canal(referrer="https://www.linkedin.com/feed/") == "social"


def test_canal_organico_por_google():
    assert _canal(referrer="https://www.google.com.br/") == "organico"
    assert _canal(referrer="https://www.bing.com/search?q=x") == "organico"


def test_canal_direto_sem_referrer_ou_mesmo_host():
    assert _canal() == "direto"
    assert _canal(referrer="https://marketinghs.exemplo.com/p/outra") == "direto"
    assert _canal(referrer="não é url") == "direto"


def test_canal_email():
    assert _canal(utm_medium="email", utm_source="resend") == "email"


def test_canal_referencia():
    assert _canal(referrer="https://blog.exemplo.org/post") == "referencia"


# ── URLs da config (puro) ────────────────────────────────────────────────────

def test_url_segura():
    assert url_segura("https://www.healthsafety.com.br/privacidade.cfm")
    assert url_segura("http://exemplo.com/x")
    assert url_segura("/publico/imagem/abc")
    for ruim in ("javascript:alert(1)", " JavaScript:alert(1)", "data:text/html,x",
                 "//evil.com/x", "/\\evil.com", "https://", "ftp://x.com", 12):
        assert url_segura(ruim) is None, ruim


def test_urls_invalidas_e_config_segura():
    config = {"redirect_url": "javascript:alert(1)", "imagem_url": "/publico/imagem/1",
              "consentimento": {"texto": "x", "link": "data:text/html,oi"},
              "headline": "fica"}
    assert sorted(urls_invalidas(config)) == ["consentimento.link", "redirect_url"]
    segura = config_com_urls_seguras(config)
    assert "redirect_url" not in segura and segura["imagem_url"] == "/publico/imagem/1"
    assert "link" not in segura["consentimento"] and segura["consentimento"]["texto"] == "x"
    assert segura["headline"] == "fica"
    # A original não muda (vem do cache da landing).
    assert config["redirect_url"] == "javascript:alert(1)"
    assert urls_invalidas({"redirect_url": "", "imagem_url": None}) == []


# ── Captura (banco) ──────────────────────────────────────────────────────────

CONFIG_DA_PROVA = {
    "redirect_url": "https://exemplo.invalid/obrigado",
    "campos": [
        {"chave": "nome", "rotulo": "Nome", "tipo": "texto", "obrigatorio": True},
        {"chave": "email", "rotulo": "E-mail", "tipo": "email", "obrigatorio": True},
        {"chave": "whatsapp", "rotulo": "Celular", "tipo": "telefone", "obrigatorio": True},
        {"chave": "empresa", "rotulo": "Empresa", "tipo": "texto", "obrigatorio": True},
        {"chave": "ja_faz_testagem", "rotulo": "Já faz testagem?", "tipo": "sim_nao",
         "obrigatorio": False},
    ],
    "consentimento": {"texto": TEXTO_DA_CONFIG,
                      "link": "https://www.healthsafety.com.br/privacidade.cfm",
                      "versao": "provisoria-2026-10", "provisoria": True},
    "tags": [TAG_EXTRA],
}

CAMPOS_OK = {"nome": "Ana Sonda", "whatsapp": "(31) 98888-7777",
             "empresa": "Transportes Sonda", "ja_faz_testagem": "sim"}


async def _tem_027() -> bool:
    async with db.sessao(role="service_role") as conn:
        return await conn.fetchval(
            "SELECT to_regclass('public.lead_consents') IS NOT NULL")


async def _limpar():
    async with db.sessao(role="service_role") as conn:
        leads = [r["id"] for r in await conn.fetch(
            "SELECT id FROM leads WHERE email = $1", EMAIL)]
        identidades = [r["dnia_id"] for r in await conn.fetch(
            """SELECT dnia_id FROM ecosystem_identities
                WHERE email = $1
                   OR (phone = $2 AND (email IS NULL OR email LIKE '%@exemplo.invalid'))""",
            EMAIL, TELEFONE)]
        await conn.execute(
            "DELETE FROM contact_events WHERE dnia_id = ANY($1::uuid[])", identidades)
        await conn.execute(
            "DELETE FROM lead_conversions WHERE lead_id = ANY($1::uuid[])", leads)
        await apagar_leads(conn, leads)
        await conn.execute(
            "DELETE FROM ecosystem_identities WHERE dnia_id = ANY($1::uuid[])", identidades)
        await conn.execute("DELETE FROM pages WHERE slug = $1", SLUG)
        await conn.execute("DELETE FROM tags WHERE name = ANY($1::text[])", [SLUG, TAG_EXTRA])


@pytest_asyncio.fixture
async def pagina(monkeypatch):
    """Uma página real da prova, apagada no fim (molde `pagina_sonda`).
    `await pagina(config)` troca a config."""
    from app.captura import email as vemail
    from app.routers import landing as vlanding

    async def sempre_tem_mx(_dominio):
        return True

    monkeypatch.setattr(vemail, "_tem_mx", sempre_tem_mx)
    vemail._limpar_cache()
    vlanding._limpar_cache()
    await db.init_db()
    if db._pool is None:
        pytest.skip("sem DATABASE_URL")
    await _limpar()
    async with db.sessao(role="service_role") as conn:
        await conn.execute(
            """INSERT INTO pages (name, slug, component_name, page_type, status, config)
               VALUES ('Sonda da prova', $1, 'SondaProva', 'landing', 'active', $2)""",
            SLUG, CONFIG_DA_PROVA)

    async def trocar(config):
        async with db.sessao(role="service_role") as conn:
            await conn.execute("UPDATE pages SET config = $2 WHERE slug = $1", SLUG, config)
        vlanding._limpar_cache()

    yield trocar
    await _limpar()
    vemail._limpar_cache()
    vlanding._limpar_cache()


async def _exigir_027():
    if not await _tem_027():
        pytest.skip("migration 027 ainda não aplicada neste banco")


def _corpo(**kw):
    corpo = {"email": EMAIL, "page_slug": SLUG, "consentimento": True,
             "fields": dict(CAMPOS_OK)}
    corpo.update(kw)
    return corpo


async def _lead():
    async with db.sessao(role="service_role") as conn:
        return await conn.fetchrow(
            "SELECT id::text, nome, whatsapp, empresa, campos_extras FROM leads "
            "WHERE email = $1", EMAIL)


def _json(valor):
    return valor if isinstance(valor, dict) or valor is None else json.loads(valor)


async def test_captura_recusa_sem_consentimento_e_nao_grava(cliente, pagina):
    await _exigir_027()
    for consentimento in (False, None):
        corpo = _corpo()
        if consentimento is None:
            corpo.pop("consentimento")
        else:
            corpo["consentimento"] = consentimento
        r = await cliente.post("/publico/captura", json=corpo)
        assert r.status_code == 400, r.text
        detalhe = r.json()["detail"]
        assert detalhe["mensagem"] == "Para enviar, aceite a política de privacidade."
        assert "consentimento" in detalhe["campos"]
    assert await _lead() is None


async def test_consentimento_obrigatorio_vale_pela_presenca_do_bloco(cliente, pagina):
    """Texto vazio no bloco = texto padrão, não "sem consentimento" (igual ao
    front: `consentimentoDaConfig`)."""
    await _exigir_027()
    await pagina({**CONFIG_DA_PROVA, "consentimento": {"texto": "", "versao": "v1"}})
    r = await cliente.post("/publico/captura", json=_corpo(consentimento=False))
    assert r.status_code == 400
    r = await cliente.post("/publico/captura", json=_corpo())
    assert r.status_code == 200, r.text
    async with db.sessao(role="service_role") as conn:
        texto = await conn.fetchval(
            "SELECT c.texto FROM lead_consents c JOIN leads l ON l.id = c.lead_id "
            "WHERE l.email = $1", EMAIL)
    assert texto == "Li e aceito a política de privacidade."


async def test_consentimento_opcional_nao_recusa_e_nao_grava_sem_aceite(cliente, pagina):
    await _exigir_027()
    await pagina({**CONFIG_DA_PROVA,
                  "consentimento": {**CONFIG_DA_PROVA["consentimento"], "obrigatorio": False}})
    r = await cliente.post("/publico/captura", json=_corpo(consentimento=False))
    assert r.status_code == 200, r.text
    async with db.sessao(role="service_role") as conn:
        assert await conn.fetchval(
            "SELECT count(*) FROM lead_consents c JOIN leads l ON l.id = c.lead_id "
            "WHERE l.email = $1", EMAIL) == 0


async def test_captura_grava_consentimento_com_texto_da_config_ip_e_ua(cliente, pagina):
    await _exigir_027()
    corpo = _corpo()
    corpo["fields"]["consentimento_texto"] = "texto falso mandado pelo navegador"
    r = await cliente.post("/publico/captura", json=corpo, headers={
        "X-Forwarded-For": "203.0.113.7, 10.0.0.1", "User-Agent": "Sonda/1.0"})
    assert r.status_code == 200, r.text
    async with db.sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            """SELECT c.* FROM lead_consents c JOIN leads l ON l.id = c.lead_id
                WHERE l.email = $1""", EMAIL)
        conversao = await conn.fetchval(
            "SELECT lc.id FROM lead_conversions lc JOIN leads l ON l.id = lc.lead_id "
            "WHERE l.email = $1", EMAIL)
    assert linha["texto"] == TEXTO_DA_CONFIG
    assert linha["versao"] == "provisoria-2026-10" and linha["provisoria"] is True
    assert linha["base_legal"] == "consentimento"
    assert linha["ip"] == "203.0.113.7" and linha["user_agent"] == "Sonda/1.0"
    assert linha["origem_tipo"] == "pagina" and linha["page_slug"] == SLUG
    assert linha["conversao_id"] == conversao


async def test_captura_campo_obrigatorio_ausente_da_400_com_campos(cliente, pagina):
    await _exigir_027()
    corpo = _corpo()
    del corpo["fields"]["empresa"]
    corpo["fields"]["whatsapp"] = "999"
    corpo["consentimento"] = False
    r = await cliente.post("/publico/captura", json=corpo)
    assert r.status_code == 400
    detalhe = r.json()["detail"]
    assert isinstance(detalhe["mensagem"], str)
    assert detalhe["campos"]["empresa"] == "Preencha este campo."
    assert detalhe["campos"]["whatsapp"] == "Informe o celular com DDD."
    assert "consentimento" in detalhe["campos"]
    assert await _lead() is None


async def test_captura_celular_normalizado_e_extra_em_campos_extras(cliente, pagina):
    await _exigir_027()
    r = await cliente.post("/publico/captura", json=_corpo())
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "redirect_url": "https://exemplo.invalid/obrigado"}
    lead = await _lead()
    assert lead["whatsapp"] == TELEFONE
    assert _json(lead["campos_extras"]) == {"ja_faz_testagem": "sim"}


async def test_extra_fora_da_definicao_nao_entra(cliente, pagina):
    await _exigir_027()
    corpo = _corpo()
    corpo["fields"]["chave_inventada"] = "x"
    r = await cliente.post("/publico/captura", json=corpo)
    assert r.status_code == 200
    assert _json((await _lead())["campos_extras"]) == {"ja_faz_testagem": "sim"}


async def test_reconversao_nao_sobrescreve_extra_existente(cliente, pagina):
    await _exigir_027()
    assert (await cliente.post("/publico/captura", json=_corpo())).status_code == 200
    corpo = _corpo()
    corpo["fields"].update({"ja_faz_testagem": "nao", "nome": "Impostor"})
    await pagina({**CONFIG_DA_PROVA, "campos": CONFIG_DA_PROVA["campos"] + [
        {"chave": "porte", "rotulo": "Porte", "tipo": "lista", "opcoes": ["P", "G"]}]})
    corpo["fields"]["porte"] = "G"
    assert (await cliente.post("/publico/captura", json=corpo)).status_code == 200
    lead = await _lead()
    assert lead["nome"] == "Ana Sonda"
    assert _json(lead["campos_extras"]) == {"ja_faz_testagem": "sim", "porte": "G"}
    async with db.sessao(role="service_role") as conn:
        assert await conn.fetchval(
            "SELECT count(*) FROM lead_conversions WHERE lead_id = $1::uuid",
            lead["id"]) == 2
        assert await conn.fetchval(
            "SELECT count(*) FROM lead_consents WHERE lead_id = $1::uuid",
            lead["id"]) == 2


async def test_captura_aplica_tags_da_config(cliente, pagina):
    await _exigir_027()
    assert (await cliente.post("/publico/captura", json=_corpo())).status_code == 200
    async with db.sessao(role="service_role") as conn:
        tags = {r["name"] for r in await conn.fetch(
            """SELECT t.name FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id
                 JOIN leads l ON l.id = lt.lead_id WHERE l.email = $1""", EMAIL)}
    assert tags == {SLUG, TAG_EXTRA}


async def test_captura_grava_visitor_id_e_canal_na_conversao(cliente, pagina):
    await _exigir_027()
    r = await cliente.post("/publico/captura", json=_corpo(
        visitor_id="vid-sonda-1", gclid="gclid-sonda",
        referrer="https://www.google.com/"))
    assert r.status_code == 200, r.text
    async with db.sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            """SELECT lc.visitor_id, lc.canal, lc.page_slug, lc.form_id
                 FROM lead_conversions lc JOIN leads l ON l.id = lc.lead_id
                WHERE l.email = $1""", EMAIL)
    assert dict(linha) == {"visitor_id": "vid-sonda-1", "canal": "pago",
                           "page_slug": SLUG, "form_id": None}


async def test_visitor_id_invalido_vira_none(cliente, pagina):
    await _exigir_027()
    r = await cliente.post("/publico/captura", json=_corpo(visitor_id="x" * 65))
    assert r.status_code == 200
    async with db.sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            """SELECT lc.visitor_id, lc.canal FROM lead_conversions lc
                 JOIN leads l ON l.id = lc.lead_id WHERE l.email = $1""", EMAIL)
    assert linha["visitor_id"] is None and linha["canal"] == "direto"


async def test_captura_sem_bloco_novo_continua_como_antes(cliente, pagina):
    """Review Focus 5: página antiga, só `visible_fields`."""
    await pagina({"redirect_url": "https://exemplo.invalid/obrigado",
                  "visible_fields": ["nome", "email", "whatsapp"]})
    r = await cliente.post("/publico/captura", json={
        "email": EMAIL, "page_slug": SLUG,
        "fields": {"nome": "Ana Sonda", "whatsapp": "31988887777", "cargo": "x" * 3000}})
    assert r.status_code == 200, r.text
    lead = await _lead()
    assert lead["nome"] == "Ana Sonda" and lead["whatsapp"] == "31988887777"
    if await _tem_027():
        assert _json(lead["campos_extras"]) == {}
        async with db.sessao(role="service_role") as conn:
            assert await conn.fetchval(
                "SELECT count(*) FROM lead_consents WHERE lead_id = $1::uuid",
                lead["id"]) == 0


async def test_captura_nao_devolve_redirect_inseguro(cliente, pagina):
    await pagina({"redirect_url": "javascript:alert(1)", "visible_fields": ["nome"]})
    r = await cliente.post("/publico/captura", json={
        "email": EMAIL, "page_slug": SLUG, "fields": {"nome": "Ana"}})
    assert r.status_code == 200
    assert r.json() == {"ok": True, "redirect_url": None}


async def test_ficha_lista_consentimentos_e_nao_admin_leva_403(cliente, pagina, token_admin,
                                                               token_usuario):
    await _exigir_027()
    assert (await cliente.post("/publico/captura", json=_corpo())).status_code == 200
    lead = await _lead()
    r = await cliente.get(f"/contatos/{lead['id']}/consentimentos",
                          headers={"Authorization": f"Bearer {token_usuario}"})
    assert r.status_code == 403
    r = await cliente.get(f"/contatos/{lead['id']}/consentimentos",
                          headers={"Authorization": f"Bearer {token_admin}"})
    assert r.status_code == 200, r.text
    lista = r.json()
    assert len(lista) == 1
    assert set(lista[0]) == {"id", "base_legal", "texto", "versao", "provisoria", "ip",
                             "user_agent", "origem_tipo", "page_slug", "site_id",
                             "form_id", "page_url", "criado_em"}
    assert lista[0]["texto"] == TEXTO_DA_CONFIG
    ficha = await cliente.get(f"/contatos/{lead['id']}",
                              headers={"Authorization": f"Bearer {token_admin}"})
    assert ficha.json()["lead"]["campos_extras"] == {"ja_faz_testagem": "sim"}


async def test_consentimentos_com_uuid_invalido_nao_e_500(cliente, token_admin):
    r = await cliente.get("/contatos/nao-e-uuid/consentimentos",
                          headers={"Authorization": f"Bearer {token_admin}"})
    assert r.status_code == 422, r.text


# ── Config salva com URL insegura ────────────────────────────────────────────

async def test_salvar_config_com_url_insegura_da_400(cliente, pagina, token_admin):
    r = await cliente.patch(
        f"/paginas/por-slug/{SLUG}/config",
        headers={"Authorization": f"Bearer {token_admin}"},
        json={"consentimento": {"texto": "x", "link": "javascript:alert(1)"}})
    assert r.status_code == 400
    assert "consentimento.link" in r.text
    r = await cliente.patch(
        f"/paginas/por-slug/{SLUG}/config",
        headers={"Authorization": f"Bearer {token_admin}"},
        json={"imagem_url": "/publico/imagem/abc", "redirect_url": "https://x.com/ok"})
    assert r.status_code == 200, r.text
