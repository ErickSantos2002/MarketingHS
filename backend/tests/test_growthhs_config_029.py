"""Migration 029 e o `Config` do GrowthHS real."""

import pathlib

import pytest

from app.crm import growthhs
from growthhs_banco import banco_growthhs  # noqa: F401 — fixture

MIGRATION = (pathlib.Path(__file__).parent.parent / "migrations"
             / "029_growthhs_real.sql")


async def test_029_reaplicavel(conexao):
    """Prova a reaplicação numa temporária PRÓPRIA, com a forma da tabela antes
    da 029 — independe de a real já ter as colunas (e de quem é o dono: o
    Postgres checa ownership até no `IF NOT EXISTS`)."""
    await conexao.execute(
        """CREATE TEMP TABLE growthhs_config_prova (
               id uuid, base_url text, board_id bigint, app_url text
           ) ON COMMIT DROP""")
    sql = MIGRATION.read_text().replace("public.growthhs_config",
                                        "pg_temp.growthhs_config_prova")
    await conexao.execute(sql)
    await conexao.execute(sql)
    tipos = {r["attname"]: (r["tipo"], r["typname"]) for r in
             await conexao.fetch(
                 """SELECT a.attname, format_type(a.atttypid, NULL) AS tipo,
                           t.typname
                      FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid
                     WHERE a.attrelid = 'pg_temp.growthhs_config_prova'::regclass
                       AND a.attnum > 0 AND NOT a.attisdropped""")}
    assert tipos["client_id"][0] == "text"
    assert tipos["list_id"][0] == "bigint"
    assert tipos["boards_conferidos"][1] == "_int8"
    assert tipos["listas_reuniao"][1] == "_int8"
    assert tipos["listas_ganho"][1] == "_int8"
    # Linha nova nasce com as listas de produção (28 reunião, 32 ganho).
    await conexao.execute("INSERT INTO pg_temp.growthhs_config_prova (base_url) VALUES ('x')")
    linha = await conexao.fetchrow(
        "SELECT listas_reuniao, listas_ganho FROM pg_temp.growthhs_config_prova")
    assert (linha["listas_reuniao"], linha["listas_ganho"]) == ([28], [32])
    assert "board_id" in tipos


async def test_ler_config_le_colunas_novas_e_segredo(banco_growthhs):
    conn = banco_growthhs
    await conn.execute("DELETE FROM growthhs_config")
    await conn.execute(
        """INSERT INTO growthhs_config
               (base_url, client_id, list_id, boards_conferidos, app_url)
           VALUES ('https://g.exemplo.invalid', 'hsg_x', 22, '{6,7}',
                   'https://app.exemplo.invalid')""")
    await conn.execute(
        """INSERT INTO public.integration_secrets (name, value, updated_at)
           VALUES ('GROWTHHS_CLIENT_SECRET', 'segredo-x', now())
           ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value""")
    cfg = await growthhs.ler_config()
    assert cfg == growthhs.Config(
        base_url="https://g.exemplo.invalid", client_id="hsg_x",
        client_secret="segredo-x", list_id=22, boards_conferidos=(6, 7),
        app_url="https://app.exemplo.invalid")
    assert cfg.configurado is True


async def test_ler_config_listas_do_webhook(banco_growthhs):
    conn = banco_growthhs
    await conn.execute("DELETE FROM growthhs_config")
    cfg = await growthhs.ler_config()
    # Sem linha de config: os padrões de produção, nunca "nenhuma lista".
    assert (cfg.listas_reuniao, cfg.listas_ganho) == ((28,), (32,))
    await conn.execute(
        """INSERT INTO growthhs_config (base_url, listas_reuniao, listas_ganho)
           VALUES ('https://g.exemplo.invalid', '{28,40}', '{32,41}')""")
    cfg = await growthhs.ler_config()
    assert (cfg.listas_reuniao, cfg.listas_ganho) == ((28, 40), (32, 41))


@pytest.mark.parametrize("campo", ["base_url", "client_id", "client_secret",
                                   "list_id", "boards_conferidos"])
def test_configurado_exige_tudo(campo):
    completo = dict(base_url="https://g", client_id="c", client_secret="s",
                    list_id=1, boards_conferidos=(1,), app_url=None)
    assert growthhs.Config(**completo).configurado is True
    vazio = () if campo == "boards_conferidos" else None
    assert growthhs.Config(**{**completo, campo: vazio}).configurado is False
