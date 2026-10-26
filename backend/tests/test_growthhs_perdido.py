"""Negócio perdido e No Show na volta do GrowthHS (migration 032, pergunta 74).

O modo de falhar: um card perdido rebaixar uma venda, o lead perdido ficar
preso em perdido mesmo com reunião nova, o No Show mudar o status, ou o
No Show e o reagendamento (dois webhooks do mesmo card) se engolirem como
"repetido".

⚠️ Tudo em `banco_growthhs` (transação revertida). Enquanto a 032 não está no
banco, `growthhs_config` ganha uma cópia TEMPORÁRIA (o `marketinghs_app` não
é dono da tabela real) e a linha de `lead_statuses` entra na tabela real,
dentro da transação — o rollback a leva junto.
"""

import pathlib

import pytest

from app.config import settings
from app.crm import growthhs, retorno, volta
from growthhs_banco import banco_growthhs  # noqa: F401 — fixture
from test_growthhs_webhook import (AMB, MQL, VENDA, _corpo, _eventos, _gravar_segredo,
                                   _lead, _postar, _status, _agora)

MIGRATION_032 = (pathlib.Path(__file__).parent.parent / "migrations"
                 / "032_growthhs_perdido.sql")
PERDIDO = "Negócio perdido"


async def _tem_032(conn) -> bool:
    return await conn.fetchval(
        """SELECT EXISTS (SELECT 1 FROM pg_attribute
            WHERE attrelid = to_regclass('growthhs_config')
              AND attname = 'listas_perdido' AND NOT attisdropped)""")


async def aplicar_032(conn) -> bool:
    """A 032 NESTA transação: `growthhs_config` copiada para `pg_temp` (com
    as linhas) e a migration aplicada na cópia; o status vai para a tabela
    real (a FK de `leads.status` aponta para ela). Devolve True se copiou."""
    if await _tem_032(conn):
        return False
    await conn.execute(
        "CREATE TEMP TABLE growthhs_config (LIKE public.growthhs_config "
        "INCLUDING ALL) ON COMMIT DROP")
    await conn.execute("INSERT INTO pg_temp.growthhs_config SELECT * FROM public.growthhs_config")
    await conn.execute(_sql_032())
    return True


def _sql_032() -> str:
    return MIGRATION_032.read_text().replace(
        "public.growthhs_config", "pg_temp.growthhs_config")


@pytest.fixture
def com_032(banco_growthhs, monkeypatch):
    for amb in growthhs.AMBIENTES:
        monkeypatch.delenv(growthhs.segredo_webhook(amb), raising=False)

    async def _fazer():
        conn = banco_growthhs
        await aplicar_032(conn)
        await _gravar_segredo(conn)
        await conn.execute("DELETE FROM growthhs_config")
        for amb in ("homologacao", "producao"):
            await conn.execute(
                "INSERT INTO growthhs_config (ambiente, ativo, base_url) VALUES ($1, $2, $3)",
                amb, amb == AMB, f"https://{amb}.exemplo.invalid")
        return conn
    return _fazer


# ---------------------------------------------------------------- migration

async def test_032_reaplicavel(banco_growthhs):
    conn = banco_growthhs
    copiou = await aplicar_032(conn)
    if not copiou:
        pytest.skip("a 032 já está no banco — a reaplicação é provada no psql")
    await conn.execute(_sql_032())  # segunda vez
    linhas = await conn.fetch(
        "SELECT ambiente, listas_perdido, listas_no_show FROM growthhs_config")
    # As linhas que já existiam ganham o padrão.
    for linha in linhas:
        assert (list(linha["listas_perdido"]), list(linha["listas_no_show"])) == ([27, 33], [25])
    status = await conn.fetch(
        "SELECT name, sort_order, is_system FROM lead_statuses WHERE lower(name) = lower($1)",
        PERDIDO)
    assert [(s["name"], s["sort_order"], s["is_system"]) for s in status] == [(PERDIDO, 8, True)]
    # Fim de funil: depois de "Venda realizada".
    assert await conn.fetchval(
        "SELECT max(sort_order) FROM lead_statuses WHERE name <> $1", PERDIDO) < 8


async def test_ler_config_sem_032_usa_os_padroes(banco_growthhs):
    """Deploy antes da migration não pode derrubar a config (a fila de
    entrega e a volta dependem dela)."""
    conn = banco_growthhs
    if await _tem_032(conn):
        pytest.skip("a 032 já está no banco")
    await conn.execute("DELETE FROM growthhs_config")
    await conn.execute(
        "INSERT INTO growthhs_config (ambiente, ativo, base_url) "
        "VALUES ('homologacao', true, 'https://h.exemplo.invalid')")
    cfg = await growthhs.ler_config()
    assert cfg.ambiente == "homologacao"
    assert (cfg.listas_perdido, cfg.listas_no_show) == ((27, 33), (25,))


