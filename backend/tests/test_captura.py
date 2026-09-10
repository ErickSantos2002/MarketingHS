"""A captação pública — o que clicar não prova.

A validação de e-mail é ***fail-open*** por decisão: DNS instável ou fora do ar
NÃO pode recusar um lead real. Testar isso é o ponto do arquivo — é um caminho
que só aparece quando a rede falha, e ninguém percebe se ele inverter.

A captura em si é testada ponta a ponta porque o modo de falhar dela é gravar
lead sem pontuação, sem identidade ou sem conversão — tudo silencioso.
"""

import json
import re

import pytest
import pytest_asyncio

from app import database as db
from app.captura import email as vemail

# ⚠️ SEM `pytestmark = pytest.mark.asyncio` neste arquivo, ao contrário do
# `test_conversao.py`. O `pytest.ini` tem `asyncio_mode = auto`, que já marca as
# funções `async def` sozinho — e aqui há testes SÍNCRONOS misturados
# (`test_formato_recusa_o_obvio`, e os três da Task 2). O marcador de módulo
# alcançaria também os síncronos, e o pytest-asyncio recusa marcar função que
# não é corrotina.


def test_formato_recusa_o_obvio():
    assert vemail.formato_ok("erick@healthsafety.com.br")
    assert not vemail.formato_ok("sem-arroba")
    assert not vemail.formato_ok("dois@@arrobas.com")
    assert not vemail.formato_ok("sem@tld")
    assert not vemail.formato_ok("")


async def test_descartavel_conhecido_e_recusado():
    vemail._limpar_cache()
    valido, motivo = await vemail.validar_dominio("alguem@mailinator.com")
    assert valido is False
    assert motivo


async def test_dns_fora_do_ar_deixa_passar(monkeypatch):
    """⚠️ O teste mais importante do arquivo. Se ele inverter, uma instabilidade
    de DNS passa a recusar lead de verdade — e ninguém descobre, porque o
    formulário só diz 'e-mail inválido' e a pessoa vai embora."""
    vemail._limpar_cache()

    async def explodir(_dominio):
        raise OSError("resolver indisponível")

    monkeypatch.setattr(vemail, "_tem_mx", explodir)
    valido, motivo = await vemail.validar_dominio("alguem@empresa-real.com.br")
    assert valido is True
    assert motivo is None


async def test_dominio_sem_mx_e_recusado(monkeypatch):
    vemail._limpar_cache()

    async def sem_mx(_dominio):
        return False

    monkeypatch.setattr(vemail, "_tem_mx", sem_mx)
    valido, motivo = await vemail.validar_dominio("alguem@dominio-inexistente.tld")
    assert valido is False
    assert motivo


async def test_o_cache_evita_a_segunda_consulta(monkeypatch):
    vemail._limpar_cache()
    chamadas = []

    async def contar(dominio):
        chamadas.append(dominio)
        return True

    monkeypatch.setattr(vemail, "_tem_mx", contar)
    await vemail.validar_dominio("a@empresa.com.br")
    await vemail.validar_dominio("b@empresa.com.br")
    assert chamadas == ["empresa.com.br"], "o domínio deveria ser consultado uma vez"


from app.captura import campos as vcampos


def test_higienizar_descarta_campo_fora_da_lista():
    saida = vcampos.higienizar({"nome": "Carla", "lead_score": 999, "etiqueta": "hotlead"})
    assert saida == {"nome": "Carla"}, "score e etiqueta são do gatilho, não do formulário"


def test_higienizar_apara_e_descarta_vazio():
    saida = vcampos.higienizar({"nome": "  Carla  ", "cargo": "", "empresa": None})
    assert saida == {"nome": "Carla"}


def test_higienizar_corta_texto_gigante():
    saida = vcampos.higienizar({"desafios": "x" * 5000})
    assert len(saida["desafios"]) == 2000


def test_higienizar_aceita_numero_e_booleano():
    saida = vcampos.higienizar({"funcionarios": "500", "interesse_formacao": True})
    assert saida["funcionarios"] == "500"
    assert saida["interesse_formacao"] is True


EMAIL_SONDA = "sonda-captura@exemplo.invalid"
SLUG_SONDA = "sonda-captura"


