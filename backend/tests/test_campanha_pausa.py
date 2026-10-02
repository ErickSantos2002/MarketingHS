"""Pausar, retomar e parar uma campanha em envio (R1, 02/10/2026).

O estado 'paused' existia no banco e nenhuma rota levava a ele: uma campanha
enfileirada por engano só parava apagando a fila na mão.

⚠️ A lógica é testada pela conexão em transação REVERTIDA (`conexao`), nunca
pela rota com o banco comitado: uma campanha 'sending' com mensagem na fila,
comitada em produção, seria pega pelo worker que está rodando lá — e-mail
real. Pela rota só se prova o que não grava nada (403, 404).
"""

import uuid

import pytest

from app import fila
from app.dominio import controle_campanha as cc

pytestmark = [pytest.mark.asyncio, pytest.mark.trava_global]


async def _status(conexao, campanha):
    return await conexao.fetchval(
        "SELECT status FROM campaigns WHERE id = $1::uuid", campanha)


async def test_pausar_tira_da_reivindicacao_e_retomar_devolve(conexao, semear):
    [msg] = await semear(quantidade=1)
    campanha = msg["campaign_id"]

    assert await cc.pausar(conexao, campanha) == "paused"
    assert await _status(conexao, campanha) == "paused"
    pegas = await fila.reivindicar(conexao, limite=500, visibilidade=120)
    assert all(m.send_id != msg["send_id"] for m in pegas)
    # O envio continua pendente: pausar não decide nada sobre ele.
    assert await conexao.fetchval(
        "SELECT status FROM campaign_sends WHERE id = $1::uuid",
        msg["send_id"]) == "pending"

    assert await cc.retomar(conexao, campanha) == "sending"
    pegas = await fila.reivindicar(conexao, limite=500, visibilidade=120)
    assert any(m.send_id == msg["send_id"] for m in pegas)


async def test_retomar_republica_pendente_que_saiu_da_fila(conexao, semear):
    """Rede de segurança: pendente sem mensagem na fila nunca sairia, e a
    campanha ficaria em 'sending' para sempre."""
    [msg] = await semear(quantidade=1)
    campanha = msg["campaign_id"]
    await cc.pausar(conexao, campanha)
    await conexao.execute(
        "DELETE FROM email_send_queue WHERE send_id = $1::uuid", msg["send_id"])
    await cc.retomar(conexao, campanha)
    assert await conexao.fetchval(
        "SELECT count(*) FROM email_send_queue WHERE send_id = $1::uuid",
        msg["send_id"]) == 1


async def test_parar_cancela_o_que_falta_e_fecha_a_campanha(conexao, semear):
    mensagens = await semear(quantidade=3)
    campanha = mensagens[0]["campaign_id"]
    # Um já tinha saído antes do clique em "Parar".
    await conexao.execute(
        "UPDATE campaign_sends SET status = 'sent', sent_at = now(), "
        "resend_email_id = 're_teste_parar' WHERE id = $1::uuid",
        mensagens[0]["send_id"])
    await conexao.execute(
        "DELETE FROM email_send_queue WHERE send_id = $1::uuid",
        mensagens[0]["send_id"])

    resultado = await cc.parar(conexao, campanha)

    assert resultado == {"status": "sent", "interrompidos": 2}
    assert await _status(conexao, campanha) == "sent"
    assert await conexao.fetchval(
        "SELECT count(*) FROM email_send_queue WHERE campaign_id = $1::uuid",
        campanha) == 0
    linhas = await conexao.fetch(
        "SELECT status, error FROM campaign_sends WHERE campaign_id = $1::uuid "
        "ORDER BY status", campanha)
    assert [l["status"] for l in linhas] == ["sent", "suppressed", "suppressed"]
    assert all(l["error"] == cc.ERRO_INTERROMPIDO
               for l in linhas if l["status"] == "suppressed")
    # As estatísticas congeladas entendem: 1 enviado, 2 suprimidos, 0 falha.
    stats = await conexao.fetchval(
        "SELECT stats FROM campaigns WHERE id = $1::uuid", campanha)
    if isinstance(stats, str):
        import json
        stats = json.loads(stats)
    assert (stats["sent"], stats["suppressed"], stats["failed"]) == (1, 2, 0)

    # E a estatística ao vivo da tela conta os interrompidos à parte.
    from app.routers.campanhas import ESTATISTICAS_AO_VIVO
    ao_vivo = await conexao.fetchval(
        f"SELECT v.numeros FROM campaigns c {ESTATISTICAS_AO_VIVO} "
        "WHERE c.id = $1::uuid", campanha)
    if isinstance(ao_vivo, str):
        import json
        ao_vivo = json.loads(ao_vivo)
    assert (ao_vivo["interrompidos"], ao_vivo["suppressed"]) == (2, 2)


async def test_parar_campanha_pausada(conexao, semear):
    [msg] = await semear(quantidade=1)
    campanha = msg["campaign_id"]
    await cc.pausar(conexao, campanha)
    assert (await cc.parar(conexao, campanha))["interrompidos"] == 1
    assert await _status(conexao, campanha) == "sent"


async def test_estado_errado_e_conflito(conexao, semear):
    [msg] = await semear(quantidade=1)
    campanha = msg["campaign_id"]
    with pytest.raises(cc.EstadoInvalido) as e:
        await cc.retomar(conexao, campanha)  # está 'sending', não 'paused'
    assert e.value.atual == "sending"
    await conexao.execute(
        "UPDATE campaigns SET status = 'draft' WHERE id = $1::uuid", campanha)
    for acao in (cc.pausar, cc.parar):
        with pytest.raises(cc.EstadoInvalido):
            await acao(conexao, campanha)


async def test_campanha_inexistente(conexao):
    with pytest.raises(cc.NaoEncontrada):
        await cc.pausar(conexao, str(uuid.uuid4()))


# ── As rotas: só o que não grava ─────────────────────────────────────────────

@pytest.mark.parametrize("acao", ["pausar", "retomar", "parar"])
async def test_rota_exige_admin(cliente, token_usuario, acao):
    r = await cliente.post(f"/campanhas/{uuid.uuid4()}/{acao}",
                           headers={"Authorization": f"Bearer {token_usuario}"})
    assert r.status_code == 403


@pytest.mark.parametrize("acao", ["pausar", "retomar", "parar"])
async def test_rota_404(cliente, token_admin, acao):
    r = await cliente.post(f"/campanhas/{uuid.uuid4()}/{acao}",
                           headers={"Authorization": f"Bearer {token_admin}"})
    assert r.status_code == 404
