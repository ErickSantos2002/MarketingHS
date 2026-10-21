"""Modo teste da jornada (prova do RD, Tarefa 7 — frente prova-jornadas).

Antimeta nº 1 da spec: **nenhum e-mail sai para fora da lista**. Com
`journeys.allowed_emails` preenchida, nenhum nó com efeito (`send_email`,
`handoff_growthhs`, `notify_email`, `webhook`) age sobre quem não está nela —
o passo fica `skipped` e o fluxo segue. O worker confere de novo antes do
Resend (segunda trava).

Jornada e run são REAIS, dentro da transação revertida de `conexao`:
`journey_step_log` e `campaign_sends` têm FK para o run.

⚠️ Os testes que precisam da coluna `allowed_emails` PULAM com o motivo
enquanto a migration 027 não estiver aplicada no banco do pytest (molde
`_exigir_027` de `test_migracao_027.py`). Os que não precisam — a trava do
executor com `contato_permitido` trocado, a validação da rota, a segunda trava
do worker com conexão falsa — rodam em qualquer banco.
"""

import uuid

import pytest
import pytest_asyncio
from pydantic import ValidationError

import app.database as db
from app import fila, worker
from app.jornadas import executor
from app.routers.jornadas import JornadaIn, JornadaPatch


async def _tem_027(conexao) -> bool:
    return await conexao.fetchval(
        "SELECT to_regclass('public.journey_saidas') IS NOT NULL")


async def _exigir_027(conexao):
    if not await _tem_027(conexao):
        pytest.skip("migration 027 ainda não aplicada neste banco")


async def _lead(conexao, email):
    return await conexao.fetchval(
        "INSERT INTO leads (nome, email, tipo) VALUES ('Prova jornadas', $1, 'teste') "
        "RETURNING id::text", email)


async def _template(conexao):
    return await conexao.fetchval(
        "INSERT INTO email_templates (name, html) "
        "VALUES ('prova-jornadas', '<p>Oi {{nome}}</p>') RETURNING id::text")


async def _jornada(conexao, nos, permitidos=None):
    jid = await conexao.fetchval(
        """INSERT INTO journeys (name, status, entry_type, entry_config,
                                 entry_node_id, nodes)
           VALUES ('prova-jornadas', 'active', 'event',
                   '{"event_type": "form_submitted", "page_slug": "prova-jornadas"}',
                   $1, $2::jsonb)
           RETURNING id::text""", nos[0]["id"], nos)
    if permitidos is not None:
        await conexao.execute(
            "UPDATE journeys SET allowed_emails = $2::text[] WHERE id = $1::uuid",
            jid, permitidos)
    return jid


async def _run(conexao, jornada, lead, nos):
    """Um run como `journey_claim_due_runs` entrega: reivindicado, com o
    `lock_token` que o `gravar_run` confere."""
    linha = await conexao.fetchrow(
        "INSERT INTO journey_runs (journey_id, lead_id, state, current_node_id, "
        "lock_token, locked_until) "
        "VALUES ($1::uuid, $2::uuid, 'active', $3, gen_random_uuid(), "
        "now() + interval '5 minutes') RETURNING id::text, lock_token::text",
        jornada, lead, nos[0]["id"])
    return {"run_id": linha["id"], "journey_id": jornada, "lead_id": lead,
            "current_node_id": nos[0]["id"], "state": "active",
            "waiting_event": None, "context": {}, "lock_token": linha["lock_token"],
            "nodes": nos}


def _no_email(template, proximo=None):
    return {"id": "n1", "type": "send_email",
            "config": {"template_id": template, "subject": "Oi"}, "next": proximo}


async def _envios(conexao, run):
    return await conexao.fetch(
        "SELECT id::text, status FROM campaign_sends WHERE journey_run_id = $1::uuid",
        run["run_id"])


async def _passos(conexao, run):
    return [(l["node_type"], l["result"], l["detail"]) for l in await conexao.fetch(
        "SELECT node_type, result, detail FROM journey_step_log "
        "WHERE run_id = $1::uuid", run["run_id"])]


# ── A trava do executor (sem a 027: `contato_permitido` trocado) ─────────────

@pytest.mark.parametrize("tipo", ["handoff_growthhs", "notify_email", "send_email",
                                  "webhook"])
