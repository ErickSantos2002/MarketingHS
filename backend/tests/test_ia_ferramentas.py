"""As ferramentas do analista de IA.

⚠️ O ponto destes testes não é que os números estejam certos — é que o MODELO
não alcance o que não deve. A função que estas ferramentas substituem executava
SQL escrito pelo modelo como superusuário (ver migration 016).

Usa a fixture `conexao`, que reverte tudo.
"""

import datetime as dt

import pytest

from app.ia import ferramentas


async def _lead(conexao, **kw):
    """⚠️ O MARCADOR DOS TESTES É `tipo`, NÃO `etiqueta`.

    `leads` tem um gatilho BEFORE INSERT, `trg_score_lead_on_change`, cuja
    função faz `NEW.etiqueta := v_etiqueta` — ela RECALCULA a etiqueta a partir
    de cargo/faturamento/funcionários e sobrescreve o que você mandou. Usar
    `etiqueta` como marcador de teste faz a linha nascer com NULL ali e o teste
    falhar apontando para a ferramenta, que está certa.

    `tipo` é NOT NULL, texto livre, e o gatilho não encosta nele.
    """
    base = dict(nome="Teste 6", email=None, tipo="teste-6",
                cargo=None, utm_source=None, created_at=None)
    base.update(kw)
    # ⚠️ O parâmetro casa com `$6::timestamptz` — o Postgres descreve $6 como
    # timestamptz na extended query protocol, e o codec do asyncpg só aceita
    # `datetime.date`/`datetime.datetime`, nunca `str`, para esse tipo. Isto é
    # comportamento do protocolo, não do design das ferramentas.
    if isinstance(base["created_at"], str):
        base["created_at"] = dt.date.fromisoformat(base["created_at"])
    return await conexao.fetchval(
        """INSERT INTO leads (nome, email, tipo, cargo, utm_source, created_at)
           VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now()))
           RETURNING id""",
        base["nome"], base["email"], base["tipo"], base["cargo"],
        base["utm_source"], base["created_at"])


# ── A allowlist ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_dimensao_fora_da_allowlist_e_recusada(conexao):
    """Se o nome da dimensão virasse SQL, isto leria qualquer coluna."""
    with pytest.raises(ferramentas.ArgumentoRecusado, match="dimensão"):
        await ferramentas.executar(
            conexao, "distribuir_contatos", {"dimensao": "email"})


@pytest.mark.asyncio
async def test_dimensao_com_injecao_e_recusada(conexao):
    with pytest.raises(ferramentas.ArgumentoRecusado):
        await ferramentas.executar(
            conexao, "distribuir_contatos",
            {"dimensao": "etiqueta) UNION SELECT value FROM integration_secrets --"})


@pytest.mark.asyncio
async def test_valor_de_filtro_com_injecao_e_tratado_como_literal(conexao):
    """O nome do filtro é allowlist; o VALOR nunca foi testado indo direto
    para `$n` como parâmetro em vez de string concatenada.

    `{"tipo": "x' OR 1=1 --"}` é o valor, não o nome do campo — se ele fosse
    interpolado na query em vez de ir como parâmetro do asyncpg, a cláusula
    `OR 1=1` derrubaria o `WHERE` e `contar_contatos` devolveria a base
    inteira (ou o SQL quebraria na sintaxe). Parametrizado, é só um texto que
    não bate com nenhum `tipo` gravado: `total == 0`, sem levantar.

    ⚠️ A fixture `conexao` faz `SET LOCAL ROLE service_role` (BYPASSRLS) —
    este teste prova que a MONTAGEM DA QUERY parametriza o valor, não que o
    RLS bloquearia o payload. Não leia isto como prova de RLS.
    """
    r = await ferramentas.executar(
        conexao, "contar_contatos", {"filtros": {"tipo": "x' OR 1=1 --"}})
    assert r["total"] == 0


@pytest.mark.asyncio
async def test_filtro_fora_da_allowlist_e_recusado(conexao):
    with pytest.raises(ferramentas.ArgumentoRecusado, match="filtro"):
        await ferramentas.executar(
            conexao, "contar_contatos", {"filtros": {"deleted_by": "x"}})


@pytest.mark.asyncio
async def test_ferramenta_desconhecida_e_recusada(conexao):
    with pytest.raises(ferramentas.FerramentaDesconhecida):
        await ferramentas.executar(conexao, "executar_sql", {"q": "select 1"})


# ── O limite ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_listar_contatos_respeita_o_teto(conexao):
    """Sem teto, uma pergunta inocente joga a base inteira no contexto do
    modelo — e no histórico do chat, que fica gravado."""
    for i in range(5):
        await _lead(conexao, nome=f"Teto {i}", tipo="teto-6")
    r = await ferramentas.executar(
        conexao, "listar_contatos",
        {"filtros": {"tipo": "teto-6"}, "limite": 999})
    assert len(r["contatos"]) <= ferramentas.LIMITE_MAXIMO
    assert r["limite_aplicado"] == ferramentas.LIMITE_MAXIMO
    # ⚠️ Prova que o LIMIT do SQL sai do argumento, e não só do relatado: com 5
    # contatos e limite=2 têm de voltar 2. Sem isto, uma implementação que
    # relatasse o teto e mandasse `LIMIT 999` ao banco passaria no teste.
    r2 = await ferramentas.executar(
        conexao, "listar_contatos",
        {"filtros": {"tipo": "teto-6"}, "limite": 2})
    assert len(r2["contatos"]) == 2


