"""A regra de mesclagem da importação de CSV, isolada do transporte.

Portada de `supabase/functions/import-leads-csv`, com um nome melhor para os
modos: o original usava 'enrich' e 'overwrite'.
"""

from dataclasses import dataclass

# Os status que a coluna aceita. Vieram da function de origem; quando a régua
# de funil da HS for definida, esta lista sai daqui e vai para lead_statuses.
STATUS_VALIDOS = (
    "Lead",
    "Iniciado",
    "Lead Qualificado",
    "MQL - Reunião agendada",
    "SQL - Em negociação",
    "Em contrato",
    "Venda realizada",
)

MODOS = ("enriquecer", "sobrescrever")

# Campo do CSV -> coluna de `leads`. `desafios_ia` vira `desafios`, e o
# telefone tem duas entradas possíveis (ver `_valor`).
_CAMPOS = (
    ("nome", "nome"),
    ("whatsapp", "whatsapp"),
    ("empresa", "empresa"),
    ("cargo", "cargo"),
    ("faturamento", "faturamento"),
    ("funcionarios", "funcionarios"),
    ("desafios_ia", "desafios"),
    ("source", "source"),
)


@dataclass
class LinhaCsv:
    email: str
    nome: str | None = None
    whatsapp: str | None = None
    telefone_completo: str | None = None
    empresa: str | None = None
    cargo: str | None = None
    faturamento: str | None = None
    funcionarios: str | None = None
    desafios_ia: str | None = None
    source: str | None = None
    status: str | None = None
    tipo: str | None = None


def normalizar_status(bruto: str | None) -> str | None:
    """Casa sem diferenciar maiúscula. Status que não existe vira None em vez de
    entrar na coluna como texto livre."""
    if not bruto:
        return None
    s = bruto.strip()
    for valido in STATUS_VALIDOS:
        if valido.lower() == s.lower():
            return valido
    return None


def _valor(linha: LinhaCsv, campo: str) -> str | None:
    if campo == "whatsapp":
        # O CSV pode trazer o número em qualquer uma das duas colunas.
        return linha.whatsapp or linha.telefone_completo
    return getattr(linha, campo)


def _vazio(valor) -> bool:
    return valor is None or valor == ""


def campos_preenchidos_no_csv(linha: LinhaCsv) -> int:
    """Quantas colunas de `leads` esta linha do CSV traz com valor.

    Serve para o contador que a tela mostra: pulados = trazidos - gravados.
    Derivar assim evita repetir a regra de mesclagem só para contar — se a
    regra mudar, o contador acompanha sozinho.
    """
    return sum(1 for origem, _ in _CAMPOS if not _vazio(_valor(linha, origem)))


def combinar_duplicadas(a: LinhaCsv, b: LinhaCsv) -> LinhaCsv:
    """Funde duas linhas do MESMO arquivo com o mesmo e-mail.

    ⚠️ O primeiro valor de cada campo vence; `b` só preenche o que `a` deixou
    vazio. A function de origem percorria as linhas em ordem — a primeira
    criava o contato, as seguintes enriqueciam —, e este é o mesmo resultado.

    Sem isto, uma planilha com "ana@empresa.com" completa numa linha e
    "ANA@EMPRESA.COM" só com o nome em outra perde a linha completa: um
    dicionário indexado por e-mail fica com a última. O dado some sem erro
    nenhum, e a importação reporta sucesso.
    """
    campos = {}
    for nome in a.__dataclass_fields__:
        valor_a = getattr(a, nome)
        campos[nome] = valor_a if not _vazio(valor_a) else getattr(b, nome)
    return LinhaCsv(**campos)


def campos_para_gravar(linha: LinhaCsv, existente: dict, modo: str) -> dict:
    """Decide o que gravar num contato que já existe.

    ⚠️ Campo vazio no CSV NUNCA apaga o que já está lá, nos dois modos. Um CSV
    exportado de outra ferramenta quase sempre vem com colunas em branco, e
    tratá-las como "apague isto" destruiria a base na primeira importação.
    """
    if modo not in MODOS:
        raise ValueError(f"modo de importação desconhecido: {modo!r}")

    campos: dict[str, str] = {}

    for origem, coluna in _CAMPOS:
        novo = _valor(linha, origem)
        if _vazio(novo):
            continue
        if modo == "enriquecer" and not _vazio(existente.get(coluna)):
            continue
        campos[coluna] = novo

    status = normalizar_status(linha.status)
    if status and not (modo == "enriquecer" and not _vazio(existente.get("status"))):
        campos["status"] = status

    return campos