@pytest_asyncio.fixture
async def pagina_sonda(monkeypatch):
    """Uma página real para a captura ter slug, apagada no fim.

    ⚠️ Limpa ANTES de inserir, como a fixture `envio`: esta fixture COMMITA e
    só desfaz no teardown; se o pytest morrer no meio, a linha fica e o
    `pages_slug_key` derruba a rodada seguinte no setup.

    ⚠️ **Divergência achada rodando, não prevista no brief.** `EMAIL_SONDA`
    usa o domínio `exemplo.invalid` — reservado pela RFC 2606, garantidamente
    sem MX nem A de verdade. `validar_dominio` (Tarefa 2) faz consulta DNS de
    verdade, então sem este monkeypatch a captura recusa TODO lead de sonda
    com 400 antes de chegar perto do banco — os quatro testes que dependem
    desta fixture falhavam nisso, não no que pretendiam medir. Segue o mesmo
    padrão dos testes de `validar_dominio` acima (`monkeypatch.setattr(vemail,
    "_tem_mx", ...)`); a recusa de `mailinator.com` continua íntegra porque a
    lista de descartáveis é checada ANTES da consulta de MX.

    ⚠️ **Segunda divergência, achada na Tarefa 4.** `landing.py` (a casca de
    `GET /p/{slug}`) tem cache de processo por slug (TTL de 60s) — e o slug
    aqui é sempre o mesmo, `SLUG_SONDA`. Sem limpar esse cache também, um
    teste da casca que rode dentro da mesma janela de 60s que outro herda a
    config ou o status QUE JÁ FOI APAGADO, porque a chave do cache não sabe
    que a linha por trás foi recriada. `test_casca_404_para_rascunho` pegou
    isso na prática: rodando depois de outro teste da casca, via um 200 em
    vez do 404 esperado, porque o cache ainda tinha a config `active` de
    antes. Mesmo padrão do cache de DNS acima — limpa nos dois lados.
    """
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

    async def limpar():
        async with db.sessao(role="service_role") as conn:
            await conn.execute(
                "DELETE FROM lead_conversions WHERE lead_id IN "
                "(SELECT id FROM leads WHERE email = $1)", EMAIL_SONDA)
            await conn.execute("DELETE FROM leads WHERE email = $1", EMAIL_SONDA)
            await conn.execute("DELETE FROM pages WHERE slug = $1", SLUG_SONDA)
            await conn.execute("DELETE FROM tags WHERE name = $1", SLUG_SONDA)

    await limpar()
    async with db.sessao(role="service_role") as conn:
        await conn.execute(
            """INSERT INTO pages (name, slug, component_name, page_type, status, config)
               VALUES ('Sonda da captura', $1, 'SondaCaptura', 'landing', 'active', $2)""",
            SLUG_SONDA, {"redirect_url": "https://exemplo.invalid/obrigado"})
    yield SLUG_SONDA
    await limpar()
    # ⚠️ Limpa o cache de DNS nos DOIS lados, não só no setup. O monkeypatch
    # do resolvedor é revertido pelo pytest no teardown, mas a ENTRADA que
    # ele produziu (`exemplo.invalid -> (True, None, expira em 1h)`) fica no
    # dict de módulo `vemail._cache` — que não sabe que o resolvedor era
    # falso. Sem isto, o próximo teste do processo que consultar
    # `exemplo.invalid` sem monkeypatch (fora deste arquivo, por exemplo)
    # herdaria um "válido" fabricado por até uma hora.
    vemail._limpar_cache()
    vlanding._limpar_cache()
    # ⚠️ NÃO chame `db.close_db()` aqui. A fixture `cliente` já fecha o pool no
    # teardown dela, e a `envio` — o padrão desta casa para fixture que commita
    # — deliberadamente não fecha. Fechar nas duas faz o teardown fechar um pool
    # já fechado quando a função usa as duas ao mesmo tempo, que é exatamente o
    # caso de todos os testes desta tarefa.


