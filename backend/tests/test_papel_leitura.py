"""Papel `leitura` (frente papel-leitura, 27/10/2026).

O Sergio, de uma agência externa, precisa "dar uma olhada em tudo" sem poder
alterar nada. O papel `leitura`:

  - recebe 403 em QUALQUER método que não seja GET/HEAD/OPTIONS, em toda rota
    autenticada — a trava mora em `usuario_atual`, então rota nova nasce
    protegida (o teste de varredura abaixo prova rota por rota);
  - lê as telas do admin pelas rotas com `admin_ou_leitura` — e SÓ por elas
    (o inventário abaixo trava a lista);
  - não lê configuração, integração, segredo, usuário, chave de API;
  - no banco, toda sessão `authenticated` dele é READ ONLY (`database.sessao`)
    e só aí o `has_role(..., 'admin')` responde sim para ele (migration 034):
    o RLS herdado é todo admin-only, e sem isso cada lista devolveria ZERO
    linhas, sem erro — o painel zerado que parece mês fraco.
"""

import uuid

import pytest

from app import database as db
from app.main import app


def todas_as_rotas(aplicacao):
    """As rotas de verdade. ⚠️ O FastAPI 0.141 guarda o router incluído como
    `_IncludedRouter`, preguiçoso: `app.routes` NÃO lista as rotas dele —
    é preciso pedir `effective_candidates()`."""
    for r in aplicacao.routes:
        if hasattr(r, "effective_candidates"):
            yield from r.effective_candidates()
        elif hasattr(r, "dependant"):
            yield r


def dependencias(rota) -> set[str]:
    nomes: set[str] = set()

    def andar(d):
        for sub in d.dependencies:
            nomes.add(getattr(sub.call, "__name__", str(sub.call)))
            andar(sub)

    andar(rota.dependant)
    return nomes


METODOS_DE_LEITURA = {"GET", "HEAD", "OPTIONS"}

# Rotas que não passam por usuário logado: cada uma se autentica do seu jeito
# (chave de API, HMAC, assinatura Svix, nada — captura pública).
PREFIXOS_PUBLICOS = ("/publico/", "/teste/growthhs/api/", "/p/")
ROTAS_SEM_USUARIO = {("POST", "/auth/login"), ("POST", "/auth/bootstrap-admin")}

# A ÚNICA escrita (de método) liberada para leitura: é leitura pura, POST só
# porque a lista de ids não cabe numa URL. Ver docs/frentes/papel-leitura.md.
EXCECOES_DA_TRAVA = {("POST", "/contatos/enriquecimento"), ("POST", "/contatos/tags-por-contato")}

# O inventário do que `leitura` lê. Rota nova com `admin_ou_leitura` que não
# esteja aqui derruba o teste — abrir dado para fora é decisão, não acidente.
ROTAS_DE_LEITURA = {
    ("GET", "/ab/config"), ("GET", "/ab/testes"), ("GET", "/ab/testes/{teste_id}"),
    ("GET", "/ab/testes/{teste_id}/eventos"),
    ("GET", "/automacoes"),
    ("GET", "/campanhas"), ("GET", "/campanhas/{campanha_id}"),
    ("GET", "/campanhas/{campanha_id}/audiencia"),
    ("GET", "/campanhas/{campanha_id}/envios"),
    ("GET", "/jornadas"), ("GET", "/jornadas/{jornada_id}"),
    ("GET", "/jornadas/{jornada_id}/execucoes"),
    ("GET", "/contatos"), ("GET", "/contatos/busca"),
    ("GET", "/contatos/conversoes-utm"), ("GET", "/contatos/duplicatas"),
    ("GET", "/contatos/{lead_id}"), ("GET", "/contatos/{lead_id}/consentimentos"),
    ("GET", "/contatos/{lead_id}/conversoes"),
    ("GET", "/contatos/{lead_id}/conversoes-lista"),
    ("GET", "/contatos/{lead_id}/eventos"),
    ("POST", "/contatos/enriquecimento"), ("POST", "/contatos/tags-por-contato"),
    ("GET", "/paginas"), ("GET", "/paginas/estatisticas"), ("GET", "/paginas/numeros"),
    ("GET", "/painel/agendamentos"), ("GET", "/painel/agendamentos/mql-hoje"),
    ("GET", "/painel/config/{chave}"),
    ("GET", "/segmentos"), ("GET", "/segmentos/{segmento_id}/contatos"),
    ("GET", "/templates"), ("GET", "/templates/{template_id}"),
}

