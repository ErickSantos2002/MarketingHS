"""Faxina R5 (frente faxina-r5, 07/10/2026): as sobras da revisão do r5-jornadas.

- nó "mudar status" com contato excluído: passo `skipped`, nada gravado;
- erro que não se cura sozinho (status inexistente, tag vazia, nó desconhecido)
  falha o run na 1ª vez, com o motivo — sem as 3 re-tentativas;
- `_aplicar_tag` (e a tag do slug da captura) acham a tag sem diferenciar
  maiúscula, como o `remove_tag` — não criam "cliente" ao lado de "Cliente".

Tudo dentro da transação revertida da fixture `conexao`.
"""

import pytest

from app.jornadas import executor

RUN_ID = "00000000-0000-0000-0000-0000000000f1"
JORNADA_ID = "00000000-0000-0000-0000-0000000000f2"
LOCK = "00000000-0000-0000-0000-0000000000f3"


async def _lead(conexao, email="faxina-r5@exemplo.invalid", **colunas):
    colunas.setdefault("tipo", "teste")
    nomes = ["email", *colunas]
    valores = [email, *colunas.values()]
    marcas = ", ".join(f"${i}" for i in range(1, len(valores) + 1))
    return await conexao.fetchval(
        f"INSERT INTO leads ({', '.join(nomes)}) VALUES ({marcas}) RETURNING id::text",
        *valores)


def _run(lead, nos=None, atual=None, contexto=None):
    return {"run_id": RUN_ID, "journey_id": JORNADA_ID, "lead_id": lead,
            "lock_token": LOCK, "context": contexto or {},
            "nodes": nos or [], "current_node_id": atual}


@pytest.fixture
def passos(monkeypatch):
    """`journey_step_log` tem FK para o run; aqui o run é de mentira."""
    registrados = []

    async def registrar(conn, run, no, resultado, detalhe=None):
        registrados.append((no.get("type"), resultado, detalhe))
    monkeypatch.setattr(executor, "registrar_passo", registrar)
    return registrados


@pytest.fixture
def gravacoes(monkeypatch):
    """O run é de mentira: `gravar_run` só anota o patch."""
    feitas = []

    async def gravar(conn, run, patch):
        feitas.append(patch)
        return True
    monkeypatch.setattr(executor, "gravar_run", gravar)
    return feitas


async def _eventos(conexao, lead):
    return await conexao.fetchval(
        "SELECT count(*) FROM contact_events WHERE lead_id = $1::uuid "
        "AND event_type IN ('contact_updated', 'lead_qualified')", lead)


# ── change_status olha deleted_at ────────────────────────────────────────────

async def test_mudar_status_de_contato_excluido_pula_sem_gravar(conexao, passos):
    lead = await _lead(conexao, status="Lead")
    await conexao.execute(
        "UPDATE leads SET deleted_at = now() WHERE id = $1::uuid", lead)
    no = {"id": "n1", "type": "change_status",
          "config": {"status": "Lead Qualificado"}, "next": "n2"}

    saida = await executor.executar_no(conexao, _run(lead), no)

    assert saida == {"tipo": "avancar", "proximo": "n2"}
    assert await conexao.fetchval(
        "SELECT status FROM leads WHERE id = $1::uuid", lead) == "Lead"
    assert await _eventos(conexao, lead) == 0
    tipo, resultado, detalhe = passos[-1]
    assert (tipo, resultado) == ("change_status", "skipped")
    assert detalhe["mudou"] is False
    assert "excluído" in detalhe["motivo"]


# ── erro definitivo falha na hora ────────────────────────────────────────────

async def test_status_inexistente_falha_o_run_na_primeira_vez(conexao, passos, gravacoes):
    lead = await _lead(conexao)
    nos = [{"id": "n1", "type": "change_status",
            "config": {"status": "Status Que Não Existe"}, "next": None}]

    saida = await executor.rodar_cadeia(conexao, _run(lead, nos, "n1"))

    assert saida["falhou"] is True
    final = gravacoes[-1]
    assert final["state"] == "failed"
    assert final["context"]["attempts"] == 1
    assert "Status Que Não Existe" in final["context"]["error"]
    assert final["current_node_id"] == "n1"
    assert len(gravacoes) == 1  # nenhum reagendamento antes


