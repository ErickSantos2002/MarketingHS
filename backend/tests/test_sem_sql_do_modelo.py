"""A porta de superusuário está fechada.

`execute_readonly_query` era SECURITY DEFINER com dono superusuário e aceitava
qualquer SELECT que o modelo escrevesse. A defesa era uma lista negra de
palavras — que não bloqueia `SELECT value FROM integration_secrets`, onde moram
o UNSUBSCRIBE_SECRET e o RESEND_WEBHOOK_SECRET em texto puro.

O substituto não é uma lista negra melhor: é o modelo não escrever SQL.
Ver app/ia/ferramentas.py.
"""

import pytest

# Funções SECURITY DEFINER que fazem EXECUTE de SQL montado e já foram
# auditadas: as quatro abaixo escapam todo valor com `quote_literal()` e
# escolhem a coluna por um CASE sobre uma lista fixa de nomes de campo (nunca
# a partir do texto que o chamador manda) — ver `build_segment_condition`,
# de onde as quatro herdam a montagem da condição.
# Uma função NOVA com EXECUTE não entra aqui sem a mesma auditoria: leia o
# corpo com `pg_get_functiondef` e confirme que nenhum valor não escapado nem
# nome de coluna vindo de texto externo chega ao SQL montado.
FUNCOES_COM_SQL_MONTADO_AUDITADAS = {
    # Motor de segmentos dinâmicos: montam o WHERE a partir das regras do
    # segmento, concatenando condições que `build_segment_condition` já
    # produziu com valor escapado por `quote_literal` e coluna fixa por CASE.
    "evaluate_rules_for_lead",
    "evaluate_segment_for_lead",
    "evaluate_segment_rules",
    "preview_segment_rules",
}


@pytest.mark.asyncio
async def test_a_funcao_de_sql_livre_nao_existe_mais(conexao):
    n = await conexao.fetchval(
        "SELECT count(*) FROM pg_proc WHERE proname = 'execute_readonly_query'")
    assert n == 0, (
        "execute_readonly_query voltou ao banco. Ela roda SQL arbitrário como "
        "superusuário e alcança integration_secrets. Ver migration 016.")


@pytest.mark.asyncio
async def test_nenhuma_funcao_nova_de_sql_livre_apareceu(conexao):
    """A guarda larga: qualquer SECURITY DEFINER que faça EXECUTE é a mesma
    porta com outro nome, a menos que já tenha sido auditada (ver
    FUNCOES_COM_SQL_MONTADO_AUDITADAS acima). `p.prokind = 'f'` fica antes do
    `pg_get_functiondef` porque essa função estoura em agregação
    (`array_agg` e afins não têm corpo para ler)."""
    suspeitas = await conexao.fetch(
        """SELECT p.proname
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND p.prosecdef
              AND p.prokind = 'f'
              AND pg_get_functiondef(p.oid) ~* 'EXECUTE\\s'""")
    nomes = sorted(
        r["proname"] for r in suspeitas
        if r["proname"] not in FUNCOES_COM_SQL_MONTADO_AUDITADAS)
    assert nomes == [], (
        f"funções novas que executam SQL montado: {nomes}. Para cada uma, "
        "leia o corpo com pg_get_functiondef e confira se ela monta SQL de "
        "coluna fixa e escapa os valores (quote_literal/CASE sobre nomes "
        "conhecidos) — só então entra em FUNCOES_COM_SQL_MONTADO_AUDITADAS. "
        "Se ela monta a partir de texto vindo de fora (parâmetro do "
        "chamador, campo livre), é uma porta igual à do execute_readonly_query "
        "e não entra na lista.")
