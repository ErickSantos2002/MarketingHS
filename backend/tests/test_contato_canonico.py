"""O elo identidade→contato.

⚠️ Usa a fixture `conexao` do conftest, que reverte tudo. Estes testes escrevem
em `leads` e `ecosystem_identities`, as duas tabelas mais importantes do
sistema — nenhuma linha pode ficar para trás.

O que se prova aqui é a regra que faltava em 02/09: `dndash_lead_id` não é cópia
do vínculo, é QUAL dos contatos é o canônico da identidade. N contatos por
identidade é permitido de propósito (ver escrita_contatos.py:284).
"""

import pytest


async def _identidade(conexao, nome="Identidade de teste"):
    return await conexao.fetchval(
        "INSERT INTO ecosystem_identities (nome, stage) VALUES ($1, 'lead') "
        "RETURNING dnia_id", nome)


async def _lead(conexao, dnia_id, email):
    # ⚠️ `tipo` é NOT NULL sem default em `leads`. Omiti-lo derruba o teste com
    # NotNullViolationError, apontando para o lugar errado.
    return await conexao.fetchval(
        "INSERT INTO leads (nome, email, tipo, dnia_id) "
        "VALUES ('Teste 5C', $1, 'teste', $2) RETURNING id", email, dnia_id)


async def _canonico(conexao, dnia_id):
    return await conexao.fetchval(
        "SELECT dndash_lead_id FROM ecosystem_identities WHERE dnia_id = $1",
        dnia_id)


@pytest.mark.asyncio
async def test_contato_novo_vira_o_canonico(conexao):
    """O caso que o lote 5B errou 2.080 vezes."""
    ident = await _identidade(conexao)
    lead = await _lead(conexao, ident, "canonico-5c-1@exemplo.invalid")
    assert await _canonico(conexao, ident) == lead


@pytest.mark.asyncio
async def test_segundo_contato_nao_rouba_o_canonico(conexao):
    """A guarda `IS NULL`. Sem ela, o caso 3 do fundir_contatos
    (escrita_contatos.py:284) trocaria o canônico pelo recém-vinculado."""
    ident = await _identidade(conexao)
    primeiro = await _lead(conexao, ident, "canonico-5c-2a@exemplo.invalid")
    await _lead(conexao, ident, "canonico-5c-2b@exemplo.invalid")
    assert await _canonico(conexao, ident) == primeiro


@pytest.mark.asyncio
async def test_repontar_o_dnia_id_elege_na_identidade_destino(conexao):
    """É o que `merge_identities` faz: UPDATE leads SET dnia_id = p_keep."""
    origem = await _identidade(conexao, "origem")
    destino = await _identidade(conexao, "destino")
    lead = await _lead(conexao, origem, "canonico-5c-3@exemplo.invalid")
    assert await _canonico(conexao, destino) is None

    await conexao.execute("UPDATE leads SET dnia_id = $1 WHERE id = $2",
                          destino, lead)
    assert await _canonico(conexao, destino) == lead


@pytest.mark.asyncio
async def test_repontar_limpa_o_canonico_da_identidade_de_origem(conexao):
    """A origem não pode continuar apontando para um contato que já não é dela.

    Dentro de `merge_identities` isso não aparece, porque a identidade descartada
    é apagada logo depois. Mas um UPDATE manual em `leads.dnia_id` existe fora
    dela — e a ficha 360° da origem passaria a mostrar a pessoa errada.
    """
    origem = await _identidade(conexao, "origem")
    destino = await _identidade(conexao, "destino")
    lead = await _lead(conexao, origem, "canonico-5c-6@exemplo.invalid")
    assert await _canonico(conexao, origem) == lead

    await conexao.execute("UPDATE leads SET dnia_id = $1 WHERE id = $2",
                          destino, lead)
    assert await _canonico(conexao, origem) is None
    assert await _canonico(conexao, destino) == lead


@pytest.mark.asyncio
async def test_repontar_elege_o_que_sobrou_na_origem(conexao):
    """Se a origem ainda tem outro contato, ele assume — não fica nula."""
    origem = await _identidade(conexao, "origem")
    destino = await _identidade(conexao, "destino")
    primeiro = await _lead(conexao, origem, "canonico-5c-7a@exemplo.invalid")
    segundo = await _lead(conexao, origem, "canonico-5c-7b@exemplo.invalid")
    assert await _canonico(conexao, origem) == primeiro

    await conexao.execute("UPDATE leads SET dnia_id = $1 WHERE id = $2",
                          destino, primeiro)
    assert await _canonico(conexao, origem) == segundo
    assert await _canonico(conexao, destino) == primeiro


@pytest.mark.asyncio
async def test_apagar_o_canonico_elege_o_que_sobrou(conexao):
    """Sem este braço, o ON DELETE SET NULL reabre o buraco em silêncio."""
    ident = await _identidade(conexao)
    primeiro = await _lead(conexao, ident, "canonico-5c-4a@exemplo.invalid")
    segundo = await _lead(conexao, ident, "canonico-5c-4b@exemplo.invalid")
    assert await _canonico(conexao, ident) == primeiro

    await conexao.execute("DELETE FROM leads WHERE id = $1", primeiro)
    assert await _canonico(conexao, ident) == segundo


@pytest.mark.asyncio
async def test_apagar_o_unico_contato_deixa_nulo_sem_erro(conexao):
    """A FK é ON DELETE SET NULL. RESTRICT impediria apagar contato pela tela."""
    ident = await _identidade(conexao)
    lead = await _lead(conexao, ident, "canonico-5c-5@exemplo.invalid")
    await conexao.execute("DELETE FROM leads WHERE id = $1", lead)
    assert await _canonico(conexao, ident) is None


@pytest.mark.asyncio
async def test_fk_recusa_ponteiro_para_contato_inexistente(conexao):
    """Hoje não há FK nenhuma: apagar contato deixava ponteiro pendurado."""
    import asyncpg
    ident = await _identidade(conexao)
    with pytest.raises(asyncpg.ForeignKeyViolationError):
        await conexao.execute(
            "UPDATE ecosystem_identities SET dndash_lead_id = gen_random_uuid() "
            "WHERE dnia_id = $1", ident)
