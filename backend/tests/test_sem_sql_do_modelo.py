"""A porta de superusuário está fechada.

`execute_readonly_query` era SECURITY DEFINER com dono superusuário e aceitava
qualquer SELECT que o modelo escrevesse. A defesa era uma lista negra de
palavras — que não bloqueia `SELECT value FROM integration_secrets`, onde moram
o UNSUBSCRIBE_SECRET e o RESEND_WEBHOOK_SECRET em texto puro.

O substituto não é uma lista negra melhor: é o modelo não escrever SQL.
Ver app/ia/ferramentas.py.
"""

import pytest


@pytest.mark.asyncio
async def test_a_funcao_de_sql_livre_nao_existe_mais(conexao):
    n = await conexao.fetchval(
        "SELECT count(*) FROM pg_proc WHERE proname = 'execute_readonly_query'")
    assert n == 0, (
        "execute_readonly_query voltou ao banco. Ela roda SQL arbitrário como "
        "superusuário e alcança integration_secrets. Ver migration 016.")


@pytest.mark.asyncio
async def test_nenhuma_funcao_nova_de_sql_livre_apareceu(conexao):
    """A guarda larga: qualquer SECURITY DEFINER que receba `text` e faça
    EXECUTE do que recebeu é a mesma porta com outro nome."""
    suspeitas = await conexao.fetch(
        """SELECT p.proname
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND p.prosecdef
              AND pg_get_functiondef(p.oid) ~* 'EXECUTE\\s+(''|\\|\\||format|query|clean)'
              AND p.proname <> 'eleger_contato_canonico'""")
    nomes = sorted(r["proname"] for r in suspeitas)
    assert nomes == [], f"funções que executam SQL montado: {nomes}"