async def test_captura_cria_lead_pontuado_com_conversao_e_tag(cliente, pagina_sonda):
    """O caminho inteiro numa chamada — é o que a landing faz.

    O modo de falhar é silencioso em cada etapa: lead sem score (o gatilho não
    viu campo que pontua), sem identidade (a visão 360° vem vazia), sem
    conversão (o painel não conta o lead) ou sem tag (o segmento não o pega).
    """
    resposta = await cliente.post("/publico/captura", json={
        "email": EMAIL_SONDA,
        "page_slug": pagina_sonda,
        "fields": {"nome": "Carla Sonda", "cargo": "Gerente de SESMT",
                   "empresa": "Transportes Exemplo", "whatsapp": "85999991234"},
    })
    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["ok"] is True
    assert corpo["redirect_url"] == "https://exemplo.invalid/obrigado"

    async with db.sessao(role="service_role") as conn:
        lead = await conn.fetchrow(
            "SELECT id, nome, lead_score, etiqueta, dnia_id FROM leads WHERE email = $1",
            EMAIL_SONDA)
        assert lead is not None, "a captura não gravou o contato"
        assert lead["nome"] == "Carla Sonda"
        assert lead["lead_score"] > 0, "o gatilho de pontuação não viu campo que pontua"
        assert lead["dnia_id"] is not None, "a identidade não foi resolvida"

        conversoes = await conn.fetchval(
            "SELECT count(*) FROM lead_conversions WHERE lead_id = $1", lead["id"])
        assert conversoes == 1, "a conversão não foi registrada"

        tags = await conn.fetchval(
            "SELECT count(*) FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id "
            "WHERE lt.lead_id = $1 AND t.name = $2", lead["id"], pagina_sonda)
        assert tags == 1, "a tag do slug não foi aplicada"


async def test_captura_nao_devolve_dado_pessoal(cliente, pagina_sonda):
    """⚠️ A rota é ANÔNIMA. Se ela devolver o lead, qualquer pessoa extrai nome,
    telefone e empresa da base mandando e-mails, um por vez."""
    await cliente.post("/publico/captura", json={
        "email": EMAIL_SONDA, "page_slug": pagina_sonda,
        "fields": {"nome": "Carla Sonda", "whatsapp": "85999991234"}})
    resposta = await cliente.post("/publico/captura", json={
        "email": EMAIL_SONDA, "page_slug": pagina_sonda, "fields": {}})
    corpo = resposta.json()
    assert set(corpo.keys()) <= {"ok", "redirect_url"}
    texto = resposta.text.lower()
    assert "carla" not in texto and "85999991234" not in texto


async def test_captura_recusa_descartavel(cliente, pagina_sonda):
    resposta = await cliente.post("/publico/captura", json={
        "email": "alguem@mailinator.com", "page_slug": pagina_sonda, "fields": {}})
    assert resposta.status_code == 400


async def test_captura_reativa_contato_excluido(cliente, pagina_sonda):
    await cliente.post("/publico/captura", json={
        "email": EMAIL_SONDA, "page_slug": pagina_sonda, "fields": {"nome": "Carla"}})
    async with db.sessao(role="service_role") as conn:
        # ⚠️ `deleted_by` é `uuid` na tabela `leads`, não `text` — o brief
        # original usava o literal 'teste', que a coluna recusa com
        # `invalid input syntax for type uuid: "teste"` antes mesmo de chegar
        # à rota (medido em 08/09/2026, rodando o UPDATE isolado). Um uuid de
        # verdade prova a mesma coisa sem depender do valor.
        await conn.execute(
            "UPDATE leads SET deleted_at = now(), deleted_by = gen_random_uuid() "
            "WHERE email = $1",
            EMAIL_SONDA)

    await cliente.post("/publico/captura", json={
        "email": EMAIL_SONDA, "page_slug": pagina_sonda, "fields": {"nome": "Carla"}})

    async with db.sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            "SELECT id, deleted_at, dnia_id FROM leads WHERE email = $1", EMAIL_SONDA)
        assert linha["deleted_at"] is None, "reconverter deveria reativar o contato"
        eventos = await conn.fetch(
            "SELECT dnia_id FROM contact_events "
            "WHERE lead_id = $1 AND event_type = 'contact_reactivated'", linha["id"])
        assert len(eventos) == 1, "a reativação precisa deixar rastro"
        # ⚠️ A origem gravava `dnia_id` no evento, e a primeira versão desta
        # rota deixou de gravar — corte silencioso achado no portão. Sem ele o
        # evento some do cruzamento por `idx_contact_events_universal_id` e do
        # merge de identidade (`UPDATE contact_events SET dnia_id = p_keep`).
        assert linha["dnia_id"] is not None, "a primeira captura não resolveu identidade"
        assert eventos[0]["dnia_id"] == linha["dnia_id"], \
            "o evento de reativação precisa carregar o dnia_id do contato"


