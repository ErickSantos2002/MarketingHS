"""Migration 030 e a configuração do GrowthHS por ambiente (homologação e
produção salvos lado a lado, um só ativo).

O modo de falhar: o lead ir para o GrowthHS errado (o ativo não é o que a
tela mostra), os dois ambientes ativos ao mesmo tempo, ou o segredo de um
ambiente valer no outro.

⚠️ Em `banco_growthhs`: config, segredos e identidades vivem na transação
revertida (e, enquanto a 030 não está no banco, em cópias temporárias).
"""

import pathlib

import asyncpg
import pytest

from app import integracoes
from app.crm import growthhs
from growthhs_banco import SEGREDOS, banco_growthhs, sql_030_em  # noqa: F401

MIGRATION = (pathlib.Path(__file__).parent.parent / "migrations"
             / "030_growthhs_ambientes.sql")


async def test_030_reaplicavel(conexao):
    """Temporárias PRÓPRIAS com a forma de antes da 030 (linha única da 018,
    uma linha já gravada), aplicada duas vezes."""
    await conexao.execute(
        """CREATE TEMP TABLE cfg_prova (
               id uuid PRIMARY KEY DEFAULT gen_random_uuid(), base_url text,
               client_id text, list_id bigint,
               boards_conferidos bigint[] NOT NULL DEFAULT '{}',
               listas_reuniao bigint[] NOT NULL DEFAULT '{28}',
               listas_ganho bigint[] NOT NULL DEFAULT '{32}', app_url text
           ) ON COMMIT DROP""")
    await conexao.execute(
        "CREATE UNIQUE INDEX cfg_prova_linha_unica ON pg_temp.cfg_prova ((true))")
    await conexao.execute("INSERT INTO pg_temp.cfg_prova (base_url) VALUES ('https://velha')")
    await conexao.execute(
        "CREATE TEMP TABLE handoffs_prova (id bigint, card_id bigint) ON COMMIT DROP")
    await conexao.execute(
        "CREATE TEMP TABLE ident_prova (dnia_id uuid, growthhs_card_id bigint) ON COMMIT DROP")
    sql = sql_030_em({"growthhs_config": "pg_temp.cfg_prova",
                      "crm_handoffs": "pg_temp.handoffs_prova",
                      "ecosystem_identities": "pg_temp.ident_prova"})
    await conexao.execute(sql)
    await conexao.execute(sql)

    # A linha que já existia: homologação, INATIVA (não entrega até escolherem).
    velha = await conexao.fetchrow("SELECT ambiente, ativo FROM pg_temp.cfg_prova")
    assert (velha["ambiente"], velha["ativo"]) == ("homologacao", False)
    # A linha única saiu: cabe a produção.
    await conexao.execute(
        "INSERT INTO pg_temp.cfg_prova (ambiente, ativo) VALUES ('producao', true)")
    assert await conexao.fetchval("SELECT count(*) FROM pg_temp.cfg_prova") == 2

    async def recusa(comando):
        with pytest.raises((asyncpg.UniqueViolationError,
                            asyncpg.CheckViolationError,
                            asyncpg.NotNullViolationError)):
            async with conexao.transaction():  # savepoint: a recusa não aborta o resto
                await conexao.execute(comando)

    await recusa("INSERT INTO pg_temp.cfg_prova (ambiente) VALUES ('producao')")
    await recusa("UPDATE pg_temp.cfg_prova SET ativo = true")  # dois ativos
    await recusa("INSERT INTO pg_temp.cfg_prova (ambiente) VALUES ('teste')")
    await recusa("INSERT INTO pg_temp.cfg_prova (base_url) VALUES ('sem ambiente')")
    await recusa("INSERT INTO pg_temp.handoffs_prova (ambiente) VALUES ('teste')")
    await recusa("INSERT INTO pg_temp.ident_prova (growthhs_ambiente) VALUES ('teste')")
    # NULL continua valendo (linhas antigas = "não confiável").
    await conexao.execute("INSERT INTO pg_temp.handoffs_prova (id) VALUES (1)")
    await conexao.execute("INSERT INTO pg_temp.ident_prova (dnia_id) VALUES (gen_random_uuid())")


async def _config(conn, ambiente, *, ativo=False, base_url=None, client_id="hsg_x"):
    await conn.execute(
        """INSERT INTO growthhs_config (ambiente, ativo, base_url, client_id, list_id,
                                        boards_conferidos, app_url)
           VALUES ($1, $2, $3, $4, 22, '{6,7}', 'https://app.exemplo.invalid')""",
        ambiente, ativo, base_url or f"https://{ambiente}.exemplo.invalid", client_id)


