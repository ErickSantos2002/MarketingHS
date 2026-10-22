"""Migration 029 e o `Config` do GrowthHS real."""

import pathlib

import pytest

from app.crm import growthhs
from growthhs_banco import aplicar_029, banco_growthhs  # noqa: F401 — fixture

MIGRATION = (pathlib.Path(__file__).parent.parent / "migrations"
             / "029_growthhs_real.sql")


async def test_029_reaplicavel(conexao):
    """Aplica o SQL duas vezes. Com a 029 ainda fora do banco, roda sobre a
    cópia temporária (ver `aplicar_029`); depois de aplicada, sobre a real."""
    sql = MIGRATION.read_text()
    if await aplicar_029(conexao):
        sql = sql.replace("public.growthhs_config", "pg_temp.growthhs_config")
        tabela_schema = "pg_temp"
    else:
        tabela_schema = "public"
    await conexao.execute(sql)  # segunda aplicação (a primeira foi a fixture)
    await conexao.execute(sql)
    if tabela_schema == "public":
        pytest.skip("029 já aplicada: reaplicação provada, DDL real é do dono")
    tipos = {r["column_name"]: (r["data_type"], r["udt_name"]) for r in
             await conexao.fetch(
                 """SELECT a.attname AS column_name,
                           format_type(a.atttypid, NULL) AS data_type,
                           t.typname AS udt_name
                      FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid
                     WHERE a.attrelid = 'pg_temp.growthhs_config'::regclass
                       AND a.attnum > 0 AND NOT a.attisdropped""")}
    assert tipos["client_id"][0] == "text"
    assert tipos["list_id"][0] == "bigint"
    assert tipos["boards_conferidos"][1] == "_int8"
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


@pytest.mark.parametrize("campo", ["base_url", "client_id", "client_secret",
                                   "list_id", "boards_conferidos"])
def test_configurado_exige_tudo(campo):
    completo = dict(base_url="https://g", client_id="c", client_secret="s",
                    list_id=1, boards_conferidos=(1,), app_url=None)
    assert growthhs.Config(**completo).configurado is True
    vazio = () if campo == "boards_conferidos" else None
    assert growthhs.Config(**{**completo, campo: vazio}).configurado is False