# GETs que continuam só de admin — configuração, integração, segredo, gente.
GETS_SO_ADMIN = [
    "/chaves", "/config/growthhs", "/config/ia", "/config/meta", "/config/resend",
    "/config/resend/diagnostico", "/config/envio/ritmo", "/supressoes", "/sites",
    "/usuarios", "/arquivos", "/ia/conversas", "/ia/insights-de-desafios",
]


def _publica(metodo: str, caminho: str) -> bool:
    return caminho.startswith(PREFIXOS_PUBLICOS) or (metodo, caminho) in ROTAS_SEM_USUARIO


def _preencher(caminho: str) -> str:
    """Parâmetro de caminho vira um uuid que não existe: a trava tem que
    responder 403 ANTES de alguém procurar o registro."""
    import re
    return re.sub(r"\{[^}]+\}", str(uuid.uuid4()), caminho)


@pytest.fixture
async def token_leitura():
    from conftest import _apagar_usuario_de_teste, _criar_usuario_de_teste
    await db.init_db()
    if db._pool is None:
        pytest.skip("sem DATABASE_URL")
    uid, token = await _criar_usuario_de_teste("usuario-teste-8c", "leitura")
    try:
        yield uid, token
    finally:
        await _apagar_usuario_de_teste(uid)


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ── Inventário (sem banco) ───────────────────────────────────────────────────

def test_inventario_das_rotas_de_leitura():
    abertas = {(m, r.path) for r in todas_as_rotas(app) for m in r.methods
               if "admin_ou_leitura" in dependencias(r)}
    assert abertas == ROTAS_DE_LEITURA


def test_rota_de_leitura_so_abre_sessao_authenticated():
    """A READ ONLY do banco só cobre `sessao(role="authenticated", ...)`.
    Rota aberta ao leitor que use `service_role` (BYPASSRLS) ou `anon` perde
    essa segunda linha — e, com `anon`, leria zero em silêncio."""
    import inspect
    import re
    fora = []
    for r in todas_as_rotas(app):
        if "admin_ou_leitura" not in dependencias(r):
            continue
        papeis = set(re.findall(r'role="(\w+)"', inspect.getsource(r.endpoint)))
        if papeis != {"authenticated"}:
            fora.append((r.path, papeis))
    assert fora == []


def test_toda_escrita_nao_publica_passa_por_um_usuario():
    """A trava mora em `usuario_atual` (e em `admin_ou_maquina`, que exige
    admin). Rota de escrita que não dependa de nenhum dos dois escaparia."""
    soltas = []
    for r in todas_as_rotas(app):
        for m in r.methods - METODOS_DE_LEITURA:
            if _publica(m, r.path):
                continue
            d = dependencias(r)
            if "usuario_atual" not in d and "dependencia" not in d:
                soltas.append((m, r.path))
    assert soltas == []


# ── A trava ──────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_leitura_leva_403_em_toda_escrita(cliente, token_leitura):
    _, token = token_leitura
    furos = []
    for r in todas_as_rotas(app):
        for m in sorted(r.methods - METODOS_DE_LEITURA):
            if _publica(m, r.path) or (m, r.path) in EXCECOES_DA_TRAVA:
                continue
            resp = await cliente.request(m, _preencher(r.path), headers=_h(token), json={})
            # O 403 tem que ser DA TRAVA, não o do `admin_atual` — senão o
            # teste não provaria nada nas rotas de admin. `admin_ou_maquina`
            # (Resend) chama `usuario_atual` sem a requisição: trava também.
            detalhe = str(resp.json().get("detail", "")).lower() if resp.content else ""
            if resp.status_code != 403 or "somente leitura" not in detalhe:
                furos.append((m, r.path, resp.status_code, detalhe[:60]))
    assert furos == []


@pytest.mark.asyncio
@pytest.mark.parametrize("visao", ["apagados", "todos"])
async def test_leitura_nao_ve_contato_excluido(cliente, token_leitura, visao):
    _, token = token_leitura
    resp = await cliente.get(f"/contatos?visao={visao}", headers=_h(token))
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_a_mensagem_da_trava_diz_o_motivo(cliente, token_leitura):
    _, token = token_leitura
    resp = await cliente.post("/tags", headers=_h(token), json={"name": "x"})
    assert resp.status_code == 403
    assert "somente leitura" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_excecao_da_trava_responde(cliente, token_leitura):
    _, token = token_leitura
    resp = await cliente.post("/contatos/enriquecimento", headers=_h(token),
                              json={"dnia_ids": [str(uuid.uuid4())]})
    assert resp.status_code == 200, resp.text


