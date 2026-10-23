"""O receptor do webhook de volta do GrowthHS
(`/publico/growthhs/webhook/{ambiente}`, um endereço por ambiente desde a 030).

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
from datetime import datetime, timedelta, timezone

import pytest

from app import integracoes
from app.crm import growthhs, volta
from growthhs_banco import banco_growthhs  # noqa: F401 — fixture

# Os testes de antes da 030 rodam na homologação, ativa (`com_segredo`).
AMB = "homologacao"
BASE = "/publico/growthhs/webhook"
ROTA = f"{BASE}/{AMB}"
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


def _agora(**delta) -> str:
    """Como o GrowthHS escreve: `utcnow().isoformat() + "Z"`."""
    return (datetime.now(timezone.utc) + timedelta(**delta)).replace(
        tzinfo=None).isoformat() + "Z"


def _corpo(card_id=CARD, email=None, *, lista=28, timestamp=None,
           event="card.list_changed", **extra_card) -> bytes:
    card = {"id": card_id, "title": "Card de teste", "list_id": lista,
            "list_name": "Reunião Agendada" if lista == 28 else "Ganho", "board_id": 7,
            "person": {"id": 1180, "name": "Sonda", "email": email}}
    card.update(extra_card)
    payload = {"event": event, "timestamp": timestamp or _agora(), "card": card}
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()


async def _postar(cliente, corpo: bytes, evento="meeting_scheduled", assinatura=True,
                  rota=ROTA, segredo=SEGREDO):
    headers = {"Content-Type": "application/json", **_ip()}
    if assinatura is True:
        headers["X-HSGrowth-Signature"] = _assinar(corpo, segredo)
    elif assinatura:
        headers["X-HSGrowth-Signature"] = assinatura
    return await cliente.post(rota, params={"evento": evento}, content=corpo,
                              headers=headers)


async def _gravar_segredo(conn, valor=SEGREDO, ambiente=AMB):
    nome = growthhs.segredo_webhook(ambiente)
    await conn.execute(
        """INSERT INTO public.integration_secrets (name, value, updated_at)
           VALUES ($1, $2, now())
           ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value""",
        nome, valor)
    integracoes.esquecer(nome)


async def _ativar(conn, ambiente=AMB, **colunas):
    """Uma linha de config por ambiente, `ambiente` ativo (o webhook só
    aplica o evento do ativo)."""
    await conn.execute("DELETE FROM growthhs_config")
    for amb in ("homologacao", "producao"):
        await conn.execute(
            "INSERT INTO growthhs_config (ambiente, ativo, base_url) VALUES ($1, $2, $3)",
            amb, amb == ambiente, f"https://{amb}.exemplo.invalid")
    for coluna, valor in colunas.items():  # nomes fixos, dos testes
        await conn.execute(f"UPDATE growthhs_config SET {coluna} = $1 WHERE ambiente = $2",
                           valor, ambiente)


async def _lead(conn, *, status="Lead", email=None, card_id=CARD, handoff=True,
                ambiente=AMB):
    email = email or f"webhook-{uuid.uuid4().hex[:10]}@exemplo.invalid"
    lead_id = await conn.fetchval(
        "INSERT INTO leads (nome, email, tipo, status) "
        "VALUES ('Sonda webhook', $1, 'teste', $2) RETURNING id::text", email, status)
    if handoff:
        await conn.execute(
            "INSERT INTO crm_handoffs (lead_id, origem, status, card_id, ambiente) "
            "VALUES ($1::uuid, 'manual', 'entregue', $2, $3)", lead_id, card_id, ambiente)
    return lead_id, email


async def _status(conn, lead_id):
    return await conn.fetchval("SELECT status FROM leads WHERE id = $1::uuid", lead_id)


async def _eventos(conn, lead_id, tipo):
    return await conn.fetch(
        "SELECT source_app, title, metadata FROM contact_events "
        "WHERE lead_id = $1::uuid AND event_type = $2", lead_id, tipo)


@pytest.fixture
def com_segredo(banco_growthhs, monkeypatch):
    for amb in growthhs.AMBIENTES:
        monkeypatch.delenv(growthhs.segredo_webhook(amb), raising=False)

    async def _fazer():
        await _gravar_segredo(banco_growthhs)
        await _ativar(banco_growthhs)
        return banco_growthhs
    return _fazer


async def test_sem_segredo_503(cliente, banco_growthhs, monkeypatch):
    nome = growthhs.segredo_webhook(AMB)
    monkeypatch.delenv(nome, raising=False)
    await banco_growthhs.execute(
        "DELETE FROM public.integration_secrets WHERE name = $1", nome)
    integracoes.esquecer(nome)
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
    # Não-ASCII: `compare_digest` em str levantava TypeError → 500.
    r = await _postar(cliente, corpo, assinatura="sha256=é".encode())
    assert r.status_code == 401
    assert volta.assinatura_confere(corpo, SEGREDO, "sha256=é") is False
    assert volta.assinatura_confere(corpo, SEGREDO, "sha256=" + "é" * 64) is False
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


async def test_card_com_descricao_grande_nao_e_413(cliente, com_segredo):
    """Revisão final (M1): a descrição do card cresce um bloco por
    reconversão, e vem inteira no corpo. 413 conta como falha lá — 5 seguidas
    desligam a automação. 300 KB (bem acima do teto antigo de 64 KB) passa."""
    conn = await com_segredo()
    lead_id, email = await _lead(conn)
    corpo = _corpo(email=email, description="bloco de reconversão\n" * 15_000)
    assert 256 * 1024 < len(corpo) < volta.CORPO_MAXIMO
    r = await _postar(cliente, corpo)
    assert r.status_code == 200, r.text
    assert r.json()["lead_id"] == lead_id


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
    assert meta["timestamp_growthhs"]
    assert len(await _eventos(conn, lead_id, "contact_updated")) == 1


async def test_venda_pelo_email_da_pessoa(cliente, com_segredo):
    conn = await com_segredo()
    lead_id, email = await _lead(conn, handoff=False)
    r = await _postar(cliente, _corpo(card_id=987_654_321_012, email=email.upper(),
                                      lista=32), evento="deal_won")
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
    corpo = _corpo(email=email)
    r = await cliente.post(ROTA, content=corpo,
                           headers={"X-HSGrowth-Signature": _assinar(corpo), **_ip()})
    assert r.status_code == 200 and r.json() == {"ignorado": True}
    assert await _status(conn, lead_id) == "Lead"


async def test_json_invalido_assinado_200_ignorado(cliente, com_segredo):
    await com_segredo()
    # O último estoura o parser com RecursionError (aninhamento), dentro do teto.
    for corpo in (b"{nao e json", b"", b"[1,2]", "\xff".encode("latin-1"),
                  b"[" * 60_000):
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
    r = await _postar(cliente, _corpo(email="outra-pessoa-webhook@exemplo.invalid",
                                      timestamp=_agora(seconds=1)))
    assert r.status_code == 200 and r.json() == {"ignorado": True}
    assert await _status(conn, velho) == "Lead"


async def test_card_id_pela_identidade(cliente, com_segredo):
    conn = await com_segredo()
    card = 987_654_321_014
    lead_id, email = await _lead(conn, handoff=False)
    dnia = await conn.fetchval(
        "INSERT INTO ecosystem_identities (dnia_id, email, dndash_lead_id, growthhs_card_id, "
        "growthhs_ambiente) VALUES (gen_random_uuid(), $1, $2::uuid, $3, $4) "
        "RETURNING dnia_id", email, lead_id, card, AMB)
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
    payload = {"event": "card.list_changed", "timestamp": _agora(),
               "card": {"id": CARD, "title": "Reunião — São Paulo", "list_id": 28,
                        "person": {"email": email, "name": "João Ação"}}}
    corpo = json.dumps(payload, ensure_ascii=False, indent=2).encode()
    assert corpo != json.dumps(json.loads(corpo), ensure_ascii=False,
                               separators=(",", ":")).encode()
    r = await _postar(cliente, corpo)
    assert r.status_code == 200, r.text
    assert r.json()["lead_id"] == lead_id


# --- Rodada de correção 1: o evento amarrado ao corpo assinado, e replay ---


async def test_reuniao_em_lista_que_nao_e_de_reuniao_ignorado(cliente, com_segredo):
    conn = await com_segredo()
    lead_id, email = await _lead(conn)
    r = await _postar(cliente, _corpo(email=email, lista=99))
    assert r.status_code == 200 and r.json() == {"ignorado": True}
    assert await _status(conn, lead_id) == "Lead"


async def test_corpo_de_reuniao_com_evento_de_venda_ignorado(cliente, com_segredo):
    """O `?evento=` não é assinado: o corpo de reunião (lista 28) reenviado
    com `?evento=deal_won` não pode marcar venda."""
    conn = await com_segredo()
    lead_id, email = await _lead(conn)
    r = await _postar(cliente, _corpo(email=email, lista=28), evento="deal_won")
    assert r.status_code == 200 and r.json() == {"ignorado": True}
    assert await _status(conn, lead_id) == "Lead"
    assert await _eventos(conn, lead_id, "deal_won") == []
    # E o contrário: corpo da lista de ganho com `?evento=meeting_scheduled`.
    r = await _postar(cliente, _corpo(email=email, lista=32))
    assert r.status_code == 200 and r.json() == {"ignorado": True}
    assert await _status(conn, lead_id) == "Lead"


async def test_listas_vem_da_config(cliente, com_segredo):
    conn = await com_segredo()
    await _ativar(conn, listas_reuniao=[40], listas_ganho=[41])
    lead_id, email = await _lead(conn)
    r = await _postar(cliente, _corpo(email=email, lista=28))
    assert r.json() == {"ignorado": True}
    r = await _postar(cliente, _corpo(email=email, lista=40))
    assert r.json()["status_atual"] == MQL
    r = await _postar(cliente, _corpo(email=email, lista=41), evento="deal_won")
    assert r.json()["status_atual"] == VENDA


async def test_event_diferente_ignorado(cliente, com_segredo):
    conn = await com_segredo()
    lead_id, email = await _lead(conn)
    for event in ("card.created", ""):
        r = await _postar(cliente, _corpo(email=email, event=event))
        assert r.status_code == 200 and r.json() == {"ignorado": True}, event
    assert await _status(conn, lead_id) == "Lead"


async def test_timestamp_fora_da_janela_ignorado(cliente, com_segredo):
    conn = await com_segredo()
    lead_id, email = await _lead(conn)
    for ts in (_agora(minutes=-11), _agora(minutes=11), "ontem", "   "):
        r = await _postar(cliente, _corpo(email=email, timestamp=ts))
        assert r.status_code == 200 and r.json() == {"ignorado": True}, ts
    # Sem `timestamp` nenhum.
    payload = json.loads(_corpo(email=email))
    del payload["timestamp"]
    r = await _postar(cliente, json.dumps(payload).encode())
    assert r.json() == {"ignorado": True}
    assert await _status(conn, lead_id) == "Lead"
    # Sem fuso é UTC: dentro da janela, vale.
    sem_fuso = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    r = await _postar(cliente, _corpo(email=email, timestamp=sem_fuso))
    assert r.json()["status_atual"] == MQL


async def test_mesmo_corpo_duas_vezes_repetido(cliente, com_segredo):
    conn = await com_segredo()
    lead_id, email = await _lead(conn)
    corpo = _corpo(email=email)
    r = await _postar(cliente, corpo)
    assert r.json()["mudou"] is True
    r = await _postar(cliente, corpo)
    assert r.status_code == 200
    assert r.json() == {"ignorado": True, "repetido": True}
    assert len(await _eventos(conn, lead_id, "meeting_scheduled")) == 1


# --- 030: um endereço e um segredo por ambiente ---


async def test_segredo_de_um_ambiente_nao_vale_no_outro(cliente, com_segredo):
    """O caminho não é assinado: é o segredo do ambiente do caminho que amarra
    o evento ao ambiente. Assinado com o da homologação, na produção é 503
    (sem segredo lá) ou 401 (segredo lá é outro)."""
    conn = await com_segredo()
    lead_id, email = await _lead(conn)
    corpo = _corpo(email=email)
    r = await _postar(cliente, corpo, rota=f"{BASE}/producao")
    assert r.status_code == 503, r.text
    await _gravar_segredo(conn, "segredo-da-producao-outro", ambiente="producao")
    r = await _postar(cliente, corpo, rota=f"{BASE}/producao")
    assert r.status_code == 401, r.text
    assert await _status(conn, lead_id) == "Lead"


async def test_evento_do_ambiente_inativo_200_e_nao_muda(cliente, com_segredo):
    """A homologação está ativa; a produção manda um evento válido (assinado
    com o segredo dela): 200 — 5 recusas desligariam a automação de lá — e
    nada muda."""
    conn = await com_segredo()
    await _gravar_segredo(conn, "segredo-da-producao-valido", ambiente="producao")
    lead_id, email = await _lead(conn, ambiente="producao")
    r = await _postar(cliente, _corpo(email=email), rota=f"{BASE}/producao",
                      segredo="segredo-da-producao-valido")
    assert r.status_code == 200, r.text
    assert r.json() == {"ignorado": True, "inativo": True}
    assert await _status(conn, lead_id) == "Lead"
    assert await _eventos(conn, lead_id, "meeting_scheduled") == []

    # Trocou: agora é a produção que aplica, e a homologação que é ignorada.
    await _ativar(conn, "producao")
    r = await _postar(cliente, _corpo(email=email, timestamp=_agora(seconds=1)))
    assert r.json() == {"ignorado": True, "inativo": True}
    r = await _postar(cliente, _corpo(email=email), rota=f"{BASE}/producao",
                      segredo="segredo-da-producao-valido")
    assert r.json()["status_atual"] == MQL
    [evento] = await _eventos(conn, lead_id, "meeting_scheduled")
    assert evento["metadata"]["ambiente"] == "producao"


@pytest.mark.parametrize("ambiente_do_id", ["producao", None])
async def test_card_id_de_outro_ambiente_nao_casa(cliente, com_segredo, ambiente_do_id):
    """O card 4821 entregue na PRODUÇÃO (ou sem carimbo, os da prova) não é o
    card 4821 da homologação: sem e-mail na pessoa do card, ignorado."""
    conn = await com_segredo()
    lead_id, _ = await _lead(conn, ambiente=ambiente_do_id)
    await conn.execute(
        "INSERT INTO ecosystem_identities (dnia_id, email, dndash_lead_id, growthhs_card_id, "
        "growthhs_ambiente) VALUES (gen_random_uuid(), $1, $2::uuid, $3, $4)",
        f"ident-{lead_id}@exemplo.invalid", lead_id, CARD, ambiente_do_id)
    r = await _postar(cliente, _corpo(email=None))
    assert r.status_code == 200 and r.json() == {"ignorado": True}
    assert await _status(conn, lead_id) == "Lead"


async def test_repetido_e_por_ambiente(banco_growthhs):
    """O mesmo corpo (card, evento, timestamp) num ambiente não bloqueia o
    do outro: o card 4821 de lá e o daqui são cards diferentes."""
    conn = banco_growthhs
    lead_id, email = await _lead(conn, handoff=False)
    payload = json.loads(_corpo(email=email))
    base = dict(base_url="https://g", client_id="c", client_secret="s", list_id=1,
                boards_conferidos=(1,), app_url=None)
    homo = growthhs.Config(**base, ambiente="homologacao")
    prod = growthhs.Config(**base, ambiente="producao")
    assert (await volta.aplicar(conn, "meeting_scheduled", payload, cfg=homo))["mudou"]
    assert await volta.aplicar(conn, "meeting_scheduled", payload, cfg=homo) == {
        "ignorado": True, "repetido": True}
    assert "repetido" not in await volta.aplicar(conn, "meeting_scheduled", payload, cfg=prod)
    assert len(await _eventos(conn, lead_id, "meeting_scheduled")) == 2


@pytest.mark.parametrize("rota", [BASE, f"{BASE}/teste", f"{BASE}/"])
async def test_rota_sem_ambiente_conhecido_404(cliente, com_segredo, rota):
    """A rota antiga, sem ambiente, saiu (nada apontava para ela)."""
    await com_segredo()
    r = await _postar(cliente, _corpo(), rota=rota)
    assert r.status_code == 404, r.text


def test_isencao_do_limite_cobre_os_dois_enderecos():
    from app.main import app
    from app.middleware.limite_taxa import LimiteTaxaMiddleware

    isentos = [m.kwargs.get("isentos", ()) for m in app.user_middleware
               if m.cls is LimiteTaxaMiddleware and m.kwargs.get("isentos")]
    assert isentos
    for amb in growthhs.AMBIENTES:
        assert any(f"{BASE}/{amb}".startswith(i) for i in isentos[0]), amb
