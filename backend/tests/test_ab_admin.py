"""As rotas de admin do A/B — o que as telas de Experiments faziam direto no
banco pelo alias `const db = supabase as any`.

O modo de falhar é o do `CLAUDE.md`: permissão errada devolve NADA, não erro.
Um admin veria testes; um usuário comum veria uma tela vazia e acharia que
ninguém criou teste. Por isso o primeiro teste prova o 403.
"""

from uuid import uuid4

import app.database as db
import app.routers.ab as rotas_ab

ALGUM_ID = str(uuid4())


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def test_rotas_de_ab_exigem_admin(cliente, token_usuario):
    rotas = [("GET", "/ab/config", None), ("PUT", "/ab/config", {"production_domain": "x.com"})]
    for metodo, caminho, corpo in rotas:
        r = await cliente.request(metodo, caminho, json=corpo, headers=_auth(token_usuario))
        assert r.status_code == 403, (metodo, caminho, r.text)


async def test_config_vazia_devolve_nulos(cliente, token_admin, config_ab):
    await config_ab(None)
    r = await cliente.get("/ab/config", headers=_auth(token_admin))
    assert r.status_code == 200
    assert r.json() == {"production_domain": None, "redirector_base": None}


async def test_config_normaliza_o_dominio_e_grava_parcial(cliente, token_admin, config_ab):
    await config_ab(None)
    r = await cliente.put("/ab/config", headers=_auth(token_admin),
                          json={"production_domain": " https://www.Exemplo.invalid/lp "})
    assert r.status_code == 200, r.text
    assert r.json() == {"production_domain": "exemplo.invalid", "redirector_base": None}

    # Só o redirecionador: o domínio fica como estava.
    r = await cliente.put("/ab/config", headers=_auth(token_admin),
                          json={"redirector_base": "https://go.exemplo.invalid/"})
    assert r.json() == {"production_domain": "exemplo.invalid",
                        "redirector_base": "https://go.exemplo.invalid"}

    async with db.sessao(role="service_role") as conn:
        assert await conn.fetchval("SELECT count(*) FROM ab_config") == 1


async def test_config_recusa_dominio_vazio_e_redirecionador_sem_protocolo(
        cliente, token_admin, config_ab):
    await config_ab(None)
    r = await cliente.put("/ab/config", headers=_auth(token_admin),
                          json={"production_domain": "   "})
    assert r.status_code == 422
    r = await cliente.put("/ab/config", headers=_auth(token_admin),
                          json={"redirector_base": "go.exemplo.invalid"})
    assert r.status_code == 422


VARIANTES = [{"key": "A", "url": "https://lp.exemplo.invalid/a", "weight": 50, "label": "Controle"},
             {"key": "B", "url": "https://lp.exemplo.invalid/b", "weight": 50}]


def _novo(prefixo: str, sufixo: str = "lp", **extra) -> dict:
    publico = f"{prefixo}-{sufixo}"
    return {"slug": f"{publico}-{uuid4().hex[:4]}", "public_slug": publico,
            "name": f"Teste {sufixo}", "variants": VARIANTES, "control_variant": "A",
            "starts_at": "2026-09-21", **extra}


async def _criar(cliente, token, corpo) -> dict:
    r = await cliente.post("/ab/testes", headers=_auth(token), json=corpo)
    assert r.status_code == 201, r.text
    return r.json()


async def test_rotas_de_teste_exigem_admin(cliente, token_usuario):
    rotas = [("GET", "/ab/testes", None), ("POST", "/ab/testes", {}),
             ("GET", f"/ab/testes/{ALGUM_ID}", None),
             ("PATCH", f"/ab/testes/{ALGUM_ID}", {"name": "x"}),
             ("POST", f"/ab/testes/{ALGUM_ID}/ativar", {"force": False}),
             ("GET", f"/ab/testes/{ALGUM_ID}/eventos", None)]
    for metodo, caminho, corpo in rotas:
        r = await cliente.request(metodo, caminho, json=corpo, headers=_auth(token_usuario))
        assert r.status_code == 403, (metodo, caminho, r.text)


async def test_criar_listar_e_obter(cliente, token_admin, limpar_ab):
    criado = await _criar(cliente, token_admin, _novo(limpar_ab))
    assert criado["status"] == "draft"
    assert criado["variants"][0]["label"] == "Controle"
    assert criado["starts_at"].startswith("2026-09-21")

    lista = (await cliente.get("/ab/testes", headers=_auth(token_admin))).json()
    assert criado["id"] in [t["id"] for t in lista]

    r = await cliente.get(f"/ab/testes/{criado['id']}", headers=_auth(token_admin))
    assert r.json()["public_slug"] == f"{limpar_ab}-lp"
    r = await cliente.get(f"/ab/testes/{ALGUM_ID}", headers=_auth(token_admin))
    assert r.status_code == 404


async def test_criar_recusa_status_que_nao_e_rascunho_e_slug_publico_invalido(
        cliente, token_admin, limpar_ab):
    r = await cliente.post("/ab/testes", headers=_auth(token_admin),
                           json=_novo(limpar_ab, status="running"))
    assert r.status_code == 422
    r = await cliente.post("/ab/testes", headers=_auth(token_admin),
                           json={**_novo(limpar_ab), "public_slug": "Com Espaço"})
    assert r.status_code == 422