async def test_no_com_efeito_fora_da_lista_vira_pulado(conexao, monkeypatch, tipo):
    """Qualquer nó com efeito, para contato fora da lista: nada é criado, o
    passo fica `skipped` com o motivo e o fluxo segue para o `next`."""
    async def fora(conn, run):
        return False
    monkeypatch.setattr(executor, "contato_permitido", fora)
    template = await _template(conexao)
    lead = await _lead(conexao, "fora-da-lista@exemplo.invalid")
    nos = [_no_email(template, "n2"),
           {"id": "n2", "type": "delay", "config": {"minutes": 60}, "next": None}]
    run = await _run(conexao, await _jornada(conexao, nos), lead, nos)
    no = {"id": "n1", "type": tipo, "next": "n2",
          "config": {"template_id": template, "subject": "Oi",
                     "emails": ["comercial@exemplo.invalid"],
                     "url": "https://exemplo.invalid/gancho"}}

    saida = await executor.executar_no(conexao, run, no)

    assert saida == {"tipo": "avancar", "proximo": "n2"}
    assert await _envios(conexao, run) == []
    assert await conexao.fetchval(
        "SELECT count(*) FROM crm_handoffs WHERE lead_id = $1::uuid", lead) == 0
    # Ordem não se confere: `occurred_at` é o `now()` da transação, igual
    # em todas as linhas deste teste.
    pulados = [p for p in await _passos(conexao, run) if p[:2] == (tipo, "skipped")]
    assert [p[2]["motivo"] for p in pulados] == ["modo teste: contato fora da lista"]


def test_nos_com_efeito_sao_os_quatro():
    assert executor.NOS_COM_EFEITO == frozenset(
        {"send_email", "handoff_growthhs", "notify_email", "webhook"})


async def test_no_sem_efeito_nao_consulta_a_lista(conexao, monkeypatch):
    """Tag, espera e condicional não mandam nada para ninguém: não passam pela
    trava (e não pagam a consulta)."""
    async def proibido(conn, run):
        raise AssertionError("nó sem efeito não consulta a lista")
    monkeypatch.setattr(executor, "contato_permitido", proibido)
    lead = await _lead(conexao, "sem-efeito@exemplo.invalid")
    nos = [{"id": "n1", "type": "apply_tag", "config": {"tag_name": "prova-jornadas"},
            "next": None}]
    run = await _run(conexao, await _jornada(conexao, nos), lead, nos)
    assert await executor.executar_no(conexao, run, nos[0]) == {
        "tipo": "avancar", "proximo": None}


# ── A comparação de verdade (com a 027) ──────────────────────────────────────

async def test_modo_teste_pula_send_email_de_quem_nao_esta_na_lista(conexao):
    await _exigir_027(conexao)
    template = await _template(conexao)
    lead = await _lead(conexao, "cliente-real@exemplo.invalid")
    nos = [_no_email(template)]
    run = await _run(conexao, await _jornada(
        conexao, nos, ["erick@exemplo.invalid"]), lead, nos)

    await executor.rodar_cadeia(conexao, run)

    assert await _envios(conexao, run) == []
    assert ("send_email", "skipped") in [p[:2] for p in await _passos(conexao, run)]
    assert await conexao.fetchval(
        "SELECT state FROM journey_runs WHERE id = $1::uuid", run["run_id"]) == "done"


async def test_modo_teste_envia_para_quem_esta_na_lista(conexao):
    await _exigir_027(conexao)
    template = await _template(conexao)
    lead = await _lead(conexao, "erick@exemplo.invalid")
    nos = [_no_email(template)]
    run = await _run(conexao, await _jornada(
        conexao, nos, ["erick@exemplo.invalid"]), lead, nos)

    await executor.rodar_cadeia(conexao, run)

    envios = await _envios(conexao, run)
    assert [e["status"] for e in envios] == ["pending"]


async def test_modo_teste_compara_sem_caixa_e_espaco(conexao):
    """A lista chega normalizada pela rota; o contato pode estar gravado com
    qualquer caixa. Aqui a lista vai crua de propósito (escrita direta no
    banco): a comparação apara e tira a caixa dos DOIS lados."""
    await _exigir_027(conexao)
    template = await _template(conexao)
    lead = await _lead(conexao, " erick@exemplo.INVALID ")
    nos = [_no_email(template)]
    run = await _run(conexao, await _jornada(
        conexao, nos, [" Erick@Exemplo.invalid "]), lead, nos)

    assert await executor.contato_permitido(conexao, run) is True
    await executor.rodar_cadeia(conexao, run)
    assert len(await _envios(conexao, run)) == 1


async def test_modo_teste_pula_handoff(conexao):
    await _exigir_027(conexao)
    lead = await _lead(conexao, "cliente-real@exemplo.invalid")
    nos = [{"id": "n1", "type": "handoff_growthhs", "config": {}, "next": None}]
    run = await _run(conexao, await _jornada(
        conexao, nos, ["erick@exemplo.invalid"]), lead, nos)

    await executor.rodar_cadeia(conexao, run)

    assert await conexao.fetchval(
        "SELECT count(*) FROM crm_handoffs WHERE lead_id = $1::uuid", lead) == 0