@pytest.mark.asyncio
@pytest.mark.parametrize("caminho", GETS_SO_ADMIN)
async def test_leitura_nao_le_configuracao(cliente, token_leitura, caminho):
    _, token = token_leitura
    resp = await cliente.get(caminho, headers=_h(token))
    assert resp.status_code == 403, (caminho, resp.status_code)


@pytest.mark.asyncio
async def test_usuario_comum_continua_fora(cliente, token_usuario):
    resp = await cliente.get("/contatos", headers=_h(token_usuario))
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_auth_eu_devolve_o_papel(cliente, token_leitura):
    _, token = token_leitura
    resp = await cliente.get("/auth/eu", headers=_h(token))
    assert resp.status_code == 200
    assert resp.json()["papel"] == "leitura"


# ── O banco ──────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_sessao_do_leitor_e_read_only_e_ve_como_admin(token_leitura):
    uid, _ = token_leitura
    async with db.sessao(role="authenticated", user_id=uid) as conn:
        assert await conn.fetchval("SHOW transaction_read_only") == "on"
        assert await conn.fetchval(
            "SELECT public.has_role($1::uuid, 'admin')", uid) is True
    # Fora da transação read-only, o leitor NÃO é admin para o banco.
    async with db.sessao(role="service_role") as conn:
        assert await conn.fetchval(
            "SELECT public.has_role($1::uuid, 'admin')", uid) is False


@pytest.mark.asyncio
async def test_leitor_nao_grava_nem_pelo_banco(token_leitura):
    import asyncpg
    uid, _ = token_leitura
    with pytest.raises(asyncpg.ReadOnlySQLTransactionError):
        async with db.sessao(role="authenticated", user_id=uid) as conn:
            await conn.execute("INSERT INTO tags (name) VALUES ('teste-leitura-nunca')")


@pytest.mark.asyncio
async def test_sessao_do_admin_continua_de_escrita(token_admin):
    from app.auth.security import ler_token
    uid = ler_token(token_admin)["sub"]
    async with db.sessao(role="authenticated", user_id=uid) as conn:
        assert await conn.fetchval("SHOW transaction_read_only") == "off"


# ── Zero linhas silenciosas: leitura vê o MESMO que o admin ─────────────────

MARCA = "teste-leitura-28"


