"""Escrita nas tabelas de eventos do A/B, comum ao redirecionador e ao coletor."""

# As colunas de origem do clique, na ordem da origem: UTMs e click ids.
ORIGEM = ("utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
          "gclid", "fbclid", "ttclid", "msclkid")

# Reenvio de exposição/conversão é absorvido pelo índice parcial da origem
# (`uq_ab_events_dedupe`). A origem tratava o 23505 como sucesso; aqui nem chega
# a ser erro.
SEM_DUPLICATA = "ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING"


async def inserir(conn, tabela: str, linha: dict, conflito: str = "") -> None:
    """INSERT de uma linha.

    ⚠️ `tabela` e as CHAVES de `linha` vêm do código, nunca do request — é o
    que deixa montar o SQL por f-string. Os VALORES vão como parâmetro.
    """
    colunas = list(linha)
    marcas = ", ".join(f"${i + 1}" for i in range(len(colunas)))
    await conn.execute(
        f"INSERT INTO {tabela} ({', '.join(colunas)}) VALUES ({marcas}) {conflito}",
        *linha.values())