async def test_sem_lista_comportamento_de_antes(conexao):
    """`allowed_emails` NULL (ou a coluna nem existir, antes da 027) = sem
    modo teste: o e-mail é criado como sempre foi."""
    template = await _template(conexao)
    lead = await _lead(conexao, "qualquer-um@exemplo.invalid")
    nos = [_no_email(template)]
    run = await _run(conexao, await _jornada(conexao, nos), lead, nos)

    assert await executor.contato_permitido(conexao, run) is True
    await executor.rodar_cadeia(conexao, run)
    assert len(await _envios(conexao, run)) == 1


async def test_lista_lida_uma_vez_por_run(conexao):
    await _exigir_027(conexao)
    lead = await _lead(conexao, "erick@exemplo.invalid")
    nos = [{"id": "n1", "type": "delay", "config": {"minutes": 1}, "next": None}]
    jornada = await _jornada(conexao, nos, ["erick@exemplo.invalid"])
    run = await _run(conexao, jornada, lead, nos)

    assert await executor.contato_permitido(conexao, run) is True
    # A lista muda no meio da invocação: vale a que foi lida no começo dela.
    await conexao.execute(
        "UPDATE journeys SET allowed_emails = '{outro@exemplo.invalid}' "
        "WHERE id = $1::uuid", jornada)
    assert await executor.contato_permitido(conexao, run) is True
    assert run["_permitido"] is True


async def test_lista_vazia_no_banco_nao_libera_ninguem(conexao):
    """`[]` só vira "sem modo teste" pela rota (que grava NULL). Um `{}`
    gravado direto no banco é lista vazia: ninguém passa."""
    await _exigir_027(conexao)
    lead = await _lead(conexao, "erick@exemplo.invalid")
    nos = [{"id": "n1", "type": "delay", "config": {"minutes": 1}, "next": None}]
    run = await _run(conexao, await _jornada(conexao, nos, []), lead, nos)
    assert await executor.contato_permitido(conexao, run) is False


# ── A rota ───────────────────────────────────────────────────────────────────

def test_lista_e_normalizada_no_modelo():
    j = JornadaIn(name="x", entry_type="event",
                  allowed_emails=[" Erick@X.com ", "erick@x.com", "B@Y.com.br"])
    assert j.allowed_emails == ["erick@x.com", "b@y.com.br"]


@pytest.mark.parametrize("modelo", [JornadaIn, JornadaPatch])
def test_lista_vazia_vira_none(modelo):
    extra = {"name": "x", "entry_type": "event"} if modelo is JornadaIn else {}
    assert modelo(allowed_emails=[], **extra).allowed_emails is None


@pytest.mark.parametrize("lista", [["nao-e-email"], ["a@b"], ["a b@c.com"],
                                   [f"p{i}@exemplo.invalid" for i in range(51)]])
def test_lista_invalida_recusada_no_modelo(lista):
    with pytest.raises(ValidationError):
        JornadaPatch(allowed_emails=lista)


async def test_rota_recusa_email_invalido_na_lista_422(cliente, token_admin):
    r = await cliente.post(
        "/jornadas", headers={"Authorization": f"Bearer {token_admin}"},
        json={"name": "prova-jornadas 422", "entry_type": "event",
              "allowed_emails": ["erick@exemplo.invalid", "isto não é e-mail"]})
    assert r.status_code == 422


@pytest_asyncio.fixture
async def jornadas_criadas():
    """O `cliente` COMITA: apaga as jornadas criadas pela rota, por id."""
    ids = []
    yield ids
    if ids:
        async with db.sessao(role="service_role") as conn:
            await conn.execute("DELETE FROM journeys WHERE id = ANY($1::uuid[])", ids)


