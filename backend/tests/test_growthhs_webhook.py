"""O receptor do webhook de volta do GrowthHS (`/publico/growthhs/webhook`).

O modo de falhar que importa: a automação de lá se DESLIGA sozinha depois de
5 respostas não-2xx seguidas (doc do GrowthHS §8.5), e ela dispara para todo
card do board — não só os nossos. Então tudo que não é assinatura ou tamanho
responde 200, e um card de outro lead (id velho do receptor de teste) não
pode mudar o estágio do lead errado.

Tudo roda em `banco_growthhs`: o segredo, o lead e o `crm_handoffs` vivem na
transação revertida — nada fica gravado no banco de produção.
"""

import hashlib
import hmac
import itertools
import json
import uuid

import pytest

from app import integracoes
from app.crm import growthhs, volta
from growthhs_banco import banco_growthhs  # noqa: F401 — fixture

ROTA = "/publico/growthhs/webhook"
SEGREDO = "segredo-do-webhook-teste"
MQL = "MQL - Reunião agendada"
VENDA = "Venda realizada"
CARD = 4821


_ips = itertools.count(1)


def _ip() -> dict:
    """Um IP por requisição. ⚠️ A rota está no balde de 30/min por IP de
    `/publico` (`main.py`), e o app é o mesmo objeto ao longo do arquivo:
    sem isso, a soma das requisições daqui passaria do teto e um teste
    qualquer levaria 429 apontando para o lugar errado."""
    n = next(_ips)
    return {"x-forwarded-for": f"198.51.100.{n % 250 + 1}"}


def _assinar(corpo: bytes, segredo: str = SEGREDO) -> str:
    return "sha256=" + hmac.new(segredo.encode(), corpo, hashlib.sha256).hexdigest()


def _corpo(card_id=CARD, email=None, **extra_card) -> bytes:
    card = {"id": card_id, "title": "Card de teste", "list_id": 28,
            "list_name": "Reunião Agendada", "board_id": 7,
            "person": {"id": 1180, "name": "Sonda", "email": email}}
    card.update(extra_card)
    payload = {"event": "card.list_changed", "timestamp": "2026-10-22T13:00:00Z",
               "card": card}
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()


async def _postar(cliente, corpo: bytes, evento="meeting_scheduled", assinatura=True):
    headers = {"Content-Type": "application/json", **_ip()}
    if assinatura is True:
        headers["X-HSGrowth-Signature"] = _assinar(corpo)
    elif assinatura:
        headers["X-HSGrowth-Signature"] = assinatura
    return await cliente.post(ROTA, params={"evento": evento}, content=corpo,
                              headers=headers)


async def _gravar_segredo(conn, valor=SEGREDO):
    await conn.execute(
        """INSERT INTO public.integration_secrets (name, value, updated_at)
           VALUES ($1, $2, now())
           ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value""",
        growthhs.SEGREDO_WEBHOOK, valor)
    integracoes.esquecer(growthhs.SEGREDO_WEBHOOK)


async def _lead(conn, *, status="Lead", email=None, card_id=CARD, handoff=True):
    email = email or f"webhook-{uuid.uuid4().hex[:10]}@exemplo.invalid"
    lead_id = await conn.fetchval(
        "INSERT INTO leads (nome, email, tipo, status) "
        "VALUES ('Sonda webhook', $1, 'teste', $2) RETURNING id::text", email, status)
    if handoff:
        await conn.execute(
            "INSERT INTO crm_handoffs (lead_id, origem, status, card_id) "
            "VALUES ($1::uuid, 'manual', 'entregue', $2)", lead_id, card_id)
    return lead_id, email


async def _status(conn, lead_id):
    return await conn.fetchval("SELECT status FROM leads WHERE id = $1::uuid", lead_id)


async def _eventos(conn, lead_id, tipo):
    return await conn.fetch(
        "SELECT source_app, title, metadata FROM contact_events "
        "WHERE lead_id = $1::uuid AND event_type = $2", lead_id, tipo)


@pytest.fixture
def com_segredo(banco_growthhs, monkeypatch):
    monkeypatch.delenv(growthhs.SEGREDO_WEBHOOK, raising=False)

    async def _fazer():
        await _gravar_segredo(banco_growthhs)
        return banco_growthhs
    return _fazer


async def test_sem_segredo_503(cliente, banco_growthhs, monkeypatch):
    monkeypatch.delenv(growthhs.SEGREDO_WEBHOOK, raising=False)
    await banco_growthhs.execute(
        "DELETE FROM public.integration_secrets WHERE name = $1", growthhs.SEGREDO_WEBHOOK)
    integracoes.esquecer(growthhs.SEGREDO_WEBHOOK)
    r = await _postar(cliente, _corpo())
    assert r.status_code == 503, r.text


