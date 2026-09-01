"""O motor de fila. É o único lugar do projeto que nasce com teste automatizado.

A spec é explícita sobre o porquê: "reimplementar visibility timeout,
retentativa e fila-morta é onde mora bug de sistema de envio". Um e-mail
enviado duas vezes para a base inteira queima o domínio.
"""

import pytest

from app import fila

pytestmark = pytest.mark.asyncio


async def test_reivindicar_esconde_a_mensagem_dos_outros(conexao, semear):
    """Duas reivindicações seguidas não podem devolver a mesma mensagem.

    É o visibility timeout: quem reivindica empurra `visivel_em` para frente na
    MESMA instrução do SELECT. Sem isso dois workers enviariam o mesmo e-mail —
    o índice único de campaign_sends barraria o segundo, mas o trabalho seria
    feito duas vezes e o erro ficaria invisível.
    """
    await semear(quantidade=1)
    primeira = await fila.reivindicar(conexao, limite=10, visibilidade=120)
    segunda = await fila.reivindicar(conexao, limite=10, visibilidade=120)
    assert len(primeira) == 1
    assert segunda == []


async def test_mensagem_devolvida_volta_a_ficar_visivel(conexao, semear):
    """Devolver com tentativas abaixo do teto reagenda em vez de matar."""
    await semear(quantidade=1)
    [m] = await fila.reivindicar(conexao, limite=10, visibilidade=120)
    destino = await fila.devolver(conexao, m.fila_id, "erro de rede",
                                  max_tentativas=5)
    assert destino == "reagendada"
    # `visivel_em` no futuro: ainda não pode ser reivindicada de novo
    assert await fila.reivindicar(conexao, limite=10, visibilidade=120) == []


async def test_estourar_o_teto_manda_para_a_fila_morta(conexao, semear):
    """A mensagem sai da fila viva, mas NÃO some do mundo.

    Apagar direto esconderia justamente o caso que precisa ser investigado.
    """
    await semear(quantidade=1)
    destino = None
    for _ in range(5):
        [m] = await fila.reivindicar(conexao, limite=10, visibilidade=0)
        destino = await fila.devolver(conexao, m.fila_id, "sempre falha",
                                      max_tentativas=5)
        # ⚠️ `devolver` empurra `visivel_em` para frente com recuo progressivo.
        # Sem trazer a mensagem de volta ao presente, a segunda volta do laço
        # não reivindicaria nada e o teste passaria por engano, sem nunca chegar
        # ao teto. O recuo tem teste próprio abaixo; aqui se mede o limite.
        await conexao.execute(
            "UPDATE email_send_queue SET visivel_em = now() WHERE id = $1", m.fila_id)
    assert destino == "morta"
    assert await conexao.fetchval("SELECT count(*) FROM email_send_queue") == 0
    assert await conexao.fetchval("SELECT count(*) FROM email_send_dead") == 1


async def test_o_recuo_cresce_a_cada_tentativa(conexao, semear):
    """Um erro de rede que dura dois minutos não pode consumir as cinco
    tentativas em dez segundos. O recuo é 1min, 2min, 4min..."""
    await semear(quantidade=1)
    esperas = []
    for _ in range(3):
        [m] = await fila.reivindicar(conexao, limite=10, visibilidade=0)
        await fila.devolver(conexao, m.fila_id, "erro", max_tentativas=99)
        esperas.append(await conexao.fetchval(
            "SELECT visivel_em - now() FROM email_send_queue WHERE id = $1",
            m.fila_id))
        await conexao.execute(
            "UPDATE email_send_queue SET visivel_em = now() WHERE id = $1", m.fila_id)
    assert esperas[0] < esperas[1] < esperas[2]


async def test_publicar_o_mesmo_envio_duas_vezes_nao_duplica(conexao, semear):
    """A republicação de órfão é um caminho de recuperação, e tem de ser segura.

    O enfileirador republica mensagens de uma execução que morreu no meio. Sem
    a restrição única em send_id, a segunda publicação criaria uma mensagem
    irmã e o worker faria o trabalho duas vezes.
    """
    mensagens = await semear(quantidade=1)
    n = await fila.publicar(conexao, [mensagens[0]])
    assert n == 0
    assert await conexao.fetchval("SELECT count(*) FROM email_send_queue") == 1


async def test_concluir_tira_a_mensagem_da_fila(conexao, semear):
    """Concluir só acontece depois do envio confirmado."""
    await semear(quantidade=1)
    [m] = await fila.reivindicar(conexao, limite=10, visibilidade=120)
    await fila.concluir(conexao, m.fila_id)
    assert await conexao.fetchval("SELECT count(*) FROM email_send_queue") == 0