@pytest.fixture
async def base_semeada():
    """Um de cada: contato com etiqueta, evento e nota; segmento estático e
    dinâmico; campanha com envio; template; jornada com execução; regra de
    automação; página; teste A/B. COMITA — apaga tudo no fim."""
    await db.init_db()
    if db._pool is None:
        pytest.skip("sem DATABASE_URL")
    s = {}
    async with db.sessao(role="service_role") as conn:
        s["lead"] = await conn.fetchval(
            "INSERT INTO leads (nome, email, tipo, dnia_id) "
            "VALUES ('Leitura', $1, 'teste', gen_random_uuid()) RETURNING id::text",
            f"{MARCA}-{uuid.uuid4().hex[:8]}@exemplo.invalid")
        s["tag"] = await conn.fetchval(
            "INSERT INTO tags (name) VALUES ($1) RETURNING id::text",
            f"{MARCA}-{uuid.uuid4().hex[:6]}")
        await conn.execute("INSERT INTO lead_tags (lead_id, tag_id) VALUES ($1::uuid, $2::uuid)",
                           s["lead"], s["tag"])
        await conn.execute(
            "INSERT INTO lead_notes (lead_id, content) VALUES ($1::uuid, 'nota')", s["lead"])
        s["seg"] = await conn.fetchval(
            "INSERT INTO segments (name, type, rules) VALUES ($1, 'static', '[]'::jsonb) "
            "RETURNING id::text", f"{MARCA}-estatico")
        await conn.execute(
            "INSERT INTO segment_contacts (segment_id, lead_id) VALUES ($1::uuid, $2::uuid)",
            s["seg"], s["lead"])
        s["seg_din"] = await conn.fetchval(
            "INSERT INTO segments (name, type, rules, logic) "
            "VALUES ($1, 'dynamic', $2::jsonb, 'and') RETURNING id::text",
            f"{MARCA}-dinamico", [{"field": "tag", "operator": "is", "value": s["tag"]}])
        s["tpl"] = await conn.fetchval(
            "INSERT INTO email_templates (name, html) VALUES ($1, '<p>oi</p>') "
            "RETURNING id::text", MARCA)
        s["camp"] = await conn.fetchval(
            "INSERT INTO campaigns (name, channel, status) VALUES ($1, 'email', 'draft') "
            "RETURNING id::text", MARCA)
        await conn.execute(
            "INSERT INTO campaign_sends (campaign_id, lead_id, channel, status) "
            "VALUES ($1::uuid, $2::uuid, 'email', 'sent')", s["camp"], s["lead"])
        s["jorn"] = await conn.fetchval(
            """INSERT INTO journeys (name, status, entry_type, entry_config,
                                     entry_node_id, nodes)
               VALUES ($1, 'draft', 'event', '{"event_type": "teste-leitura-nunca"}',
                       'a', '[{"id": "a", "next": null, "type": "delay",
                               "config": {"minutes": 1}}]')
               RETURNING id::text""", MARCA)
        await conn.execute(
            "INSERT INTO journey_runs (journey_id, lead_id) VALUES ($1::uuid, $2::uuid)",
            s["jorn"], s["lead"])
        s["regra"] = await conn.fetchval(
            """INSERT INTO automation_rules (name, condition_type, condition_operator,
                                             condition_value, action_type, is_active)
               VALUES ($1, 'etiqueta', 'is', 'x', 'create_in_growthhs', false)
               RETURNING id::text""", MARCA)
        s["pag"] = await conn.fetchval(
            """INSERT INTO pages (name, slug, component_name, page_type, status)
               VALUES ($1, $2, 'Leitura', 'landing', 'draft') RETURNING id::text""",
            MARCA, f"{MARCA}-{uuid.uuid4().hex[:6]}")
        s["ab"] = await conn.fetchval(
            """INSERT INTO ab_tests (slug, public_slug, name, status, variants, control_variant)
               VALUES ($1, $1, $2, 'draft',
                       '[{"key": "A", "url": "https://exemplo.invalid/a", "weight": 50},
                         {"key": "B", "url": "https://exemplo.invalid/b", "weight": 50}]',
                       'A') RETURNING id::text""",
            f"{MARCA}-{uuid.uuid4().hex[:6]}", MARCA)
    try:
        yield s
    finally:
        from limpeza import apagar_leads
        async with db.sessao(role="service_role") as conn:
            await conn.execute("DELETE FROM ab_tests WHERE id = $1::uuid", s["ab"])
            await conn.execute("DELETE FROM pages WHERE id = $1::uuid", s["pag"])
            await conn.execute("DELETE FROM automation_rules WHERE id = $1::uuid", s["regra"])
            await conn.execute("DELETE FROM journey_runs WHERE journey_id = $1::uuid", s["jorn"])
            await conn.execute("DELETE FROM journeys WHERE id = $1::uuid", s["jorn"])
            await conn.execute("DELETE FROM campaign_sends WHERE campaign_id = $1::uuid", s["camp"])
            await conn.execute("DELETE FROM campaigns WHERE id = $1::uuid", s["camp"])
            await conn.execute("DELETE FROM email_templates WHERE id = $1::uuid", s["tpl"])
            await conn.execute("DELETE FROM segments WHERE id = ANY($1::uuid[])",
                               [s["seg"], s["seg_din"]])
            await conn.execute("DELETE FROM lead_notes WHERE lead_id = $1::uuid", s["lead"])
            await conn.execute("DELETE FROM lead_tags WHERE lead_id = $1::uuid", s["lead"])
            await conn.execute("DELETE FROM tags WHERE id = $1::uuid", s["tag"])
            await apagar_leads(conn, [s["lead"]])


def _caminhos_de_leitura(s: dict) -> list[str]:
    return [
        "/ab/config", "/ab/testes", f"/ab/testes/{s['ab']}", f"/ab/testes/{s['ab']}/eventos",
        "/automacoes",
        "/campanhas?limit=100", f"/campanhas/{s['camp']}",
        f"/campanhas/{s['camp']}/audiencia", f"/campanhas/{s['camp']}/envios",
        "/jornadas", f"/jornadas/{s['jorn']}", f"/jornadas/{s['jorn']}/execucoes",
        "/contatos?pagina=0&tamanho=50", f"/contatos/busca?q={MARCA}",
        "/contatos/conversoes-utm", "/contatos/duplicatas",
        f"/contatos/{s['lead']}", f"/contatos/{s['lead']}/consentimentos",
        f"/contatos/{s['lead']}/conversoes", f"/contatos/{s['lead']}/conversoes-lista",
        f"/contatos/{s['lead']}/eventos",
        "/paginas", "/paginas/estatisticas", "/paginas/numeros",
        "/painel/agendamentos", "/painel/agendamentos/mql-hoje",
        "/painel/config/lead_goal", "/painel/config/dashboard_cards",
        "/segmentos", f"/segmentos/{s['seg']}/contatos", f"/segmentos/{s['seg_din']}/contatos",
        "/templates?limit=100", f"/templates/{s['tpl']}",
    ]


