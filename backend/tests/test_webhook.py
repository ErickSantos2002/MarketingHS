"""O webhook do Resend.

A assinatura Svix é testada localmente, calculando o HMAC com o mesmo segredo —
o mesmo método que provou o HMAC do descadastro no 3B. O que isso NÃO substitui
é ver um evento vindo do Resend de verdade; está registrado como pendência.
"""

import base64
import hashlib
import hmac
import json
import time

import pytest

pytestmark = pytest.mark.asyncio

ROTA = "/publico/webhook/resend"


def _assinar(corpo: str, svix_id: str, ts: str, segredo_whsec: str) -> str:
    chave = base64.b64decode(segredo_whsec.removeprefix("whsec_"))
    mac = hmac.new(chave, f"{svix_id}.{ts}.{corpo}".encode(), hashlib.sha256).digest()
    return "v1," + base64.b64encode(mac).decode()


def _corpo(tipo: str, send_id: str | None = None, **extra) -> str:
    tags = [{"name": "send_id", "value": send_id}] if send_id else []
    return json.dumps({
        "type": tipo,
        "created_at": "2026-09-01T12:00:00.000Z",
        "data": {"email_id": "re_abc", "to": ["a@b.c"], "tags": tags, **extra},
    })


async def _postar(cliente, segredo, svix_id: str, corpo: str, ts: str | None = None):
    ts = ts or str(int(time.time()))
    return await cliente.post(ROTA, content=corpo, headers={
        "svix-id": svix_id, "svix-timestamp": ts,
        "svix-signature": _assinar(corpo, svix_id, ts, segredo),
        "content-type": "application/json"})


async def test_assinatura_invalida_devolve_401(cliente, segredo):
    r = await cliente.post(ROTA, content=_corpo("email.opened"), headers={
        "svix-id": "msg_ruim", "svix-timestamp": str(int(time.time())),
        "svix-signature": "v1,QUJD"})
    assert r.status_code == 401


async def test_sem_cabecalhos_devolve_401(cliente, segredo):
    r = await cliente.post(ROTA, content=_corpo("email.opened"))
    assert r.status_code == 401


async def test_timestamp_velho_devolve_401(cliente, segredo):
    """Janela anti-replay de 5 minutos: evento capturado e reenviado depois
    não pode ser aceito."""
    velho = str(int(time.time()) - 3600)
    r = await _postar(cliente, segredo, "msg_velho", _corpo("email.opened"), ts=velho)
    assert r.status_code == 401


async def test_qualquer_uma_das_assinaturas_serve(cliente, segredo, envio):
    """O cabeçalho traz várias durante uma rotação de segredo."""
    ts = str(int(time.time()))
    corpo = _corpo("email.opened", envio)
    boa = _assinar(corpo, "msg_rot", ts, segredo)
    r = await cliente.post(ROTA, content=corpo, headers={
        "svix-id": "msg_rot", "svix-timestamp": ts,
        "svix-signature": f"v1,QUJD {boa}"})
    assert r.status_code == 200


async def test_evento_repetido_devolve_200_sem_duplicar(cliente, segredo, envio):
    """Svix entrega at-least-once. `svix_id` UNIQUE é a barreira de
    idempotência, e o segundo POST tem de devolver 200 — 500 faria o Svix
    reentregar o mesmo evento por 10 horas."""
    from app.database import sessao
    corpo = _corpo("email.opened", envio)
    r1 = await _postar(cliente, segredo, "msg_dup", corpo)
    r2 = await _postar(cliente, segredo, "msg_dup", corpo)
    assert r1.status_code == 200 and r2.status_code == 200
    async with sessao(role="service_role") as conn:
        assert await conn.fetchval(
            "SELECT count(*) FROM email_events WHERE svix_id = 'msg_dup'") == 1