async def test_rota_lista_vazia_vira_null(cliente, token_admin, jornadas_criadas):
    async with db.sessao(role="service_role") as conn:
        if not await conn.fetchval(
                "SELECT to_regclass('public.journey_saidas') IS NOT NULL"):
            pytest.skip("migration 027 ainda não aplicada neste banco")
    auth = {"Authorization": f"Bearer {token_admin}"}
    r = await cliente.post("/jornadas", headers=auth, json={
        "name": f"prova-jornadas {uuid.uuid4().hex[:6]}", "entry_type": "event",
        "entry_config": {"event_type": "form_submitted"},
        "allowed_emails": [" Erick@Exemplo.invalid "]})
    assert r.status_code == 201, r.text
    jid = r.json()["journey"]["id"]
    jornadas_criadas.append(jid)

    lida = (await cliente.get(f"/jornadas/{jid}", headers=auth)).json()["data"]
    assert lida["allowed_emails"] == ["erick@exemplo.invalid"]
    listada = [j for j in (await cliente.get("/jornadas", headers=auth)).json()["data"]
               if j["id"] == jid]
    assert listada[0]["allowed_emails"] == ["erick@exemplo.invalid"]

    r = await cliente.patch(f"/jornadas/{jid}", headers=auth, json={"allowed_emails": []})
    assert r.status_code == 200, r.text
    async with db.sessao(role="service_role") as conn:
        assert await conn.fetchval(
            "SELECT allowed_emails FROM journeys WHERE id = $1::uuid", jid) is None


# ── A segunda trava: o worker ────────────────────────────────────────────────

class _ConnFalsa:
    """O caminho do `_processar` para e-mail de jornada, sem banco."""

    def __init__(self, envio, conteudo):
        self.respostas = [envio, conteudo]
        self.execs = []

    async def fetchrow(self, sql, *a):
        return self.respostas.pop(0)

    async def fetchval(self, sql, *a):
        return None

    async def execute(self, sql, *a):
        self.execs.append((sql, a))


def _envio_de_jornada(email):
    return {"status": "pending", "journey_node_id": "n1", "journey_run_id": "r1",
            "campanha": None, "subject": "", "body": "", "email": email,
            "nome": "X", "empresa": None}


@pytest.fixture
def resend_proibido(monkeypatch):
    async def enviar(**_):
        raise AssertionError("o Resend não pode ser chamado fora da lista")
    monkeypatch.setattr(worker.resend, "enviar", enviar)

    concluidas = []

    async def concluir(conn, fila_id):
        concluidas.append(fila_id)
    monkeypatch.setattr(worker.fila, "concluir", concluir)
    return concluidas


async def test_worker_recusa_fora_da_lista_sem_banco(resend_proibido):
    conn = _ConnFalsa(_envio_de_jornada("Cliente@Real.com"),
                      {"subject": "Oi", "body": "<p>x</p>",
                       "allowed_emails": [" erick@exemplo.invalid "]})
    m = fila.Mensagem(fila_id=7, send_id="s1", campaign_id=None, lead_id="l1",
                      tentativas=1)

    await worker._processar(conn, m, "re_falsa", "a@exemplo.invalid", "seg", 2.0)

    assert resend_proibido == [7]
    sql, args = conn.execs[-1]
    assert "status = 'failed'" in sql
    assert "modo teste: fora da lista" in sql + " ".join(map(str, args))


async def test_worker_lista_vazia_tambem_recusa(resend_proibido):
    conn = _ConnFalsa(_envio_de_jornada("erick@exemplo.invalid"),
                      {"subject": "Oi", "body": "<p>x</p>", "allowed_emails": []})
    m = fila.Mensagem(fila_id=8, send_id="s1", campaign_id=None, lead_id="l1",
                      tentativas=1)
    await worker._processar(conn, m, "re_falsa", "a@exemplo.invalid", "seg", 2.0)
    assert resend_proibido == [8]


async def test_worker_recusa_envio_de_jornada_fora_da_lista(conexao, resend_proibido):
    """Ponta a ponta no banco: a linha nasceu (a lista mudou depois que o nó
    rodou, ou o executor falhou em barrar) e o worker não deixa sair."""
    await _exigir_027(conexao)
    template = await _template(conexao)
    lead = await _lead(conexao, "cliente-real@exemplo.invalid")
    nos = [_no_email(template)]
    jornada = await _jornada(conexao, nos)
    run = await _run(conexao, jornada, lead, nos)
    await executor.rodar_cadeia(conexao, run)
    [envio] = await _envios(conexao, run)
    await conexao.execute(
        "UPDATE journeys SET allowed_emails = '{erick@exemplo.invalid}' "
        "WHERE id = $1::uuid", jornada)
    fila_id = await conexao.fetchval(
        "SELECT id FROM email_send_queue WHERE send_id = $1::uuid", envio["id"])
    m = fila.Mensagem(fila_id=fila_id, send_id=envio["id"], campaign_id=None,
                      lead_id=lead, tentativas=1)

    await worker._processar(conexao, m, "re_falsa", "a@exemplo.invalid", "seg", 2.0)

    linha = await conexao.fetchrow(
        "SELECT status, error FROM campaign_sends WHERE id = $1::uuid", envio["id"])
    assert (linha["status"], linha["error"]) == ("failed", "modo teste: fora da lista")
