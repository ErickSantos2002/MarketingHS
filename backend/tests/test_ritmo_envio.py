"""A tela do ritmo de envio (frente faxina-r5, 07/10/2026): `/config/envio/ritmo`.

⚠️ Nenhum teste aqui grava em produção. A leitura e a gravação são testadas
pelas funções internas (`ler_detalhado`, `gravar`) dentro da transação
revertida da fixture `conexao`. Pela rota de verdade só passam pedidos que
NÃO gravam: sem credencial (401), usuário comum (403), corpo inválido (422) e
a leitura do admin.
"""

from datetime import date, timedelta

import pytest
from pydantic import ValidationError

from app.routers import ritmo_envio
from app.routers.ritmo_envio import RitmoIn

ROTA = "/config/envio/ritmo"
NOMES = list(ritmo_envio.CHAVES)


@pytest.fixture
def sem_ambiente(monkeypatch):
    """A leitura não enxerga `.env` nem variável de ambiente."""
    monkeypatch.setattr(ritmo_envio, "_do_ambiente", lambda nome: None)


async def _limpar(conexao):
    await conexao.execute(
        "DELETE FROM integration_secrets WHERE name = ANY($1::text[])", NOMES)


async def _gravar_cru(conexao, nome, valor):
    await conexao.execute(
        """INSERT INTO integration_secrets (name, value, updated_at)
           VALUES ($1, $2, now())
           ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value""", nome, valor)


async def _hoje(conexao) -> date:
    return await conexao.fetchval(
        "SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date")


# ── Leitura ──────────────────────────────────────────────────────────────────

async def test_leitura_mostra_o_valor_do_banco_e_o_padrao(conexao, sem_ambiente):
    await _limpar(conexao)
    await _gravar_cru(conexao, "ENVIO_TETO_DIA", "90")
    await _gravar_cru(conexao, "ENVIO_TETO_HORA", "90")

    r = await ritmo_envio.ler_detalhado(conexao)

    assert r["campos"]["teto_dia"] == {
        "chave": "ENVIO_TETO_DIA", "valor": 90, "origem": "banco",
        "padrao": 2000, "invalido": None}
    assert r["campos"]["teto_hora"]["valor"] == 90
    assert r["campos"]["teto_hora"]["origem"] == "banco"
    assert r["campos"]["por_segundo"]["valor"] == 2.0
    assert r["campos"]["por_segundo"]["origem"] == "padrao"
    assert r["campos"]["aquecimento_inicio"]["valor"] is None
    # O teto de hoje nunca passa do teto do dia gravado.
    assert r["teto_hoje"] <= 90


async def test_leitura_de_valor_invalido_mostra_o_padrao_e_avisa(conexao, sem_ambiente):
    await _limpar(conexao)
    await _gravar_cru(conexao, "ENVIO_TETO_DIA", "noventa")

    campo = (await ritmo_envio.ler_detalhado(conexao))["campos"]["teto_dia"]

    assert campo["valor"] == 2000
    assert campo["origem"] == "padrao"
    assert campo["invalido"] == "noventa"


async def test_leitura_ve_o_ambiente_quando_o_banco_nao_tem(conexao, monkeypatch):
    await _limpar(conexao)
    monkeypatch.setattr(ritmo_envio, "_do_ambiente",
                        lambda nome: "300" if nome == "ENVIO_TETO_HORA" else None)

    campo = (await ritmo_envio.ler_detalhado(conexao))["campos"]["teto_hora"]

    assert (campo["valor"], campo["origem"]) == (300, "ambiente")


async def test_teto_de_hoje_aplica_a_rampa(conexao, sem_ambiente):
    await _limpar(conexao)
    hoje = await _hoje(conexao)
    await _gravar_cru(conexao, "ENVIO_TETO_DIA", "1000")
    await _gravar_cru(conexao, "ENVIO_AQUECIMENTO_DIA1", "50")

    await _gravar_cru(conexao, "ENVIO_AQUECIMENTO_INICIO", hoje.isoformat())
    r = await ritmo_envio.ler_detalhado(conexao)
    assert r["hoje"] == hoje
    assert r["inicio_rampa"] == hoje
    assert r["teto_hoje"] == 50

    await _gravar_cru(conexao, "ENVIO_AQUECIMENTO_INICIO",
                      (hoje - timedelta(days=2)).isoformat())
    assert (await ritmo_envio.ler_detalhado(conexao))["teto_hoje"] == 200

    # Rampa desligada: o teto do dia vale direto.
    await _gravar_cru(conexao, "ENVIO_AQUECIMENTO_DIA1", "0")
    r = await ritmo_envio.ler_detalhado(conexao)
    assert r["teto_hoje"] == 1000
    assert r["inicio_rampa"] is None


# ── Gravação ─────────────────────────────────────────────────────────────────