@pytest.mark.parametrize("no", [
    {"id": "n1", "type": "apply_tag", "config": {"tag_name": "// "}, "next": None},
    {"id": "n1", "type": "remove_tag", "config": {"tag_name": ""}, "next": None},
    {"id": "n1", "type": "no_que_nao_existe", "config": {}, "next": None},
])
async def test_outros_erros_definitivos_tambem_falham_na_hora(conexao, passos,
                                                             gravacoes, no):
    lead = await _lead(conexao)
    saida = await executor.rodar_cadeia(conexao, _run(lead, [no], "n1"))
    assert saida["falhou"] is True
    assert gravacoes[-1]["state"] == "failed"
    assert gravacoes[-1]["context"]["attempts"] == 1


async def test_erro_transitorio_continua_re_tentando(conexao, passos, gravacoes,
                                                    monkeypatch):
    """O banco caindo no meio NÃO é definitivo: reagenda o mesmo nó."""
    lead = await _lead(conexao)

    async def explode(conn, run, no):
        raise ConnectionError("conexão perdida")
    monkeypatch.setattr(executor, "executar_no", explode)
    nos = [{"id": "n1", "type": "apply_tag", "config": {"tag_name": "x"}, "next": None}]

    saida = await executor.rodar_cadeia(conexao, _run(lead, nos, "n1"))

    assert saida["falhou"] is False
    assert gravacoes[-1]["state"] == "waiting"
    assert gravacoes[-1]["context"]["attempts"] == 1


# ── _aplicar_tag sem caixa ───────────────────────────────────────────────────

async def _tags_do_lead(conexao, lead):
    return sorted(r["name"] for r in await conexao.fetch(
        "SELECT t.name FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id "
        "WHERE lt.lead_id = $1::uuid", lead))


async def test_aplicar_tag_reusa_a_tag_com_outra_caixa(conexao, passos):
    lead = await _lead(conexao)
    await conexao.execute("INSERT INTO tags (name) VALUES ('R5F-Cliente')")
    no = {"id": "n1", "type": "apply_tag",
          "config": {"tag_name": "r5f-cliente"}, "next": None}

    await executor.executar_no(conexao, _run(lead), no)

    assert await _tags_do_lead(conexao, lead) == ["R5F-Cliente"]
    assert await conexao.fetchval(
        "SELECT count(*) FROM tags WHERE lower(name) = 'r5f-cliente'") == 1


async def test_aplicar_tag_prefere_a_grafia_exata_quando_ha_duas(conexao, passos):
    lead = await _lead(conexao)
    await conexao.execute(
        "INSERT INTO tags (name) VALUES ('R5F-VIP'), ('r5f-vip')")
    no = {"id": "n1", "type": "apply_tag", "config": {"tag_name": "R5F-VIP"}, "next": None}

    await executor.executar_no(conexao, _run(lead), no)

    # O nó normaliza para minúsculas; havendo as duas, fica a exata.
    assert await _tags_do_lead(conexao, lead) == ["r5f-vip"]


async def test_aplicar_tag_ainda_cria_quando_nao_existe(conexao, passos):
    lead = await _lead(conexao)
    no = {"id": "n1", "type": "apply_tag",
          "config": {"tag_name": "/R5F-Nova-Tag "}, "next": None}

    await executor.executar_no(conexao, _run(lead), no)

    assert await _tags_do_lead(conexao, lead) == ["r5f-nova-tag"]


async def test_tag_do_slug_reusa_a_tag_com_outra_caixa(conexao):
    from app.routers.publico import _aplicar_tag_do_slug

    lead = await _lead(conexao)
    await conexao.execute("INSERT INTO tags (name) VALUES ('R5F-Webinar')")

    aplicada = await _aplicar_tag_do_slug(conexao, lead, "/r5f-webinar")

    assert aplicada == "r5f-webinar"
    assert await _tags_do_lead(conexao, lead) == ["R5F-Webinar"]
    assert await conexao.fetchval(
        "SELECT count(*) FROM tags WHERE lower(name) = 'r5f-webinar'") == 1