async def test_assinatura_errada_ou_ausente_401(cliente, com_segredo):
    await com_segredo()
    corpo = _corpo()
    r = await _postar(cliente, corpo, assinatura=None)
    assert r.status_code == 401
    r = await _postar(cliente, corpo, assinatura=_assinar(corpo, "outro-segredo"))
    assert r.status_code == 401
    r = await _postar(cliente, corpo, assinatura="sha256=nao-e-hex")
    assert r.status_code == 401
    # Hex certo sem o prefixo também não vale.
    r = await _postar(cliente, corpo, assinatura=_assinar(corpo)[len("sha256="):])
    assert r.status_code == 401


async def test_corpo_grande_413(cliente, com_segredo):
    await com_segredo()
    grande = b'{"x":"' + b"a" * (volta.CORPO_MAXIMO + 10) + b'"}'
    r = await _postar(cliente, grande)
    assert r.status_code == 413

    # Sem Content-Length (chunked): a leitura em pedaços também para.
    async def pedacos():
        for _ in range(volta.CORPO_MAXIMO // 1024 + 5):
            yield b"a" * 1024
    r = await cliente.post(ROTA, params={"evento": "meeting_scheduled"},
                           content=pedacos(),
                           headers={"X-HSGrowth-Signature": "sha256=00", **_ip()})
    assert r.status_code == 413


async def test_reuniao_pelo_card_id_avanca_para_mql(cliente, com_segredo):
    conn = await com_segredo()
    lead_id, email = await _lead(conn)
    r = await _postar(cliente, _corpo(email=email))
    assert r.status_code == 200, r.text
    corpo = r.json()
    assert corpo["lead_id"] == lead_id
    assert (corpo["status_anterior"], corpo["status_atual"], corpo["mudou"]) == ("Lead", MQL, True)
    assert await _status(conn, lead_id) == MQL

    eventos = await _eventos(conn, lead_id, "meeting_scheduled")
    assert len(eventos) == 1
    assert eventos[0]["source_app"] == "growthhs"
    assert eventos[0]["title"] == volta.EVENTOS["meeting_scheduled"]
    meta = eventos[0]["metadata"]
    assert meta["card_id"] == CARD and meta["via"] == "webhook"
    assert meta["list_id"] == 28 and meta["list_name"] == "Reunião Agendada"
    assert meta["board_id"] == 7 and meta["evento_growthhs"] == "card.list_changed"
    assert len(await _eventos(conn, lead_id, "contact_updated")) == 1


async def test_venda_pelo_email_da_pessoa(cliente, com_segredo):
    conn = await com_segredo()
    lead_id, email = await _lead(conn, handoff=False)
    r = await _postar(cliente, _corpo(card_id=987_654_321_012, email=email.upper()),
                      evento="deal_won")
    assert r.status_code == 200, r.text
    assert r.json()["status_atual"] == VENDA and r.json()["mudou"] is True
    assert await _status(conn, lead_id) == VENDA
    eventos = await _eventos(conn, lead_id, "deal_won")
    assert len(eventos) == 1 and eventos[0]["title"] == volta.EVENTOS["deal_won"]


async def test_estagio_nao_volta(cliente, com_segredo):
    conn = await com_segredo()
    lead_id, email = await _lead(conn, status=VENDA)
    r = await _postar(cliente, _corpo(email=email))
    assert r.status_code == 200, r.text
    assert (r.json()["status_atual"], r.json()["mudou"]) == (VENDA, False)
    assert await _status(conn, lead_id) == VENDA
    # O evento entra na linha do tempo mesmo sem mudar o estágio.
    assert len(await _eventos(conn, lead_id, "meeting_scheduled")) == 1
    assert len(await _eventos(conn, lead_id, "contact_updated")) == 0


async def test_card_desconhecido_200_ignorado(cliente, com_segredo):
    await com_segredo()
    r = await _postar(cliente, _corpo(card_id=987_654_321_013,
                                      email="ninguem-webhook@exemplo.invalid"))
    assert r.status_code == 200 and r.json() == {"ignorado": True}
    # Sem `card`, e com `card.id` que não é número.
    for payload in ({"event": "card.list_changed"},
                    {"event": "x", "card": "texto"},
                    {"event": "x", "card": {"id": "abc", "person": None}}):
        corpo = json.dumps(payload).encode()
        r = await _postar(cliente, corpo)
        assert r.status_code == 200 and r.json() == {"ignorado": True}, payload


async def test_evento_desconhecido_200_ignorado(cliente, com_segredo):
    conn = await com_segredo()
    lead_id, email = await _lead(conn)
    for evento in ("card_lost", ""):
        r = await _postar(cliente, _corpo(email=email), evento=evento)
        assert r.status_code == 200 and r.json() == {"ignorado": True}
    r = await cliente.post(ROTA, content=_corpo(email=email),
                           headers={"X-HSGrowth-Signature": _assinar(_corpo(email=email)),
                                    **_ip()})
    assert r.status_code == 200 and r.json() == {"ignorado": True}
    assert await _status(conn, lead_id) == "Lead"


async def test_json_invalido_assinado_200_ignorado(cliente, com_segredo):
    await com_segredo()
    for corpo in (b"{nao e json", b"", b"[1,2]", "\xff".encode("latin-1")):
        r = await _postar(cliente, corpo)
        assert r.status_code == 200 and r.json() == {"ignorado": True}, corpo


async def test_card_id_com_email_diferente_cai_para_o_email(cliente, com_segredo):
    """Review Focus 2: o `card_id` 4821 do receptor de teste era inventado e
    pode ser o card real de OUTRA pessoa. O lead do handoff só vale se o
    e-mail da pessoa do card bate; senão a busca cai para o e-mail."""
    conn = await com_segredo()
    velho, _ = await _lead(conn)                          # handoff com card 4821
    certo, email_certo = await _lead(conn, handoff=False)
    r = await _postar(cliente, _corpo(email=email_certo))
    assert r.status_code == 200, r.text
    assert r.json()["lead_id"] == certo
    assert await _status(conn, certo) == MQL
    assert await _status(conn, velho) == "Lead"

    # E sem lead com aquele e-mail: ignorado, nunca o lead do handoff.
    r = await _postar(cliente, _corpo(email="outra-pessoa-webhook@exemplo.invalid"))
    assert r.status_code == 200 and r.json() == {"ignorado": True}
    assert await _status(conn, velho) == "Lead"


async def test_card_id_pela_identidade(cliente, com_segredo):
    conn = await com_segredo()
    card = 987_654_321_014
    lead_id, email = await _lead(conn, handoff=False)
    dnia = await conn.fetchval(
        "INSERT INTO ecosystem_identities (dnia_id, email, dndash_lead_id, growthhs_card_id) "
        "VALUES (gen_random_uuid(), $1, $2::uuid, $3) RETURNING dnia_id", email, lead_id, card)
    assert dnia
    # Pessoa sem e-mail no card: um dos dois vazio, o card decide.
    r = await _postar(cliente, _corpo(card_id=str(card), email=None))
    assert r.status_code == 200, r.text
    assert r.json()["lead_id"] == lead_id


async def test_lead_excluido_ignorado(cliente, com_segredo):
    conn = await com_segredo()
    lead_id, email = await _lead(conn)
    await conn.execute("UPDATE leads SET deleted_at = now() WHERE id = $1::uuid", lead_id)
    r = await _postar(cliente, _corpo(email=email))
    assert r.status_code == 200 and r.json() == {"ignorado": True}
    assert await _status(conn, lead_id) == "Lead"


async def test_erro_nosso_responde_200(cliente, com_segredo, monkeypatch):
    await com_segredo()

    async def quebra(*a, **kw):
        raise RuntimeError("bug nosso")
    monkeypatch.setattr(volta, "aplicar", quebra)
    r = await _postar(cliente, _corpo())
    assert r.status_code == 200 and r.json() == {"erro": True}


async def test_assinatura_sobre_bytes_crus(cliente, com_segredo):
    """O GrowthHS assina o JSON que ELE serializou. Re-serializar aqui (com
    outros espaços ou com acento escapado) mudaria o HMAC."""
    conn = await com_segredo()
    lead_id, email = await _lead(conn)
    payload = {"event": "card.list_changed",
               "card": {"id": CARD, "title": "Reunião — São Paulo",
                        "person": {"email": email, "name": "João Ação"}}}
    corpo = json.dumps(payload, ensure_ascii=False, indent=2).encode()
    assert corpo != json.dumps(json.loads(corpo), ensure_ascii=False,
                               separators=(",", ":")).encode()
    r = await _postar(cliente, corpo)
    assert r.status_code == 200, r.text
    assert r.json()["lead_id"] == lead_id
