"""A API de contato para sistema externo — o que eram contact-update,
contact-status-update e contact-tags-sync.

Nenhuma tela chama estas rotas: quem chama é integrador. O modo de falhar é
gravar no contato ERRADO, ou gravar sem deixar o evento que a listagem e as
jornadas leem — e ninguém percebe, porque a resposta volta 200.
"""

import pytest
import pytest_asyncio

import app.database as db
from app.chave_api import gerar_chave

EMAIL = "api-contato-8b@exemplo.invalid"
PREFIXO_TAG = "api-teste-8b"


def _auth(chave: str) -> dict:
    return {"Authorization": f"Bearer {chave}"}


async def _limpar(conn, hashes=()):
    lead_ids = [r["id"] for r in await conn.fetch(
        "SELECT id FROM leads WHERE email = $1", EMAIL)]
    dnias = [r["dnia_id"] for r in await conn.fetch(
        "SELECT dnia_id FROM ecosystem_identities WHERE lower(email) = $1", EMAIL)]
    # `journey_events` não tem FK: `trg_contact_event_journey` copia todo
    # `contact_events` pra lá, e apagar o lead não leva a cópia junto — sem
    # isto os testes vazam linha na fila de jornada de PRODUÇÃO.
    await conn.execute("DELETE FROM journey_events WHERE lead_id = ANY($1::uuid[])",
                       lead_ids)
    for tabela in ("contact_events", "lead_notes", "lead_tags"):
        await conn.execute(f"DELETE FROM {tabela} WHERE lead_id = ANY($1::uuid[])",
                           lead_ids)
    await conn.execute("DELETE FROM leads WHERE id = ANY($1::uuid[])", lead_ids)
    await conn.execute("DELETE FROM ecosystem_identities WHERE dnia_id = ANY($1::uuid[])",
                       dnias)
    await conn.execute("DELETE FROM tags WHERE name LIKE $1", f"{PREFIXO_TAG}%")
    await conn.execute("DELETE FROM api_keys WHERE key_hash = ANY($1::text[])",
                       list(hashes))


@pytest_asyncio.fixture
async def contato_api():
    """Um contato com identidade, uma chave de escrita e uma de leitura.

    ⚠️ O `cliente` COMMITA. Limpa antes (pytest morto no meio deixa linha e o
    e-mail único derruba a rodada seguinte) e depois.
    """
    await db.init_db()
    if db._pool is None:
        pytest.skip("sem DATABASE_URL")
    crua, hash_, prefixo = gerar_chave()
    crua_l, hash_l, prefixo_l = gerar_chave()
    async with db.sessao(role="service_role") as conn:
        await _limpar(conn, (hash_, hash_l))
        lead = await conn.fetchval(
            "INSERT INTO leads (nome, email, tipo, status) "
            "VALUES ('Contato API', $1, 'teste', 'Lead') RETURNING id::text", EMAIL)
        identidade = await conn.fetchval(
            "SELECT resolve_or_create_identity(NULL, $1, 'Contato API', "
            "'marketinghs', $2::uuid, NULL, 'lead')", EMAIL, lead)
        dnia = str(identidade["dnia_id"])
        # Explícito, para o teste não depender de como a function preenche o
        # vínculo canônico: a identidade aponta para ESTE lead.
        await conn.execute(
            "UPDATE ecosystem_identities SET dndash_lead_id = $2::uuid WHERE dnia_id = $1::uuid",
            dnia, lead)
        await conn.execute("UPDATE leads SET dnia_id = $2::uuid WHERE id = $1::uuid",
                           lead, dnia)
        await conn.execute(
            "INSERT INTO api_keys (name, key_hash, key_prefix, permissions) VALUES "
            "('teste 8B escrita', $1, $2, 'write'), ('teste 8B leitura', $3, $4, 'read')",
            hash_, prefixo, hash_l, prefixo_l)
    yield {"lead_id": lead, "dnia_id": dnia, "chave": crua, "chave_leitura": crua_l}
    async with db.sessao(role="service_role") as conn:
        await _limpar(conn, (hash_, hash_l))


async def _eventos(lead_id: str) -> list:
    async with db.sessao(role="service_role") as conn:
        return [dict(r) for r in await conn.fetch(
            "SELECT event_type, source_app, metadata FROM contact_events "
            "WHERE lead_id = $1::uuid ORDER BY occurred_at", lead_id)]