async def _zerar(conn, monkeypatch):
    for nome in SEGREDOS:
        monkeypatch.delenv(nome, raising=False)
        integracoes.esquecer(nome)
    await conn.execute("DELETE FROM growthhs_config")
    await conn.execute("DELETE FROM public.integration_secrets WHERE name = ANY($1::text[])",
                       list(SEGREDOS))


def test_nomes_dos_segredos():
    assert growthhs.AMBIENTES == ("homologacao", "producao")
    assert growthhs.segredo_cliente("homologacao") == "GROWTHHS_CLIENT_SECRET_HOMOLOGACAO"
    assert growthhs.segredo_cliente("producao") == "GROWTHHS_CLIENT_SECRET_PRODUCAO"
    assert growthhs.segredo_webhook("homologacao") == "GROWTHHS_WEBHOOK_SECRET_HOMOLOGACAO"
    assert growthhs.segredo_webhook("producao") == "GROWTHHS_WEBHOOK_SECRET_PRODUCAO"


async def test_ler_config_so_devolve_o_ativo(banco_growthhs, monkeypatch):
    conn = banco_growthhs
    await _zerar(conn, monkeypatch)
    await _config(conn, "homologacao", ativo=False)
    await _config(conn, "producao", ativo=True)
    await integracoes.gravar_segredo(growthhs.segredo_cliente("homologacao"), "seg-homo")
    await integracoes.gravar_segredo(growthhs.segredo_cliente("producao"), "seg-prod")
    cfg = await growthhs.ler_config()
    assert cfg.ambiente == "producao"
    assert cfg.base_url == "https://producao.exemplo.invalid"
    assert cfg.client_secret == "seg-prod"
    assert cfg.configurado is True

    await conn.execute("UPDATE growthhs_config SET ativo = false")
    await conn.execute("UPDATE growthhs_config SET ativo = true WHERE ambiente = 'homologacao'")
    cfg = await growthhs.ler_config()
    assert (cfg.ambiente, cfg.base_url, cfg.client_secret) == (
        "homologacao", "https://homologacao.exemplo.invalid", "seg-homo")


async def test_sem_ativo_nao_configurado(banco_growthhs, monkeypatch):
    conn = banco_growthhs
    await _zerar(conn, monkeypatch)
    await _config(conn, "homologacao")
    await _config(conn, "producao")
    for amb in growthhs.AMBIENTES:
        await integracoes.gravar_segredo(growthhs.segredo_cliente(amb), "seg")
    cfg = await growthhs.ler_config()
    assert cfg.ambiente is None and cfg.configurado is False
    assert cfg.base_url is None and cfg.client_secret is None
    assert (cfg.listas_reuniao, cfg.listas_ganho) == ((28,), (32,))


async def test_segredo_antigo_sem_ambiente_nao_vale(banco_growthhs, monkeypatch):
    """O `GROWTHHS_CLIENT_SECRET` de antes da 030 não é lido por ninguém."""
    conn = banco_growthhs
    await _zerar(conn, monkeypatch)
    await _config(conn, "producao", ativo=True)
    monkeypatch.setenv("GROWTHHS_CLIENT_SECRET", "antigo")
    integracoes.esquecer("GROWTHHS_CLIENT_SECRET")
    cfg = await growthhs.ler_config()
    assert cfg.client_secret is None and cfg.configurado is False


async def test_ler_config_do_ambiente(banco_growthhs, monkeypatch):
    conn = banco_growthhs
    await _zerar(conn, monkeypatch)
    await _config(conn, "homologacao", ativo=True)
    await integracoes.gravar_segredo(growthhs.segredo_cliente("producao"), "seg-prod")
    prod = await growthhs.ler_config_do_ambiente("producao")
    # Sem linha da produção: vazia, mas com o segredo dela e o nome dela.
    assert (prod.ambiente, prod.base_url, prod.client_secret) == (
        "producao", None, "seg-prod")
    assert prod.completo is False
    homo = await growthhs.ler_config_do_ambiente("homologacao")
    assert homo.base_url == "https://homologacao.exemplo.invalid"
    assert homo.client_secret is None
    with pytest.raises(ValueError):
        await growthhs.ler_config_do_ambiente("teste")


@pytest.mark.parametrize("campo", ["base_url", "client_id", "client_secret",
                                   "list_id", "boards_conferidos", "ambiente"])
def test_configurado_exige_tudo_e_o_ambiente(campo):
    completo = dict(base_url="https://g", client_id="c", client_secret="s",
                    list_id=1, boards_conferidos=(1,), app_url=None, ambiente="producao")
    assert growthhs.Config(**completo).configurado is True
    vazio = () if campo == "boards_conferidos" else None
    assert growthhs.Config(**{**completo, campo: vazio}).configurado is False
    assert growthhs.Config(**{**completo, "ambiente": "teste"}).configurado is False