async def test_status_nunca_rebaixa(cliente, segredo, envio):
    """`delivered` chegando DEPOIS de `opened` não pode rebaixar o envio.
    Não há garantia de ordem de entrega."""
    from app.database import sessao
    await _postar(cliente, segredo, "msg_o", _corpo("email.opened", envio))
    await _postar(cliente, segredo, "msg_d", _corpo("email.delivered", envio))
    async with sessao(role="service_role") as conn:
        assert await conn.fetchval(
            "SELECT status FROM campaign_sends WHERE id = $1::uuid", envio) == "opened"


async def test_terminal_nao_e_sobrescrito(cliente, segredo, envio):
    """Um `opened` tardio não pode apagar um `bounced` — o motivo real da falha
    se perderia, e o envio pareceria ter chegado."""
    from app.database import sessao
    await _postar(cliente, segredo, "msg_b",
                  _corpo("email.bounced", envio, bounce={"type": "Permanent"}))
    await _postar(cliente, segredo, "msg_o2", _corpo("email.opened", envio))
    async with sessao(role="service_role") as conn:
        assert await conn.fetchval(
            "SELECT status FROM campaign_sends WHERE id = $1::uuid", envio) == "bounced"


async def test_hard_bounce_suprime_e_transiente_nao(cliente, segredo, envio):
    """⚠️ Só hard bounce suprime. `bounce.type == 'Transient'` é caixa cheia ou
    servidor fora do ar — suprimir aí queimaria um contato bom para sempre."""
    from app.database import sessao
    await _postar(cliente, segredo, "msg_t",
                  _corpo("email.bounced", envio, bounce={"type": "Transient"}))
    async with sessao(role="service_role") as conn:
        assert await conn.fetchval(
            "SELECT count(*) FROM email_suppressions WHERE email = 'a@b.c'") == 0

    await _postar(cliente, segredo, "msg_p",
                  _corpo("email.bounced", envio, bounce={"type": "Permanent"}))
    async with sessao(role="service_role") as conn:
        assert await conn.fetchval(
            "SELECT reason FROM email_suppressions WHERE email = 'a@b.c'") == "bounce"


async def test_reclamacao_suprime(cliente, segredo, envio):
    from app.database import sessao
    await _postar(cliente, segredo, "msg_c", _corpo("email.complained", envio))
    async with sessao(role="service_role") as conn:
        assert await conn.fetchval(
            "SELECT reason FROM email_suppressions WHERE email = 'a@b.c'") == "complaint"


async def test_timestamp_nao_numerico_devolve_401(cliente, segredo):
    """A origem recusava timestamp não finito. `float("nan")` passa pela
    comparação da janela — toda comparação com NaN é falsa, inclusive `> 300`
    — e só a assinatura segurava. A janela anti-replay não pode depender disso."""
    r = await _postar(cliente, segredo, "msg_nan", _corpo("email.opened"), ts="nan")
    assert r.status_code == 401


async def test_evento_de_campanha_excluida_nao_entra_em_laco(cliente, segredo, envio):
    """A escada de degradação. Evento que chega DEPOIS da exclusão tenta inserir
    um id que não existe mais — 23503, não 23505. Sem a escada o endpoint
    devolve 500 e o Svix reentrega por 10 horas sem nunca conseguir."""
    from app.database import sessao
    corpo = json.dumps({
        "type": "email.opened", "created_at": "2026-09-01T12:00:00.000Z",
        "data": {"email_id": "re_x", "to": ["a@b.c"], "tags": [
            {"name": "campaign_id", "value": "00000000-0000-0000-0000-000000000000"},
            {"name": "lead_id", "value": "00000000-0000-0000-0000-000000000001"}]},
    })
    r = await _postar(cliente, segredo, "msg_orfao", corpo)
    assert r.status_code == 200
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            "SELECT campaign_id, lead_id, payload FROM email_events "
            "WHERE svix_id = 'msg_orfao'")
    # Os vínculos caem, mas o evento é guardado: o payload bruto ainda tem as
    # tags originais com os ids. É o que o ON DELETE SET NULL teria feito se o
    # evento tivesse chegado antes da exclusão.
    assert linha["campaign_id"] is None and linha["lead_id"] is None
    assert linha["payload"] is not None
