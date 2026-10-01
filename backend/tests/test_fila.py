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
    [msg] = await semear(quantidade=1)
    primeira = await fila.reivindicar(conexao, limite=50, visibilidade=120)
    segunda = await fila.reivindicar(conexao, limite=50, visibilidade=120)
    # ⚠️ Filtrado pelo send_id semeado, não pela contagem do lote. `reivindicar`
    # pega da fila inteira, e afirmar `len == 1` faria o teste depender do banco
    # estar vazio — quebrando por dado alheio e apontando para o lugar errado.
    meus = [m for m in primeira if m.send_id == msg["send_id"]]
    assert len(meus) == 1
    assert all(m.send_id != msg["send_id"] for m in segunda)


async def test_mensagem_devolvida_volta_a_ficar_visivel(conexao, semear):
    """Devolver com tentativas abaixo do teto reagenda em vez de matar."""
    [msg] = await semear(quantidade=1)
    [m] = [x for x in await fila.reivindicar(conexao, limite=50, visibilidade=120)
           if x.send_id == msg["send_id"]]
    destino = await fila.devolver(conexao, m.fila_id, "erro de rede",
                                  max_tentativas=5)
    assert destino == "reagendada"
    # `visivel_em` no futuro: ainda não pode ser reivindicada de novo
    de_novo = await fila.reivindicar(conexao, limite=50, visibilidade=120)
    assert all(x.send_id != msg["send_id"] for x in de_novo)


async def test_estourar_o_teto_manda_para_a_fila_morta(conexao, semear):
    """A mensagem sai da fila viva, mas NÃO some do mundo.

    Apagar direto esconderia justamente o caso que precisa ser investigado.
    """
    mensagens = await semear(quantidade=1)
    campanha = mensagens[0]["campaign_id"]
    destino = None
    alvo = mensagens[0]["send_id"]
    for _ in range(5):
        [m] = [x for x in await fila.reivindicar(conexao, limite=50, visibilidade=0)
               if x.send_id == alvo]
        destino = await fila.devolver(conexao, m.fila_id, "sempre falha",
                                      max_tentativas=5)
        # ⚠️ `devolver` empurra `visivel_em` para frente com recuo progressivo.
        # Sem trazer a mensagem de volta ao presente, a segunda volta do laço
        # não reivindicaria nada e o teste passaria por engano, sem nunca chegar
        # ao teto. O recuo tem teste próprio abaixo; aqui se mede o limite.
        await conexao.execute(
            "UPDATE email_send_queue SET visivel_em = now() WHERE id = $1", m.fila_id)
    assert destino == "morta"
    # ⚠️ Escopado à campanha do teste. Contar a tabela inteira faria o teste
    # depender do banco estar vazio, e quebrar por dado alheio.
    assert await conexao.fetchval(
        "SELECT count(*) FROM email_send_queue WHERE campaign_id = $1::uuid",
        campanha) == 0
    assert await conexao.fetchval(
        "SELECT count(*) FROM email_send_dead WHERE campaign_id = $1::uuid",
        campanha) == 1


async def test_o_recuo_cresce_a_cada_tentativa(conexao, semear):
    """Um erro de rede que dura dois minutos não pode consumir as cinco
    tentativas em dez segundos. O recuo é 1min, 2min, 4min..."""
    [msg] = await semear(quantidade=1)
    esperas = []
    for _ in range(3):
        [m] = [x for x in await fila.reivindicar(conexao, limite=50, visibilidade=0)
               if x.send_id == msg["send_id"]]
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
    assert await conexao.fetchval(
        "SELECT count(*) FROM email_send_queue WHERE campaign_id = $1::uuid",
        mensagens[0]["campaign_id"]) == 1


async def test_concluir_tira_a_mensagem_da_fila(conexao, semear):
    """Concluir só acontece depois do envio confirmado."""
    mensagens = await semear(quantidade=1)
    [m] = [x for x in await fila.reivindicar(conexao, limite=50, visibilidade=120)
           if x.send_id == mensagens[0]["send_id"]]
    await fila.concluir(conexao, m.fila_id)
    assert await conexao.fetchval(
        "SELECT count(*) FROM email_send_queue WHERE campaign_id = $1::uuid",
        mensagens[0]["campaign_id"]) == 0


# ── Campanha presa em 'sending' (pergunta 7 do CONTINUAR-AQUI, 01/10) ─────────
# O fechamento da campanha só acontecia no fim do `_tick` que processou a
# ÚLTIMA mensagem dela. Se o worker morre entre o commit do envio e o
# `finalize_campaign_if_drained` (deploy, OOM, Ctrl-C), a fila já está vazia
# para aquela campanha e nenhuma passada futura volta a olhá-la: ela fica em
# 'sending' para sempre — e o `guard_campaign_delete` nem deixa apagá-la.


async def test_campanha_drenada_sem_finalize_e_fechada_pela_varredura(conexao, semear):
    [msg] = await semear(quantidade=1)
    campanha = msg["campaign_id"]
    [m] = [x for x in await fila.reivindicar(conexao, limite=50, visibilidade=120)
           if x.send_id == msg["send_id"]]
    # O envio saiu e a mensagem foi concluída — e o worker morreu antes do
    # finalize. É exatamente o estado que nenhuma passada revisita.
    await conexao.execute(
        "UPDATE campaign_sends SET status = 'sent', sent_at = now() WHERE id = $1::uuid",
        msg["send_id"])
    await fila.concluir(conexao, m.fila_id)

    fechadas = await fila.fechar_campanhas_drenadas(conexao)

    assert campanha in fechadas
    linha = await conexao.fetchrow(
        "SELECT status, sent_at FROM campaigns WHERE id = $1::uuid", campanha)
    assert linha["status"] == "sent"
    assert linha["sent_at"] is not None


async def test_varredura_nao_fecha_campanha_com_envio_pendente(conexao, semear):
    """O contrário tem de valer: pendente segura a campanha aberta. Fechar
    cedo faria o worker recusar o resto ('campanha não está em envio')."""
    [msg] = await semear(quantidade=1)
    fechadas = await fila.fechar_campanhas_drenadas(conexao)
    assert msg["campaign_id"] not in fechadas
    assert await conexao.fetchval(
        "SELECT status FROM campaigns WHERE id = $1::uuid",
        msg["campaign_id"]) == "sending"