@pytest.mark.asyncio
async def test_leitura_ve_o_mesmo_que_o_admin(cliente, token_admin, token_leitura,
                                              base_semeada):
    _, token = token_leitura
    diferentes = []
    for caminho in _caminhos_de_leitura(base_semeada):
        a = await cliente.get(caminho, headers=_h(token_admin))
        lt = await cliente.get(caminho, headers=_h(token))
        if a.status_code != lt.status_code or (a.status_code == 200 and a.json() != lt.json()):
            diferentes.append((caminho, a.status_code, lt.status_code))
        elif a.status_code not in (200, 404):
            diferentes.append((caminho, a.status_code, "admin não leu"))
    assert diferentes == []


@pytest.mark.asyncio
async def test_as_listas_principais_nao_vem_vazias(cliente, token_leitura, base_semeada):
    """O desfecho que a comparação acima não pega sozinha: os DOIS verem zero."""
    s = base_semeada
    _, token = token_leitura

    async def ler(caminho):
        r = await cliente.get(caminho, headers=_h(token))
        assert r.status_code == 200, (caminho, r.text)
        return r.json()

    assert s["lead"] in str(await ler("/contatos?pagina=0&tamanho=200"))
    ficha = await ler(f"/contatos/{s['lead']}")
    assert ficha["lead"]["id"] == s["lead"] and ficha["tags"]
    assert s["seg"] in str(await ler("/segmentos"))
    assert s["lead"] in str(await ler(f"/segmentos/{s['seg']}/contatos"))
    assert s["lead"] in str(await ler(f"/segmentos/{s['seg_din']}/contatos"))
    assert s["camp"] in str(await ler("/campanhas?limit=100"))
    assert s["lead"] in str(await ler(f"/campanhas/{s['camp']}/envios"))
    assert s["tpl"] in str(await ler("/templates?limit=100"))
    assert s["jorn"] in str(await ler("/jornadas"))
    assert s["lead"] in str(await ler(f"/jornadas/{s['jorn']}/execucoes"))
    assert s["regra"] in str(await ler("/automacoes"))
    assert s["pag"] in str(await ler("/paginas"))
    assert s["ab"] in str(await ler("/ab/testes"))
    r = await cliente.post("/contatos/tags-por-contato", headers=_h(token),
                           json={"lead_ids": [s["lead"]]})
    assert r.status_code == 200 and s["tag"] in str(r.json()), r.text


# ── usuarios.py ──────────────────────────────────────────────────────────────

def test_criar_usuario_aceita_os_tres_papeis():
    from pydantic import ValidationError
    from app.routers.usuarios import CriarUsuarioIn
    for papel in ("admin", "user", "leitura"):
        assert CriarUsuarioIn(email="a@healthsafety.com.br", senha="x" * 8,
                              papel=papel).papel == papel
    with pytest.raises(ValidationError):
        CriarUsuarioIn(email="a@healthsafety.com.br", senha="x" * 8, papel="dono")


@pytest.mark.asyncio
async def test_admin_troca_papel_para_leitura_e_volta(cliente, token_admin):
    from conftest import _apagar_usuario_de_teste, _criar_usuario_de_teste
    uid, _ = await _criar_usuario_de_teste("usuario-teste-8c", "user")
    try:
        for papel in ("leitura", "user", "leitura"):
            r = await cliente.patch(f"/usuarios/{uid}/papel", headers=_h(token_admin),
                                    json={"papel": papel})
            assert r.status_code == 200, r.text
            assert r.json()["papel"] == papel
        r = await cliente.patch(f"/usuarios/{uid}/papel", headers=_h(token_admin),
                                json={"papel": "dono"})
        assert r.status_code == 422
        lista = (await cliente.get("/usuarios", headers=_h(token_admin))).json()
        assert next(u for u in lista if u["id"] == uid)["papel"] == "leitura"
    finally:
        await _apagar_usuario_de_teste(uid)


@pytest.mark.asyncio
async def test_leitura_nao_conta_como_admin_no_ultimo_admin(token_leitura):
    from app.routers.usuarios import _total_admins
    async with db.sessao(role="service_role") as conn:
        antes = await _total_admins(conn)
        uid, _ = token_leitura
        papel = await conn.fetchval(
            "SELECT role::text FROM user_roles WHERE user_id = $1::uuid", uid)
    assert papel == "leitura"
    # O leitor existe e não entrou na conta de admins.
    async with db.sessao(role="service_role") as conn:
        assert await conn.fetchval(
            "SELECT count(*) FROM user_roles WHERE role = 'admin'") == antes