async def test_captura_email_longo_demais_da_400(cliente, pagina_sonda):
    """A origem tinha UM caminho de erro para e-mail: 400. O `max_length` do
    Pydantic respondia 422 com `detail` em lista — outro contrato."""
    longo = "a" * 320 + "@exemplo.invalid"
    resposta = await cliente.post("/publico/captura", json={
        "email": longo, "page_slug": pagina_sonda, "fields": {}})
    assert resposta.status_code == 400


async def test_captura_descarta_session_id_longo_demais(cliente, pagina_sonda):
    """A origem fazia `sessionId.length <= 100 ? sessionId : null`: o campo
    ruim some e a captura segue. Recusar a requisição inteira perderia o lead
    por causa de um campo de rastreio."""
    resposta = await cliente.post("/publico/captura", json={
        "email": EMAIL_SONDA, "page_slug": pagina_sonda,
        "session_id": "s" * 101, "fields": {"nome": "Carla"}})
    assert resposta.status_code == 200

    async with db.sessao(role="service_role") as conn:
        sessao_gravada = await conn.fetchval(
            "SELECT session_id FROM leads WHERE email = $1", EMAIL_SONDA)
        assert sessao_gravada is None


async def test_captura_sobrevive_a_falha_real_na_identidade(cliente, pagina_sonda,
                                                              monkeypatch):
    """⚠️ Rodada 1 de correção — o Crítico. `sessao()` entrega a conexão já
    dentro de uma transação; `capturar()` inteiro é uma transação só. Um
    `except Exception` comum ao redor de `resolve_or_create_identity` NÃO
    basta: quando o erro é DE BANCO, o Postgres aborta o bloco de transação
    inteiro, e a instrução seguinte (o INSERT em `lead_conversions`) morre com
    `InFailedSQLTransactionError` sem tratamento — 500, lead real recusado.

    Para provar isso de verdade — não só que uma exceção Python foi engolida
    — este teste força um erro REAL de Postgres dentro da transação: troca o
    SQL de `_resolver_identidade` por uma chamada a uma function que não
    existe (`UndefinedFunctionError`), o mesmo jeito de a transação abortar
    que uma violação de `ecosystem_identities_phone_key` produziria. Se o
    SAVEPOINT aninhado de `_resolver_identidade` estiver certo, a captura
    continua 200 e a conversão e a tag sobrevivem; se não estiver, a rota
    devolve 500 e este teste falha exatamente como falhava antes da correção.
    """
    import app.routers.captura as captura_router

    monkeypatch.setattr(
        captura_router, "_SQL_RESOLVE_IDENTIDADE",
        "SELECT resolve_or_create_identity_que_nao_existe($1, $2, $3, $4, $5::uuid, $6, $7)")

    resposta = await cliente.post("/publico/captura", json={
        "email": EMAIL_SONDA, "page_slug": pagina_sonda,
        "fields": {"nome": "Carla Sonda"}})
    assert resposta.status_code == 200, \
        "a falha de identidade não pode virar 500 — a transação tem que sobreviver"
    corpo = resposta.json()
    assert corpo["ok"] is True

    async with db.sessao(role="service_role") as conn:
        lead = await conn.fetchrow(
            "SELECT id, dnia_id FROM leads WHERE email = $1", EMAIL_SONDA)
        assert lead is not None, "a captura não gravou o contato"
        assert lead["dnia_id"] is None, \
            "identidade deveria ter falhado e ficado vazia, não travar a captura"

        conversoes = await conn.fetchval(
            "SELECT count(*) FROM lead_conversions WHERE lead_id = $1", lead["id"])
        assert conversoes == 1, \
            "a conversão precisa sobreviver à falha de identidade (SAVEPOINT)"

        tags = await conn.fetchval(
            "SELECT count(*) FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id "
            "WHERE lt.lead_id = $1 AND t.name = $2", lead["id"], pagina_sonda)
        assert tags == 1, "a tag precisa sobreviver à falha de identidade (SAVEPOINT)"


async def test_casca_traz_as_meta_tags_da_config(cliente, pagina_sonda):
    async with db.sessao(role="service_role") as conn:
        await conn.execute(
            "UPDATE pages SET config = $2 WHERE slug = $1", pagina_sonda,
            {"meta_title": "Bafômetro conectado", "headline": "Registre e prove",
             "meta_description": "Teste de alcoolemia com registro auditável"})

    resposta = await cliente.get(f"/p/{pagina_sonda}")
    assert resposta.status_code == 200
    assert "text/html" in resposta.headers["content-type"]
    corpo = resposta.text
    assert "<title>Bafômetro conectado</title>" in corpo
    assert 'property="og:title" content="Bafômetro conectado"' in corpo
    assert ('name="description" content="Teste de alcoolemia com registro '
            'auditável"' in corpo), \
        "essa string também está no JSON embutido — o teste tem que provar " \
        "a TAG, não só a presença da string em algum lugar do corpo"