async def test_atualiza_campos_tags_e_nota_por_email(cliente, contato_api):
    r = await cliente.patch(
        "/publico/contato", params={"email": EMAIL.upper()},
        headers=_auth(contato_api["chave"]),
        json={"cargo": "Gerente de SESMT", "empresa": "Transportes Sonda",
              "tags_add": [f"/{PREFIXO_TAG}-VIP ", f"{PREFIXO_TAG}-evento"],
              "note": "Pediu proposta"})

    assert r.status_code == 200, r.text
    corpo = r.json()
    assert corpo["success"] is True
    assert corpo["dnia_id"] == contato_api["dnia_id"]
    assert corpo["updated_fields"] == ["cargo", "empresa", "tags", "note"]
    assert corpo["lead_score"] > 0, "cargo pontua — o gatilho não viu a mudança"

    async with db.sessao(role="service_role") as conn:
        tags = sorted(r["name"] for r in await conn.fetch(
            "SELECT t.name FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id "
            "WHERE lt.lead_id = $1::uuid", contato_api["lead_id"]))
        nota = await conn.fetchval(
            "SELECT content FROM lead_notes WHERE lead_id = $1::uuid", contato_api["lead_id"])
    assert tags == [f"{PREFIXO_TAG}-evento", f"{PREFIXO_TAG}-vip"]
    assert nota == "Pediu proposta"

    eventos = await _eventos(contato_api["lead_id"])
    atualizados = [e for e in eventos if e["event_type"] == "contact_updated"]
    assert atualizados[-1]["source_app"] == "marketinghs"
    assert atualizados[-1]["metadata"]["source"] == "api"


async def test_atualizacao_aceita_numero_em_campo_de_texto(cliente, contato_api):
    """A origem aceitava `{"funcionarios": 50}` e `{"faturamento": 100000.5}`
    nas colunas `text` de `leads`; um porte não nasce menor que o substituído."""
    r = await cliente.patch(
        "/publico/contato", params={"dnia_id": contato_api["dnia_id"]},
        headers=_auth(contato_api["chave"]),
        json={"funcionarios": 50, "faturamento": 100000.5})
    assert r.status_code == 200, r.text
    async with db.sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            "SELECT funcionarios, faturamento FROM leads WHERE id = $1::uuid",
            contato_api["lead_id"])
    assert linha["funcionarios"] == "50"
    assert linha["faturamento"] == "100000.5"


@pytest.mark.parametrize("enviado, gravado", [
    (50.0, "50"),                        # JSON `50.0` — JS grava "50"
    (1500000.00, "1500000"),
    (1e16, "10000000000000000"),         # str() daria "1e+16"
    (100000.5, "100000.5"),
    (-3.0, "-3"),
])
def test_numero_vira_o_mesmo_texto_que_na_origem(enviado, gravado):
    """`str()` do Python formata float diferente do `String()` do JS: o
    integrador que manda `50.0` passaria a gravar "50.0" onde a origem
    gravava "50"."""
    from app.routers.api_contato import AtualizacaoIn
    assert AtualizacaoIn(funcionarios=enviado).funcionarios == gravado


@pytest.mark.parametrize("enviado", [float("nan"), float("inf"), float("-inf")])
def test_numero_nao_finito_e_recusado(enviado):
    """O parser JSON do Python aceita `NaN` e `Infinity`; gravar "nan" numa
    coluna de faturamento é lixo silencioso — melhor 422."""
    from pydantic import ValidationError

    from app.routers.api_contato import AtualizacaoIn
    with pytest.raises(ValidationError):
        AtualizacaoIn(faturamento=enviado)


async def test_remove_tag_sem_diferenciar_maiuscula(cliente, contato_api):
    await cliente.patch("/publico/contato", params={"dnia_id": contato_api["dnia_id"]},
                        headers=_auth(contato_api["chave"]),
                        json={"tags_add": [f"{PREFIXO_TAG}-sai"]})
    r = await cliente.patch("/publico/contato", params={"dnia_id": contato_api["dnia_id"]},
                            headers=_auth(contato_api["chave"]),
                            json={"tags_remove": [f"{PREFIXO_TAG}-SAI"]})
    assert r.status_code == 200, r.text
    async with db.sessao(role="service_role") as conn:
        assert await conn.fetchval(
            "SELECT count(*) FROM lead_tags WHERE lead_id = $1::uuid",
            contato_api["lead_id"]) == 0


async def test_status_pela_atualizacao_grava_os_eventos_de_status(cliente, contato_api):
    r = await cliente.patch("/publico/contato", params={"dnia_id": contato_api["dnia_id"]},
                            headers=_auth(contato_api["chave"]),
                            json={"status": "lead qualificado"})
    assert r.status_code == 200, r.text
    assert r.json()["updated_fields"] == ["status"]
    tipos = [e["event_type"] for e in await _eventos(contato_api["lead_id"])]
    assert "lead_qualified" in tipos