async def test_gravar_so_mexe_no_que_foi_editado(conexao, sem_ambiente):
    """⚠️ Em produção o Erick gravou 90/dia e 90/h. Mudar o ritmo por segundo
    não pode zerar nem trocar os tetos."""
    await _limpar(conexao)
    await _gravar_cru(conexao, "ENVIO_TETO_DIA", "90")
    await _gravar_cru(conexao, "ENVIO_TETO_HORA", "90")

    mudancas = ritmo_envio.mudancas(RitmoIn.model_validate({"por_segundo": 1}))
    assert mudancas == {"ENVIO_POR_SEGUNDO": "1"}
    await ritmo_envio.gravar(conexao, mudancas)

    gravados = {r["name"]: r["value"] for r in await conexao.fetch(
        "SELECT name, value FROM integration_secrets WHERE name = ANY($1::text[])", NOMES)}
    assert gravados == {"ENVIO_TETO_DIA": "90", "ENVIO_TETO_HORA": "90",
                        "ENVIO_POR_SEGUNDO": "1"}


async def test_gravar_null_volta_ao_padrao(conexao, sem_ambiente):
    await _limpar(conexao)
    await _gravar_cru(conexao, "ENVIO_AQUECIMENTO_INICIO", "2026-10-02")

    mudancas = ritmo_envio.mudancas(
        RitmoIn.model_validate({"aquecimento_inicio": None}))
    assert mudancas == {"ENVIO_AQUECIMENTO_INICIO": None}
    await ritmo_envio.gravar(conexao, mudancas)

    assert await conexao.fetchval(
        "SELECT count(*) FROM integration_secrets "
        "WHERE name = 'ENVIO_AQUECIMENTO_INICIO'") == 0
    campo = (await ritmo_envio.ler_detalhado(conexao))["campos"]["aquecimento_inicio"]
    assert campo["origem"] == "padrao"


async def test_gravar_formata_como_o_worker_le(conexao, sem_ambiente):
    await _limpar(conexao)
    mudancas = ritmo_envio.mudancas(RitmoIn.model_validate({
        "por_segundo": 1.5, "teto_hora": 90, "teto_dia": 90,
        "aquecimento_dia1": 0, "aquecimento_inicio": "2026-10-02"}))
    assert mudancas == {
        "ENVIO_POR_SEGUNDO": "1.5", "ENVIO_TETO_HORA": "90", "ENVIO_TETO_DIA": "90",
        "ENVIO_AQUECIMENTO_DIA1": "0", "ENVIO_AQUECIMENTO_INICIO": "2026-10-02"}
    await ritmo_envio.gravar(conexao, mudancas)

    r = await ritmo_envio.ler_detalhado(conexao)
    assert {c: v["valor"] for c, v in r["campos"].items()} == {
        "por_segundo": 1.5, "teto_hora": 90, "teto_dia": 90,
        "aquecimento_dia1": 0, "aquecimento_inicio": date(2026, 10, 2)}
    assert all(v["origem"] == "banco" for v in r["campos"].values())


# ── Validação ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("corpo", [
    {"teto_dia": 0},            # teto 0 o worker ignora e cai no padrão (2.000)
    {"teto_hora": -1},
    {"aquecimento_dia1": -5},
    {"por_segundo": 0},
    {"teto_dia": 1.5},
    {"teto_dia": "noventa"},
    {"aquecimento_inicio": "07/10/2026"},
    {"aquecimento_inicio": "2026-02-30"},
    {"teto_do_mes": 3000},      # chave desconhecida não pode virar silêncio
    {"teto_dia": None},         # teto só volta ao padrão gravando o número
])
def test_validacao_recusa(corpo):
    with pytest.raises(ValidationError):
        RitmoIn.model_validate(corpo)


def test_validacao_aceita_dia1_zero_e_corpo_parcial():
    assert ritmo_envio.mudancas(RitmoIn.model_validate({"aquecimento_dia1": 0})) == {
        "ENVIO_AQUECIMENTO_DIA1": "0"}
    assert ritmo_envio.mudancas(RitmoIn.model_validate({})) == {}


# ── A rota (só pedidos que não gravam) ───────────────────────────────────────

def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def test_rota_sem_credencial_da_401(cliente):
    assert (await cliente.get(ROTA)).status_code == 401
    assert (await cliente.put(ROTA, json={"teto_dia": 0})).status_code == 401


async def test_rota_de_usuario_comum_da_403(cliente, token_usuario):
    assert (await cliente.get(ROTA, headers=_auth(token_usuario))).status_code == 403
    # Corpo inválido de propósito: se a autorização falhasse, daria 422 — e
    # nunca uma gravação em produção.
    r = await cliente.put(ROTA, headers=_auth(token_usuario), json={"teto_dia": 0})
    assert r.status_code == 403


async def test_rota_de_admin_com_corpo_invalido_da_422(cliente, token_admin):
    r = await cliente.put(ROTA, headers=_auth(token_admin),
                          json={"aquecimento_inicio": "amanhã"})
    assert r.status_code == 422


async def test_rota_de_admin_le(cliente, token_admin):
    r = await cliente.get(ROTA, headers=_auth(token_admin))
    assert r.status_code == 200, r.text
    corpo = r.json()
    assert set(corpo["campos"]) == set(ritmo_envio.CHAVES.values())
    assert {"hoje", "teto_hoje", "inicio_rampa", "primeiro_envio",
            "enviados_hoje", "enviados_ultima_hora"} <= set(corpo)