async def test_casca_prefere_config_mas_cai_na_coluna_de_seo(cliente, pagina_sonda):
    """`pages` tem duas superfícies de edição pro mesmo SEO: o diálogo de
    página grava nas COLUNAS `meta_title`/`meta_description`; o editor de
    config do construtor grava as mesmas chaves dentro de `config`. Esta
    sonda grava só nas colunas — é o caminho do diálogo, o mais usado — e
    prova que a casca não depende de `config` estar preenchida.
    """
    async with db.sessao(role="service_role") as conn:
        await conn.execute(
            "UPDATE pages SET config = $2, meta_title = $3, meta_description = $4 "
            "WHERE slug = $1", pagina_sonda, {},
            "Bafômetro pela coluna", "Descrição pela coluna")

    corpo = (await cliente.get(f"/p/{pagina_sonda}")).text
    assert "<title>Bafômetro pela coluna</title>" in corpo
    assert 'property="og:title" content="Bafômetro pela coluna"' in corpo
    assert 'name="description" content="Descrição pela coluna"' in corpo


async def test_casca_escapa_conteudo_do_admin(cliente, pagina_sonda):
    """⚠️ A config é campo EDITÁVEL na tela indo para dentro de HTML.

    O `</script>` é o caso que mais morde: ele fecha o bloco JSON embutido e o
    resto vira marcação executável na página. A propriedade a provar é essa —
    o bloco não pode ceder o estado "script data" do tokenizador HTML — não a
    ausência de qualquer fragmento de aparência suspeita: dentro do bloco,
    sem `<`, nada ali forma tag nem atributo, então é texto inerte.
    """
    async with db.sessao(role="service_role") as conn:
        await conn.execute(
            "UPDATE pages SET config = $2 WHERE slug = $1", pagina_sonda,
            {"meta_title": '"><script>alert(1)</script>',
             "headline": "</script><img src=x onerror=alert(1)>"})

    corpo = (await cliente.get(f"/p/{pagina_sonda}")).text
    assert "<script>alert(1)</script>" not in corpo
    assert "</script><img" not in corpo

    # ⚠️ `</script` legítimo aparece DUAS vezes na página de verdade — o
    # fechamento do próprio bloco de config e o de `main.js` — então checar
    # "</script" contra o corpo inteiro dá falso positivo. A propriedade real
    # é sobre o CONTEÚDO do bloco JSON: sem `<` sobrando ali dentro, nada
    # forma `</script` nenhum, legítimo ou não.
    bloco = re.search(r'id="config-da-pagina">(.*?)</script>', corpo, re.S).group(1)
    assert "<" not in bloco


async def test_casca_embute_a_config_como_json(cliente, pagina_sonda):
    """Não basta ter `id`/`type` de bloco JSON — o CONTEÚDO precisa
    continuar sendo o JSON de verdade depois do escape, round-trip incluído,
    porque `_json_seguro` mexe na string serializada com `replace` cegos e
    este é o único teste que cobre isso.
    """
    async with db.sessao(role="service_role") as conn:
        await conn.execute(
            "UPDATE pages SET config = $2 WHERE slug = $1", pagina_sonda,
            {"headline": "</script><img src=x onerror=alert(1)>"})

    corpo = (await cliente.get(f"/p/{pagina_sonda}")).text
    assert 'id="config-da-pagina"' in corpo
    assert 'type="application/json"' in corpo

    bloco = re.search(r'id="config-da-pagina">(.*?)</script>', corpo, re.S).group(1)
    assert json.loads(bloco)["headline"] == "</script><img src=x onerror=alert(1)>"


async def test_casca_404_para_pagina_inexistente(cliente):
    assert (await cliente.get("/p/nao-existe-mesmo")).status_code == 404


async def test_casca_404_para_rascunho(cliente, pagina_sonda):
    """Página em rascunho não está no ar — servir seria publicar o que ninguém
    publicou."""
    async with db.sessao(role="service_role") as conn:
        await conn.execute("UPDATE pages SET status = 'draft' WHERE slug = $1",
                           pagina_sonda)
    assert (await cliente.get(f"/p/{pagina_sonda}")).status_code == 404