async def test_criar_recusa_slug_interno_com_caractere_perigoso(
        cliente, token_admin, limpar_ab):
    """M1: o slug interno vira nome de cookie (`ab_{slug}`) em `Set-Cookie` no
    redirecionador — `;`, espaço ou CRLF ali é injeção de atributo de cookie,
    ou 500 fora do try do redirecionador."""
    r = await cliente.post("/ab/testes", headers=_auth(token_admin),
                           json={**_novo(limpar_ab), "slug": "ruim; Secure\r\nX-Evil: 1"})
    assert r.status_code == 422, r.text


async def test_criar_e_editar_recusam_amostra_alvo_acima_do_int32(
        cliente, token_admin, limpar_ab):
    """M2: `target_sample_per_variant` é `integer` no Postgres — acima de
    int32 o asyncpg recusa ao codificar o parâmetro, e isso não pode chegar
    ao banco: a validação é da API, não um round-trip para descobrir."""
    r = await cliente.post("/ab/testes", headers=_auth(token_admin),
                           json={**_novo(limpar_ab), "target_sample_per_variant": 2147483648})
    assert r.status_code == 422, r.text

    teste = await _criar(cliente, token_admin, _novo(limpar_ab, sufixo="patch"))
    r = await cliente.patch(f"/ab/testes/{teste['id']}", headers=_auth(token_admin),
                            json={"target_sample_per_variant": 2147483648})
    assert r.status_code == 422, r.text


async def test_editar_pausar_concluir_e_recusas(cliente, token_admin, limpar_ab):
    teste = await _criar(cliente, token_admin, _novo(limpar_ab))
    caminho = f"/ab/testes/{teste['id']}"

    r = await cliente.patch(caminho, headers=_auth(token_admin), json={"status": "paused"})
    assert r.status_code == 200 and r.json()["status"] == "paused"

    r = await cliente.patch(caminho, headers=_auth(token_admin), json={
        "status": "completed", "winner_variant": "B", "ends_at": "2026-09-30T12:00:00Z"})
    assert r.json()["winner_variant"] == "B"
    assert r.json()["ends_at"].startswith("2026-09-30")

    # `running` só pela ativação — decisão 9 do plano.
    r = await cliente.patch(caminho, headers=_auth(token_admin), json={"status": "running"})
    assert r.status_code == 422
    # Coluna NOT NULL não aceita nulo explícito.
    r = await cliente.patch(caminho, headers=_auth(token_admin), json={"name": None})
    assert r.status_code == 422
    r = await cliente.patch(caminho, headers=_auth(token_admin), json={"ends_at": "ontem"})
    assert r.status_code == 422
    r = await cliente.patch(f"/ab/testes/{ALGUM_ID}", headers=_auth(token_admin),
                            json={"name": "x"})
    assert r.status_code == 404


async def test_ativar_recusa_conflito_e_forca_conclui_o_anterior(
        cliente, token_admin, limpar_ab):
    primeiro = await _criar(cliente, token_admin, _novo(limpar_ab, name="Primeiro"))
    segundo = await _criar(cliente, token_admin, _novo(limpar_ab, name="Segundo"))

    r = await cliente.post(f"/ab/testes/{primeiro['id']}/ativar",
                           headers=_auth(token_admin), json={"force": False})
    assert r.status_code == 200, r.text
    assert r.json()["activated"] is True

    r = await cliente.post(f"/ab/testes/{segundo['id']}/ativar",
                           headers=_auth(token_admin), json={"force": False})
    assert r.json() == {"activated": False, "conflict_id": primeiro["id"],
                        "conflict_name": "Primeiro"}

    r = await cliente.post(f"/ab/testes/{segundo['id']}/ativar",
                           headers=_auth(token_admin), json={"force": True})
    assert r.json()["activated"] is True
    assert r.json()["completed_name"] == "Primeiro"

    anterior = (await cliente.get(f"/ab/testes/{primeiro['id']}",
                                  headers=_auth(token_admin))).json()
    assert anterior["status"] == "completed"

    r = await cliente.post(f"/ab/testes/{ALGUM_ID}/ativar",
                           headers=_auth(token_admin), json={"force": False})
    assert r.status_code == 404


async def test_eventos_do_teste_com_teto_e_aviso(cliente, token_admin, limpar_ab, monkeypatch):
    teste = await _criar(cliente, token_admin, _novo(limpar_ab))
    async with db.sessao(role="service_role") as conn:
        for i in range(3):
            await conn.execute(
                "INSERT INTO ab_events (ab_test, ab_var, ab_vid, event_type) "
                "VALUES ($1, 'A', $2, 'behavior')", teste["slug"], f"v_teste8c-ev{i}")

    caminho = f"/ab/testes/{teste['id']}/eventos"
    corpo = (await cliente.get(caminho, headers=_auth(token_admin))).json()
    assert len(corpo["events"]) == 3
    assert corpo["truncado"] is False and corpo["teto"] == 20000

    monkeypatch.setattr(rotas_ab, "TETO_EVENTOS", 2)
    corpo = (await cliente.get(caminho, headers=_auth(token_admin))).json()
    assert len(corpo["events"]) == 2 and corpo["truncado"] is True