async def test_ler_config_le_as_listas_da_032(com_032):
    conn = await com_032()
    await conn.execute("UPDATE growthhs_config SET listas_perdido = '{40}', "
                       "listas_no_show = '{41, 42}' WHERE ambiente = $1", AMB)
    cfg = await growthhs.ler_config()
    assert (cfg.listas_perdido, cfg.listas_no_show) == ((40,), (41, 42))


# ---------------------------------------------------------------- deal_lost

@pytest.mark.parametrize("anterior", ["Lead", MQL, "Em contrato"])
@pytest.mark.parametrize("lista", [27, 33])
async def test_perdido_muda_status_e_grava_evento(cliente, com_032, anterior, lista):
    conn = await com_032()
    lead_id, email = await _lead(conn, status=anterior)
    r = await _postar(cliente, _corpo(email=email, lista=lista), evento="deal_lost")
    assert r.status_code == 200, r.text
    assert (r.json()["status_anterior"], r.json()["status_atual"], r.json()["mudou"]) == (
        anterior, PERDIDO, True)
    assert await _status(conn, lead_id) == PERDIDO
    eventos = await _eventos(conn, lead_id, "deal_lost")
    assert len(eventos) == 1
    assert eventos[0]["source_app"] == "growthhs"
    assert eventos[0]["title"] == "Negócio perdido no GrowthHS"
    assert eventos[0]["metadata"]["list_id"] == lista
    # O específico é o próprio evento; do status, só o `contact_updated`.
    mudancas = await _eventos(conn, lead_id, "contact_updated")
    assert len(mudancas) == 1 and mudancas[0]["metadata"]["status_atual"] == PERDIDO


async def test_perdido_nao_rebaixa_venda(cliente, com_032):
    conn = await com_032()
    lead_id, email = await _lead(conn, status=VENDA)
    r = await _postar(cliente, _corpo(email=email, lista=33), evento="deal_lost")
    assert r.status_code == 200, r.text
    assert (r.json()["status_atual"], r.json()["mudou"]) == (VENDA, False)
    assert await _status(conn, lead_id) == VENDA
    assert len(await _eventos(conn, lead_id, "deal_lost")) == 1
    assert len(await _eventos(conn, lead_id, "contact_updated")) == 0


async def test_perdido_volta_ao_funil_com_reuniao_nova(cliente, com_032):
    conn = await com_032()
    lead_id, email = await _lead(conn, status=PERDIDO)
    r = await _postar(cliente, _corpo(email=email, lista=28), evento="meeting_scheduled")
    assert r.status_code == 200, r.text
    assert (r.json()["status_atual"], r.json()["mudou"]) == (MQL, True)
    assert await _status(conn, lead_id) == MQL


async def test_perdido_duas_vezes_nao_muda_de_novo(cliente, com_032):
    conn = await com_032()
    lead_id, email = await _lead(conn, status=PERDIDO)
    r = await _postar(cliente, _corpo(email=email, lista=27), evento="deal_lost")
    assert r.status_code == 200, r.text
    assert (r.json()["status_atual"], r.json()["mudou"]) == (PERDIDO, False)
    assert len(await _eventos(conn, lead_id, "contact_updated")) == 0


@pytest.mark.parametrize("lista,evento", [(28, "deal_lost"), (32, "deal_lost"),
                                          (25, "deal_lost"), (27, "no_show"),
                                          (27, "deal_won"), (25, "meeting_scheduled")])
async def test_lista_que_nao_prova_o_evento_e_ignorada(cliente, com_032, lista, evento):
    conn = await com_032()
    lead_id, email = await _lead(conn, status=MQL)
    r = await _postar(cliente, _corpo(email=email, lista=lista), evento=evento)
    assert r.status_code == 200 and r.json() == {"ignorado": True}
    assert await _status(conn, lead_id) == MQL


async def test_listas_do_perdido_vem_da_config(cliente, com_032):
    conn = await com_032()
    await conn.execute("UPDATE growthhs_config SET listas_perdido = '{99}' "
                       "WHERE ambiente = $1", AMB)
    lead_id, email = await _lead(conn)
    r = await _postar(cliente, _corpo(email=email, lista=33), evento="deal_lost")
    assert r.json() == {"ignorado": True}
    r = await _postar(cliente, _corpo(email=email, lista=99), evento="deal_lost")
    assert r.json()["status_atual"] == PERDIDO


async def test_perdido_pelo_evento_de_contato_segue_a_mesma_regra(com_032):
    """A outra porta (`/publico/evento-de-contato`) usa a mesma
    `avancar_status`: venda não é rebaixada por ela também."""
    conn = await com_032()
    lead_id, _ = await _lead(conn, status=VENDA, handoff=False)
    assert await retorno.avancar_status(conn, lead_id, PERDIDO, metadata_extra={}) == (
        VENDA, VENDA, False)
    lead_id, _ = await _lead(conn, status="Lead", handoff=False)
    assert await retorno.avancar_status(conn, lead_id, PERDIDO, metadata_extra={}) == (
        "Lead", PERDIDO, True)


