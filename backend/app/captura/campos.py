"""A lista branca do que um formulário público pode escrever em `leads`.

⚠️ Lista branca, e não lista negra. A lição do lote 6: toda vez que a defesa
for "proibir o que é ruim" em vez de "permitir só o que é bom", é o desenho
errado. Aqui a consequência de errar é um formulário anônimo escrevendo
`lead_score`, `etiqueta` ou `deleted_at` direto.

⚠️ Sete campos desta lista são vocabulário da dn.ia — `tipo_participante`,
`presenca`, `indicacao`, `interesse_formacao`, `interesse_ecossistema`,
`interesse_mtia`, `data_interesse`. São funil de evento e mentoria, que a HS
não tem. Ficam porque as COLUNAS existem e integrador externo pode estar
mandando; tirá-los é decisão de negócio, não de código, e está registrada como
pergunta no CONTINUAR-AQUI.
"""

# Herdada da function `lead-capture`, ao pé da letra.
CAMPOS_PERMITIDOS = frozenset({
    "nome", "whatsapp", "cargo", "empresa", "faturamento", "funcionarios",
    "desafios", "tipo", "tipo_participante", "source", "presenca",
    "origem_campanha", "indicacao", "interesse_formacao",
    "interesse_ecossistema", "interesse_mtia", "data_interesse", "status",
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "ab_test", "ab_var", "ab_vid",
})

TAMANHO_MAXIMO = 2000


def higienizar(bruto: dict) -> dict:
    """Só o que está na lista, aparado, sem vazio e sem texto gigante.

    ⚠️ `""` é DESCARTADO, não gravado como string vazia — é o comportamento da
    origem, e o lote 7 já pagou o preço de os dois lados discordarem sobre isso
    (o INSERT gravava `''` onde o UPDATE gravava NULL).
    """
    saida: dict = {}
    if not isinstance(bruto, dict):
        return saida
    for chave, valor in bruto.items():
        if chave not in CAMPOS_PERMITIDOS or valor is None:
            continue
        if isinstance(valor, bool):
            saida[chave] = valor
        elif isinstance(valor, (int, float)):
            saida[chave] = str(valor)
        elif isinstance(valor, str):
            aparado = valor.strip()[:TAMANHO_MAXIMO]
            if aparado:
                saida[chave] = aparado
    return saida