async def test_status_pela_atualizacao_grava_um_so_contact_updated(cliente, contato_api):
    """Fix round 1: a duplicação era o achado do reviewer — `_registrar_mudanca`
    gravava o genérico e a rota gravava o seu, virando DOIS `contact_updated`
    (e duas linhas em `journey_events`, via `trg_contact_event_journey`)."""
    r = await cliente.patch("/publico/contato", params={"dnia_id": contato_api["dnia_id"]},
                            headers=_auth(contato_api["chave"]),
                            json={"status": "lead qualificado"})
    assert r.status_code == 200, r.text
    eventos = await _eventos(contato_api["lead_id"])
    tipos = [e["event_type"] for e in eventos]
    assert tipos.count("contact_updated") == 1
    assert tipos.count("lead_qualified") == 1
    atualizado = next(e for e in eventos if e["event_type"] == "contact_updated")
    assert atualizado["metadata"]["status_atual"] == "Lead Qualificado"
    assert atualizado["metadata"]["status_anterior"] == "Lead"


async def test_status_pela_atualizacao_alimenta_o_indicador_de_mql(
        cliente, contato_api, token_admin):
    """Fim a fim: mudar o status pelo admin ATÉ o indicador de agendamentos
    contar — o achado do controlador era o admin gravar `de`/`para` sem as
    chaves de origem que a métrica lê."""
    r = await cliente.patch(
        f"/contatos/{contato_api['lead_id']}/status",
        headers=_auth(token_admin), json={"status": "MQL - Reunião agendada"})
    assert r.status_code == 200, r.text

    r = await cliente.get("/painel/agendamentos/mql-hoje", headers=_auth(token_admin))
    assert r.status_code == 200, r.text
    assert contato_api["lead_id"] in r.json()


async def test_status_em_lote_tambem_alimenta_o_indicador_de_mql(
        cliente, contato_api, token_admin):
    r = await cliente.post(
        "/contatos/status-em-lote", headers=_auth(token_admin),
        json={"lead_ids": [contato_api["lead_id"]], "status": "MQL - Reunião agendada"})
    assert r.status_code == 200, r.text

    eventos = await _eventos(contato_api["lead_id"])
    atualizado = next(e for e in eventos if e["event_type"] == "contact_updated")
    assert atualizado["metadata"]["status_atual"] == "MQL - Reunião agendada"


async def test_status_desconhecido_e_400_e_nada_muda(cliente, contato_api):
    r = await cliente.patch("/publico/contato", params={"dnia_id": contato_api["dnia_id"]},
                            headers=_auth(contato_api["chave"]),
                            json={"status": "Inventado", "cargo": "Diretor"})
    assert r.status_code == 400
    assert "Lead Qualificado" in r.json()["detail"], "a mensagem lista os que valem"
    async with db.sessao(role="service_role") as conn:
        assert await conn.fetchval(
            "SELECT cargo FROM leads WHERE id = $1::uuid", contato_api["lead_id"]) is None


async def test_sem_identificador_e_400(cliente, contato_api):
    r = await cliente.patch("/publico/contato", headers=_auth(contato_api["chave"]),
                            json={"cargo": "x"})
    assert r.status_code == 400


async def test_contato_inexistente_e_404(cliente, contato_api):
    r = await cliente.patch("/publico/contato", params={"email": "ninguem@exemplo.invalid"},
                            headers=_auth(contato_api["chave"]), json={"cargo": "x"})
    assert r.status_code == 404


async def test_chave_de_leitura_nao_escreve(cliente, contato_api):
    r = await cliente.patch("/publico/contato", params={"email": EMAIL},
                            headers=_auth(contato_api["chave_leitura"]),
                            json={"cargo": "x"})
    assert r.status_code == 403


async def test_status_por_dnia_id_grava_contact_updated_e_lead_qualified(
        cliente, contato_api):
    r = await cliente.patch("/publico/contato/status", headers=_auth(contato_api["chave"]),
                            json={"dnia_id": contato_api["dnia_id"],
                                  "status": "LEAD QUALIFICADO"})
    assert r.status_code == 200, r.text
    assert r.json() == {"success": True, "dnia_id": contato_api["dnia_id"],
                        "lead_id": contato_api["lead_id"], "status_anterior": "Lead",
                        "status_atual": "Lead Qualificado", "status_created": False}
    eventos = await _eventos(contato_api["lead_id"])
    tipos = [e["event_type"] for e in eventos]
    assert tipos.count("contact_updated") == 1
    assert tipos.count("lead_qualified") == 1
    atualizado = next(e for e in eventos if e["event_type"] == "contact_updated")
    assert atualizado["metadata"]["source"] == "api", \
        "sem isto, a mudança pela API fica igual à do painel na timeline"
    assert atualizado["metadata"]["status_atual"] == "Lead Qualificado"


async def test_status_aceita_post_como_alias(cliente, contato_api):
    r = await cliente.post("/publico/contato/status", headers=_auth(contato_api["chave"]),
                           json={"dnia_id": contato_api["dnia_id"], "status": "Iniciado"})
    assert r.status_code == 200, r.text
    assert r.json()["status_atual"] == "Iniciado"


