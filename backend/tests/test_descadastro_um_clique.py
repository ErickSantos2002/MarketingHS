"""O descadastro de um clique da RFC 8058 (U2, raio-x de 02/10/2026).

Gmail e Yahoo mostram o botão nativo "Cancelar inscrição" quando o e-mail traz
`List-Unsubscribe-Post: List-Unsubscribe=One-Click`, e o botão faz um POST
form-encoded com o corpo `List-Unsubscribe=One-Click` na URL do
`List-Unsubscribe` — com `lid/e/t` na QUERY, não no corpo. Até 02/10 essa URL
era a página do SPA, e o POST levava 405: o contato clicava em sair e
continuava na lista.

⚠️ Banco de PRODUÇÃO: o teste cria o próprio contato (e-mail de rodada) e
apaga, por id e por e-mail, só o que criou. O segredo de descadastro é trocado
por um de teste só dentro do módulo da rota — o de verdade não é tocado.
"""

import base64

import pytest_asyncio

import app.database as db
from app.email.montagem import assinar_token, normalizar_email
from limpeza import apagar_leads
from rodada import EmailDeRodada

SEGREDO = "segredo-de-teste-do-um-clique-0123456789"
CONTATO = EmailDeRodada("descadastro-um-clique")
CORPO = "List-Unsubscribe=One-Click"
FORM = {"content-type": "application/x-www-form-urlencoded"}


def _query(lead_id: str, email: str, segredo: str = SEGREDO) -> dict:
    normalizado = normalizar_email(email)
    return {"lid": lead_id,
            "e": base64.urlsafe_b64encode(normalizado.encode()).decode().rstrip("="),
            "t": assinar_token(lead_id, normalizado, segredo)}


@pytest_asyncio.fixture
async def contato(monkeypatch):
    import app.routers.publico as publico

    async def _segredo(nome):
        assert nome == "UNSUBSCRIBE_SECRET"
        return SEGREDO
    monkeypatch.setattr(publico, "ler_segredo", _segredo)

    await db.init_db()
    async with db.sessao(role="service_role") as conn:
        # Pré-limpeza do que uma rodada morta deixou (forma exata, > 2 h).
        await apagar_leads(conn, [r["id"] for r in await conn.fetch(
            f"SELECT id FROM leads WHERE {CONTATO.onde(1)} AND tipo = 'teste'",
            *CONTATO.parametros())])
        await conn.execute(
            f"DELETE FROM email_suppressions WHERE {CONTATO.onde(1)}",
            *CONTATO.parametros())
        lead = await conn.fetchval(
            "INSERT INTO leads (nome, email, tipo) VALUES ('Um clique', $1, 'teste') "
            "RETURNING id::text", CONTATO.atual)
    yield lead
    async with db.sessao(role="service_role") as conn:
        await conn.execute("DELETE FROM email_suppressions WHERE email = $1",
                           CONTATO.atual)
        await apagar_leads(conn, [lead])


async def _suprimido(email: str):
    async with db.sessao(role="service_role") as conn:
        return await conn.fetchrow(
            "SELECT reason, lead_id::text AS lead_id "
            "FROM email_suppressions WHERE email = $1", email)


async def test_post_de_um_clique_descadastra(cliente, contato):
    r = await cliente.post("/publico/descadastro/um-clique",
                           params=_query(contato, CONTATO.atual),
                           content=CORPO, headers=FORM)
    assert r.status_code == 200, r.text
    linha = await _suprimido(CONTATO.atual)
    assert linha is not None
    assert (linha["reason"], linha["lead_id"]) == ("unsubscribe", contato)


async def test_post_de_um_clique_e_idempotente(cliente, contato):
    """O provedor re-tenta; o segundo POST não pode virar erro."""
    for _ in range(2):
        r = await cliente.post("/publico/descadastro/um-clique",
                               params=_query(contato, CONTATO.atual),
                               content=CORPO, headers=FORM)
        assert r.status_code == 200, r.text


async def test_token_errado_e_recusado_sem_descadastrar(cliente, contato):
    r = await cliente.post("/publico/descadastro/um-clique",
                           params=_query(contato, CONTATO.atual, "outro-segredo"),
                           content=CORPO, headers=FORM)
    assert r.status_code == 401
    assert await _suprimido(CONTATO.atual) is None


async def test_get_nao_descadastra(cliente, contato):
    """RFC 8058: clientes de e-mail pré-carregam links — o GET não pode ter
    efeito colateral."""
    r = await cliente.get("/publico/descadastro/um-clique",
                          params=_query(contato, CONTATO.atual))
    assert r.status_code == 405
    assert await _suprimido(CONTATO.atual) is None