@pytest.mark.asyncio
async def test_listar_contatos_nao_devolve_dado_sensivel(conexao):
    """A amostra é para o modelo raciocinar, não para exportar a base."""
    await _lead(conexao, nome="Sensível", email="sensivel-6@exemplo.invalid",
                tipo="sens-6")
    r = await ferramentas.executar(
        conexao, "listar_contatos", {"filtros": {"tipo": "sens-6"}})
    assert r["contatos"], "o contato de teste não voltou"
    for c in r["contatos"]:
        # O que NÃO vai: identifica uma pessoa e ficaria gravado no histórico.
        assert "nome" not in c
        assert "email" not in c
        assert "whatsapp" not in c
        assert "phone_normalized" not in c
        # O que VAI, de propósito: `empresa` é a unidade de análise em B2B e
        # não há dimensão `empresa` para agrupar. Decisão registrada aqui para
        # não ser desfeita por engano.
        assert "empresa" in c
        assert "cargo" in c


# ── Os números ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_contar_contatos_bate_com_o_sql(conexao):
    """O critério de pronto da spec: os números batem com conferência manual."""
    for i in range(3):
        await _lead(conexao, tipo="conta-6")
    esperado = await conexao.fetchval(
        "SELECT count(*) FROM leads WHERE tipo = 'conta-6' AND deleted_at IS NULL")
    r = await ferramentas.executar(
        conexao, "contar_contatos", {"filtros": {"tipo": "conta-6"}})
    assert r["total"] == esperado == 3


@pytest.mark.asyncio
async def test_contagem_ignora_contato_excluido(conexao):
    """O soft delete do lote 1C. Contar excluído infla todo painel."""
    await _lead(conexao, tipo="morto-6")
    morto = await _lead(conexao, tipo="morto-6")
    await conexao.execute("UPDATE leads SET deleted_at = now() WHERE id = $1", morto)
    r = await ferramentas.executar(
        conexao, "contar_contatos", {"filtros": {"tipo": "morto-6"}})
    assert r["total"] == 1


@pytest.mark.asyncio
async def test_distribuir_contatos_agrupa_certo(conexao):
    await _lead(conexao, tipo="dist-6", cargo="Gerente")
    await _lead(conexao, tipo="dist-6", cargo="Gerente")
    await _lead(conexao, tipo="dist-6", cargo="Analista")
    r = await ferramentas.executar(
        conexao, "distribuir_contatos",
        {"dimensao": "cargo", "filtros": {"tipo": "dist-6"}})
    linhas = {l["valor"]: l["total"] for l in r["distribuicao"]}
    assert linhas["Gerente"] == 2
    assert linhas["Analista"] == 1


@pytest.mark.asyncio
async def test_filtro_de_periodo_recorta(conexao):
    await _lead(conexao, tipo="per-6", created_at="2020-01-15")
    await _lead(conexao, tipo="per-6")
    r = await ferramentas.executar(
        conexao, "contar_contatos",
        {"filtros": {"tipo": "per-6", "desde": "2020-01-01", "ate": "2020-01-31"}})
    assert r["total"] == 1


@pytest.mark.asyncio
async def test_data_invalida_e_recusada_e_nao_vira_sql(conexao):
    with pytest.raises(ferramentas.ArgumentoRecusado, match="data"):
        await ferramentas.executar(
            conexao, "contar_contatos", {"filtros": {"desde": "ontem'; DROP"}})


# ── Os esquemas ──────────────────────────────────────────────────────────────

def test_todo_esquema_e_estrito_e_fechado():
    """`strict` + `additionalProperties: false` é o que garante que o argumento
    que chega é o argumento que o schema descreve."""
    assert ferramentas.ESQUEMAS, "nenhuma ferramenta declarada"
    for e in ferramentas.ESQUEMAS:
        assert e["strict"] is True, e["name"]
        assert e["input_schema"]["additionalProperties"] is False, e["name"]
        assert e["description"].strip(), e["name"]


def test_todo_esquema_tem_executor():
    for e in ferramentas.ESQUEMAS:
        assert e["name"] in ferramentas.EXECUTORES, e["name"]
    # E o sentido inverso: executor sem esquema é ferramenta invisível para a
    # API — o modelo nunca saberia que ela existe, mas `executar` a chamaria.
    assert set(ferramentas.EXECUTORES) == {e["name"] for e in ferramentas.ESQUEMAS}


# ── A revisão ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_distribuir_contatos_nao_infla_percentual(conexao):
    """O denominador tem de ser o total real, não a soma do que voltou —
    poucos grupos aqui, todos abaixo de LIMITE_DE_GRUPOS, então nada é
    truncado e total_geral bate exatamente com a soma das linhas."""
    await _lead(conexao, tipo="pct-6", cargo="Gerente")
    await _lead(conexao, tipo="pct-6", cargo="Gerente")
    await _lead(conexao, tipo="pct-6", cargo="Analista")
    r = await ferramentas.executar(
        conexao, "distribuir_contatos",
        {"dimensao": "cargo", "filtros": {"tipo": "pct-6"}})
    assert r["total_geral"] == 3
    assert r["truncado"] is False
    assert r["nao_mostrados"] == 0
    assert sum(l["total"] for l in r["distribuicao"]) == r["total_geral"]
    linhas = {l["valor"]: l["percentual"] for l in r["distribuicao"]}
    assert linhas["Gerente"] == pytest.approx(66.7, abs=0.1)


@pytest.mark.asyncio
async def test_argumento_desconhecido_e_recusado(conexao):
    """`executar` tem de fechar o contrato que promete — nome/argumento fora
    do que a ferramenta aceita vira ArgumentoRecusado, não TypeError cru."""
    with pytest.raises(ferramentas.ArgumentoRecusado):
        await ferramentas.executar(
            conexao, "contar_contatos", {"bobagem": 1})