# ---------------------------------------------------------------- no_show

async def test_no_show_so_grava_evento(cliente, com_032):
    conn = await com_032()
    lead_id, email = await _lead(conn, status=MQL)
    r = await _postar(cliente, _corpo(email=email, lista=25), evento="no_show")
    assert r.status_code == 200, r.text
    assert (r.json()["status_atual"], r.json()["mudou"]) == (MQL, False)
    assert await _status(conn, lead_id) == MQL
    eventos = await _eventos(conn, lead_id, "no_show")
    assert len(eventos) == 1 and eventos[0]["title"] == "No Show no GrowthHS"
    assert len(await _eventos(conn, lead_id, "contact_updated")) == 0


async def test_no_show_e_reagendamento_nao_se_engolem(cliente, com_032):
    """Reunião → No Show → reagendamento, no mesmo card: três eventos. O
    reagendamento é outro `meeting_scheduled` com outro timestamp."""
    conn = await com_032()
    lead_id, email = await _lead(conn)
    mesmo = _agora()
    r1 = await _postar(cliente, _corpo(email=email, lista=28, timestamp=_agora(seconds=-120)))
    r2 = await _postar(cliente, _corpo(email=email, lista=25, timestamp=mesmo),
                       evento="no_show")
    # Mesmo timestamp, evento outro: não é repetido.
    r3 = await _postar(cliente, _corpo(email=email, lista=28, timestamp=mesmo))
    for r in (r1, r2, r3):
        assert r.status_code == 200 and "ignorado" not in r.json(), r.text
    assert len(await _eventos(conn, lead_id, "meeting_scheduled")) == 2
    assert len(await _eventos(conn, lead_id, "no_show")) == 1
    assert await _status(conn, lead_id) == MQL
    # E o mesmo corpo de No Show de novo é repetido.
    r4 = await _postar(cliente, _corpo(email=email, lista=25, timestamp=mesmo),
                       evento="no_show")
    assert r4.json() == {"ignorado": True, "repetido": True}


# ---------------------------------------------------------------- tela

def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def test_config_mostra_e_grava_as_listas_novas(cliente, com_032, token_admin,
                                                    monkeypatch):
    await com_032()
    monkeypatch.setattr(settings, "FRONTEND_URL", "https://mkt.exemplo.invalid")
    r = await cliente.get("/config/growthhs", headers=_auth(token_admin))
    amb = r.json()["ambientes"][AMB]
    assert (amb["listas_perdido"], amb["listas_no_show"]) == ([27, 33], [25])
    base = f"https://mkt.exemplo.invalid/api/publico/growthhs/webhook/{AMB}?evento="
    assert amb["webhook_urls"]["deal_lost"] == base + "deal_lost"
    assert amb["webhook_urls"]["no_show"] == base + "no_show"

    r = await cliente.put(f"/config/growthhs/{AMB}", headers=_auth(token_admin),
                          json={"listas_perdido": [33], "listas_no_show": [25, 26]})
    assert r.status_code == 200, r.text
    amb = r.json()["ambientes"][AMB]
    assert (amb["listas_perdido"], amb["listas_no_show"]) == ([33], [25, 26])
    assert (amb["listas_reuniao"], amb["listas_ganho"]) == ([28], [32])


@pytest.mark.parametrize("corpo", [
    {"listas_perdido": [32]},                         # ganho salvo
    {"listas_no_show": [28]},                         # reunião salva
    {"listas_perdido": [25]},                         # no show salvo
    {"listas_ganho": [27]},                           # perdido salvo
    {"listas_perdido": [40], "listas_no_show": [40]},
    {"listas_perdido": []},
    {"listas_no_show": [0]},
])
async def test_config_recusa_lista_em_dois_eventos(cliente, com_032, token_admin, corpo):
    conn = await com_032()
    r = await cliente.put(f"/config/growthhs/{AMB}", headers=_auth(token_admin), json=corpo)
    assert r.status_code == 422, (corpo, r.text)
    linha = await conn.fetchrow(
        "SELECT listas_perdido, listas_no_show FROM growthhs_config WHERE ambiente = $1", AMB)
    assert (list(linha["listas_perdido"]), list(linha["listas_no_show"])) == ([27, 33], [25])


def test_eventos_da_volta():
    assert set(volta.EVENTOS) == {"meeting_scheduled", "deal_won", "deal_lost", "no_show"}
    assert retorno.ESTAGIO_POR_EVENTO.get("no_show") is None
    assert retorno.ESTAGIO_POR_EVENTO["deal_lost"] == PERDIDO