async def test_status_nao_avanca_o_estagio_da_identidade(cliente, contato_api):
    """Decisão 2 do plano. Se o Erick decidir que avança, este teste muda junto
    com a rota do admin — nunca uma sem a outra."""
    r = await cliente.patch("/publico/contato/status", headers=_auth(contato_api["chave"]),
                            json={"dnia_id": contato_api["dnia_id"],
                                  "status": "Lead Qualificado"})
    assert r.status_code == 200, r.text
    async with db.sessao(role="service_role") as conn:
        estagio = await conn.fetchval(
            "SELECT stage FROM ecosystem_identities WHERE dnia_id = $1::uuid",
            contato_api["dnia_id"])
    assert estagio != "opportunity"


async def test_status_desconhecido_e_400(cliente, contato_api):
    r = await cliente.patch("/publico/contato/status", headers=_auth(contato_api["chave"]),
                            json={"dnia_id": contato_api["dnia_id"], "status": "Novo Status"})
    assert r.status_code == 400


async def test_status_dnia_id_inexistente_e_404(cliente, contato_api):
    r = await cliente.patch("/publico/contato/status", headers=_auth(contato_api["chave"]),
                            json={"dnia_id": "00000000-0000-0000-0000-000000000000",
                                  "status": "Lead"})
    assert r.status_code == 404
    assert r.json()["detail"] == "dnia_id não encontrado."


async def test_status_dnia_id_malformado_e_422(cliente, contato_api):
    r = await cliente.patch("/publico/contato/status", headers=_auth(contato_api["chave"]),
                            json={"dnia_id": "nao-e-uuid", "status": "Lead"})
    assert r.status_code == 422


async def test_tags_espelha_o_conjunto(cliente, contato_api):
    chave = _auth(contato_api["chave"])
    base = {"dnia_id": contato_api["dnia_id"]}
    r1 = await cliente.put("/publico/contato/tags", headers=chave, json={
        **base, "tags": [f"{PREFIXO_TAG}-a", f"{PREFIXO_TAG}-b"]})
    assert r1.status_code == 200, r1.text
    assert sorted(r1.json()["created_tags"]) == [f"{PREFIXO_TAG}-a", f"{PREFIXO_TAG}-b"]

    r2 = await cliente.put("/publico/contato/tags", headers=chave, json={
        **base, "tags": [f"{PREFIXO_TAG}-B", f"/{PREFIXO_TAG}-c", f"{PREFIXO_TAG}-c", 7]})
    corpo = r2.json()
    assert corpo["tags_final"] == [f"{PREFIXO_TAG}-b", f"{PREFIXO_TAG}-c"]
    assert corpo["added"] == [f"{PREFIXO_TAG}-c"]
    assert corpo["removed"] == [f"{PREFIXO_TAG}-a"]
    assert corpo["kept"] == [f"{PREFIXO_TAG}-b"]

    # A resposta é calculada em memória — confere o banco também, senão um
    # DELETE quebrado (a tag "removida" continuando em lead_tags) passaria.
    async with db.sessao(role="service_role") as conn:
        tags_no_banco = {r["name"] for r in await conn.fetch(
            """SELECT t.name FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id
                WHERE lt.lead_id = $1::uuid""", contato_api["lead_id"])}
    assert tags_no_banco == set(corpo["tags_final"])

    tipos = [e["event_type"] for e in await _eventos(contato_api["lead_id"])]
    assert tipos.count("tags_synced") == 2


async def test_tags_lista_vazia_limpa_tudo_e_post_e_alias(cliente, contato_api):
    chave = _auth(contato_api["chave"])
    await cliente.put("/publico/contato/tags", headers=chave, json={
        "email": EMAIL, "tags": [f"{PREFIXO_TAG}-x"]})
    r = await cliente.post("/publico/contato/tags", headers=chave,
                           json={"email": EMAIL, "tags": []})
    assert r.status_code == 200, r.text
    assert r.json()["removed"] == [f"{PREFIXO_TAG}-x"]
    async with db.sessao(role="service_role") as conn:
        assert await conn.fetchval("SELECT count(*) FROM lead_tags WHERE lead_id = $1::uuid",
                                   contato_api["lead_id"]) == 0


async def test_tags_sem_identificador_e_400(cliente, contato_api):
    r = await cliente.put("/publico/contato/tags", headers=_auth(contato_api["chave"]),
                          json={"tags": []})
    assert r.status_code == 400


async def test_tags_que_nao_e_lista_e_400(cliente, contato_api):
    r = await cliente.put("/publico/contato/tags", headers=_auth(contato_api["chave"]),
                          json={"email": EMAIL, "tags": "a,b"})
    assert r.status_code == 400
    assert "array" in r.json()["detail"]
