"""As ferramentas que o analista de IA pode chamar.

⚠️ O DESENHO INTEIRO existe por um motivo: o analista de origem fazia o MODELO
ESCREVER SQL, e uma RPC `SECURITY DEFINER` de dono superusuário executava
(migration 016). A defesa era lista negra de palavras, que não bloqueia
`SELECT value FROM integration_secrets`.

A regra que substitui a lista negra:

  **Nenhum valor vindo do modelo entra numa string de SQL.**

Nome de campo é CHAVE numa allowlist que mapeia para um fragmento fixo, escrito
aqui. Valor vai sempre como parâmetro `$n` do asyncpg. Se você precisar
concatenar algo que veio do argumento, o desenho está errado — não o contorne.

⚠️ E as ferramentas rodam pela conexão que quem chama abriu, que é a `sessao()`
com o papel do admin que perguntou — nunca `service_role`. O RLS continua
valendo como segunda linha, que é a regra da casa.
"""

import datetime as dt
import inspect
import re

# ── Allowlists ───────────────────────────────────────────────────────────────
# Chave = o nome que o modelo usa. Valor = o SQL, escrito aqui, nunca vindo dele.

DIMENSOES: dict[str, str] = {
    "etiqueta": "l.etiqueta",
    "tipo": "l.tipo",
    "status": "l.status",
    "cargo": "l.cargo",
    "faturamento": "l.faturamento",
    "funcionarios": "l.funcionarios",
    "origem": "l.utm_source",
    "midia": "l.utm_medium",
    "campanha": "l.utm_campaign",
    "conteudo": "l.utm_content",
    "canal": "l.source",
    "presenca": "l.presenca",
    # O DDD é o mais perto de "região" que a base tem: não existe coluna de
    # estado nem de cidade em `leads` (conferido em 03/09/2026).
    "ddd": "substring(l.phone_normalized from 3 for 2)",
}

FILTROS: dict[str, str] = {
    "etiqueta": "l.etiqueta = {p}",
    "tipo": "l.tipo = {p}",
    "status": "l.status = {p}",
    "cargo": "l.cargo = {p}",
    "faturamento": "l.faturamento = {p}",
    "funcionarios": "l.funcionarios = {p}",
    "origem": "l.utm_source = {p}",
    "midia": "l.utm_medium = {p}",
    "campanha": "l.utm_campaign = {p}",
    "canal": "l.source = {p}",
    "ddd": "substring(l.phone_normalized from 3 for 2) = {p}",
    "tem_email": "(l.email IS NOT NULL) = {p}",
    "tem_desafio": "(l.desafios IS NOT NULL AND l.desafios <> '') = {p}",
    "desde": "l.created_at >= {p}::date",
    "ate": "l.created_at < ({p}::date + 1)",
}

# Os filtros cujo valor é data e por isso passa pela conferência de formato.
FILTROS_DE_DATA = {"desde", "ate"}
# Os filtros cujo valor é booleano.
FILTROS_BOOLEANOS = {"tem_email", "tem_desafio"}

GRANULARIDADES: dict[str, str] = {
    "dia": "day",
    "semana": "week",
    "mes": "month",
}

# 50: o suficiente para o modelo raciocinar sobre exemplos, longe do suficiente
# para exportar a base. ⚠️ O resultado da ferramenta entra no contexto do modelo
# E fica gravado em `ai_chat_messages` — um teto alto aqui é vazamento com
# retenção.
LIMITE_MAXIMO = 50

# 365 dias: recorte máximo de uma série temporal, para uma pergunta ingênua não
# devolver mil pontos que ninguém lê e que enchem o contexto.
PONTOS_MAXIMOS = 365

# 30 grupos: o suficiente para o modelo ver os maiores. `cargo` é texto livre
# e `ddd` tem ~67 valores possíveis na base real — sem um teto nomeado aqui
# (e sem os campos `truncado`/`total_geral` no retorno), o modelo não teria
# como saber que viu só uma parte.
LIMITE_DE_GRUPOS = 30


class FerramentaDesconhecida(ValueError):
    """O modelo pediu uma ferramenta que não existe."""


class ArgumentoRecusado(ValueError):
    """O modelo mandou um campo ou valor fora da allowlist."""


# ── Montagem segura ──────────────────────────────────────────────────────────

_DATA = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _conferir_data(valor: object, campo: str) -> dt.date:
    """Confere o formato e devolve um `datetime.date`, não a string.

    ⚠️ Não é só validação: o Postgres descreve `$n::date`/`$n::timestamptz` na
    extended query protocol como o tipo do cast, e o codec do asyncpg para
    esses OIDs só aceita `datetime.date`/`datetime.datetime` — nunca `str`. Sem
    esta conversão, todo filtro de período derruba a query com
    `DataError: 'str' object has no attribute 'toordinal'`, mesmo o valor
    tendo passado por `$n` corretamente. Não é uma questão de SQL — é o tipo
    Python do lado do parâmetro.
    """
    if not isinstance(valor, str) or not _DATA.match(valor):
        raise ArgumentoRecusado(
            f"O filtro '{campo}' espera uma data no formato AAAA-MM-DD.")
    try:
        return dt.date.fromisoformat(valor)
    except ValueError:
        raise ArgumentoRecusado(
            f"O filtro '{campo}' recebeu uma data que não existe: {valor!r}.")


def _onde(filtros: dict | None) -> tuple[str, list]:
    """Devolve (fragmento SQL, parâmetros).

    ⚠️ O fragmento é montado SÓ de strings deste arquivo. Os valores saem em
    `parametros` e viram `$1`, `$2`… no asyncpg.
    """
    # O soft delete do lote 1C não é opcional: contar excluído infla o painel.
    partes = ["l.deleted_at IS NULL"]
    parametros: list = []

    for campo, valor in (filtros or {}).items():
        molde = FILTROS.get(campo)
        if molde is None:
            raise ArgumentoRecusado(
                f"Não existe o filtro '{campo}'. "
                f"Os que existem: {', '.join(sorted(FILTROS))}.")
        if campo in FILTROS_DE_DATA:
            valor = _conferir_data(valor, campo)
        elif campo in FILTROS_BOOLEANOS:
            if not isinstance(valor, bool):
                raise ArgumentoRecusado(
                    f"O filtro '{campo}' espera verdadeiro ou falso.")
        elif not isinstance(valor, str):
            raise ArgumentoRecusado(f"O filtro '{campo}' espera texto.")

        parametros.append(valor)
        partes.append(molde.format(p=f"${len(parametros)}"))

    return " AND ".join(partes), parametros


def _dimensao(nome: object) -> str:
    if not isinstance(nome, str) or nome not in DIMENSOES:
        raise ArgumentoRecusado(
            f"Não existe a dimensão {nome!r}. "
            f"As que existem: {', '.join(sorted(DIMENSOES))}.")
    return DIMENSOES[nome]


# ── As ferramentas ───────────────────────────────────────────────────────────

async def contar_contatos(conn, filtros: dict | None = None) -> dict:
    onde, parametros = _onde(filtros)
    total = await conn.fetchval(
        f"SELECT count(*) FROM leads l WHERE {onde}", *parametros)
    return {"total": total, "filtros_aplicados": filtros or {}}


async def distribuir_contatos(conn, dimensao: str,
                              filtros: dict | None = None) -> dict:
    coluna = _dimensao(dimensao)
    onde, parametros = _onde(filtros)
    # ⚠️ O denominador é o total REAL, não a soma das linhas que voltaram. Com
    # mais de LIMITE_DE_GRUPOS valores distintos (cargo é texto livre; ddd tem
    # ~67), somar o que voltou infla todo percentual — e o modelo afirma o
    # número inflado com convicção.
    total = await conn.fetchval(
        f"SELECT count(*) FROM leads l WHERE {onde}", *parametros)
    linhas = await conn.fetch(
        f"""SELECT COALESCE({coluna}::text, '(sem valor)') AS valor,
                   count(*) AS total
              FROM leads l
             WHERE {onde}
             GROUP BY 1
             ORDER BY 2 DESC, 1
             LIMIT {LIMITE_DE_GRUPOS}""", *parametros)
    mostrados = sum(l["total"] for l in linhas)
    return {
        "dimensao": dimensao,
        "total_geral": total,
        # ⚠️ `truncado` existe para o modelo saber que NÃO viu a distribuição
        # inteira. Sem isso ele conclui sobre o todo tendo visto uma parte.
        "truncado": mostrados < total,
        "nao_mostrados": total - mostrados,
        "distribuicao": [
            {"valor": l["valor"], "total": l["total"],
             "percentual": round(100 * l["total"] / total, 1) if total else 0.0}
            for l in linhas
        ],
    }


async def serie_temporal(conn, granularidade: str = "dia",
                         filtros: dict | None = None) -> dict:
    unidade = GRANULARIDADES.get(granularidade)
    if unidade is None:
        raise ArgumentoRecusado(
            f"Granularidade {granularidade!r} não existe. "
            f"As que existem: {', '.join(sorted(GRANULARIDADES))}.")
    onde, parametros = _onde(filtros)
    # ⚠️ `ORDER BY 1 DESC` — os RECENTES são o que interessa quando a série
    # excede PONTOS_MAXIMOS. `ORDER BY 1 LIMIT N` sem o DESC pegaria os pontos
    # mais ANTIGOS e descartaria os recentes, que é o oposto do que uma
    # pergunta de análise quer numa base com mais de um ano de histórico.
    linhas = await conn.fetch(
        f"""SELECT date_trunc('{unidade}', l.created_at)::date AS periodo,
                   count(*) AS total
              FROM leads l
             WHERE {onde}
             GROUP BY 1
             ORDER BY 1 DESC
             LIMIT {PONTOS_MAXIMOS}""", *parametros)
    linhas = list(reversed(linhas))
    return {
        "granularidade": granularidade,
        "truncado": len(linhas) >= PONTOS_MAXIMOS,
        "pontos": [{"periodo": l["periodo"].isoformat(), "total": l["total"]}
                   for l in linhas],
    }


async def listar_contatos(conn, filtros: dict | None = None,
                          limite: int = 20) -> dict:
    """Uma AMOSTRA, nunca a base.

    ⚠️ Sem nome, sem e-mail, sem telefone: identificam uma pessoa, e o
    resultado desta ferramenta entra no contexto do modelo e fica gravado em
    `ai_chat_messages` — dado de contato aqui é vazamento com retenção. O
    modelo não precisa do nome nem do e-mail para raciocinar sobre perfil.

    `empresa` FICA, de propósito: em B2B a empresa é a unidade de análise, não
    identifica uma pessoa, e não há dimensão `empresa` em `DIMENSOES` para
    agrupar por ela — sem isto o modelo não teria nenhuma leitura de setor.
    """
    if isinstance(limite, bool) or not isinstance(limite, int) or limite < 1:
        raise ArgumentoRecusado("O limite tem de ser um inteiro positivo.")
    limite = min(limite, LIMITE_MAXIMO)
    onde, parametros = _onde(filtros)
    linhas = await conn.fetch(
        f"""SELECT l.empresa, l.cargo, l.faturamento, l.funcionarios,
                   l.etiqueta, l.status, l.lead_score, l.utm_source,
                   l.desafios, l.created_at::date AS entrou_em
              FROM leads l
             WHERE {onde}
             ORDER BY l.created_at DESC
             LIMIT {limite}""", *parametros)
    return {
        "contatos": [dict(l) | {"entrou_em": l["entrou_em"].isoformat()}
                     for l in linhas],
        "limite_aplicado": limite,
    }


async def desempenho_de_campanhas(conn, filtros: dict | None = None) -> dict:
    """Envios, aberturas e cliques por campanha.

    ⚠️ Não passa por `_onde`: os filtros de `leads` não se aplicam a campanha.
    Aceita só `desde`/`ate`, conferidos como data.
    """
    parametros: list = []
    partes: list[str] = []
    for campo in ("desde", "ate"):
        valor = (filtros or {}).get(campo)
        if valor is None:
            continue
        valor = _conferir_data(valor, campo)
        parametros.append(valor)
        molde = ("c.created_at >= ${}::date" if campo == "desde"
                 else "c.created_at < (${}::date + 1)")
        partes.append(molde.format(len(parametros)))
    for campo in (filtros or {}):
        if campo not in ("desde", "ate"):
            raise ArgumentoRecusado(
                f"O filtro '{campo}' não vale para campanhas. "
                "Aqui só existem 'desde' e 'ate'.")
    onde = " AND ".join(partes) if partes else "TRUE"

    linhas = await conn.fetch(
        f"""SELECT c.name AS campanha, c.status,
                   count(s.id) AS enviados,
                   count(s.opened_at) AS aberturas,
                   count(s.clicked_at) AS cliques
              FROM campaigns c
              LEFT JOIN campaign_sends s
                     ON s.campaign_id = c.id AND s.status = 'sent'
             WHERE {onde}
             GROUP BY c.id, c.name, c.status
             ORDER BY count(s.id) DESC
             LIMIT 30""", *parametros)
    return {"campanhas": [dict(l) for l in linhas]}


async def desafios_frequentes(conn, filtros: dict | None = None,
                              limite: int = 30) -> dict:
    """Os desafios escritos pelos contatos, para o modelo achar os temas.

    ⚠️ Devolve o texto do desafio, não o autor. O tema é o que interessa.
    """
    if isinstance(limite, bool) or not isinstance(limite, int) or limite < 1:
        raise ArgumentoRecusado("O limite tem de ser um inteiro positivo.")
    limite = min(limite, LIMITE_MAXIMO)
    filtros = dict(filtros or {})
    filtros["tem_desafio"] = True
    onde, parametros = _onde(filtros)
    linhas = await conn.fetch(
        f"""SELECT l.desafios, l.cargo, l.faturamento
              FROM leads l
             WHERE {onde}
             ORDER BY l.created_at DESC
             LIMIT {limite}""", *parametros)
    return {"desafios": [dict(l) for l in linhas], "limite_aplicado": limite}


EXECUTORES = {
    "contar_contatos": contar_contatos,
    "distribuir_contatos": distribuir_contatos,
    "serie_temporal": serie_temporal,
    "listar_contatos": listar_contatos,
    "desempenho_de_campanhas": desempenho_de_campanhas,
    # `desafios_frequentes` saiu daqui em 02/10/2026 (raio-x RD, R6): o campo
    # desafio é do funil de evento da dn.ia e a H&S não o coleta. A função
    # continua acima só porque `routers/ia.py` (analisar-leads e
    # analisar-desafios) ainda a chama — o assistente não a oferece mais.
}


async def executar(conn, nome: str, argumentos: object) -> dict:
    """Despacha pelo nome. Levanta se o nome ou os argumentos não existirem."""
    funcao = EXECUTORES.get(nome)
    if funcao is None:
        raise FerramentaDesconhecida(
            f"Não existe a ferramenta {nome!r}. "
            f"As que existem: {', '.join(sorted(EXECUTORES))}.")
    argumentos = argumentos or {}
    if not isinstance(argumentos, dict):
        raise ArgumentoRecusado("Os argumentos têm de vir como objeto.")
    # ⚠️ Sem esta guarda, argumento desconhecido vira TypeError cru e quem
    # chama não consegue distinguir "o modelo errou" de "o sistema quebrou".
    aceitos = set(inspect.signature(funcao).parameters) - {"conn"}
    sobrando = set(argumentos) - aceitos
    if sobrando:
        raise ArgumentoRecusado(
            f"A ferramenta {nome!r} não aceita {', '.join(sorted(sobrando))}. "
            f"Aceita: {', '.join(sorted(aceitos))}.")
    return await funcao(conn, **argumentos)


# ── Os esquemas que vão para a API ───────────────────────────────────────────
# ⚠️ `strict: True` + `additionalProperties: False` é o que garante que o
# argumento que chega é o argumento que o schema descreve.

_FILTROS_SCHEMA = {
    "type": "object",
    "description": ("Recortes. Campos aceitos: "
                    + ", ".join(sorted(FILTROS))
                    + ". 'desde' e 'ate' são datas AAAA-MM-DD."),
    "properties": {
        **{c: {"type": "string"} for c in sorted(set(FILTROS) - FILTROS_BOOLEANOS)},
        **{c: {"type": "boolean"} for c in sorted(FILTROS_BOOLEANOS)},
    },
    "required": [],
    "additionalProperties": False,
}

ESQUEMAS: list[dict] = [
    {
        "name": "contar_contatos",
        "description": "Quantos contatos existem, com filtros opcionais.",
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {"filtros": _FILTROS_SCHEMA},
            "required": [],
            "additionalProperties": False,
        },
    },
    {
        "name": "distribuir_contatos",
        "description": ("Contagem agrupada por uma dimensão. Dimensões: "
                        + ", ".join(sorted(DIMENSOES)) + f". Devolve no máximo "
                        f"os {LIMITE_DE_GRUPOS} maiores grupos — confira "
                        "'truncado' e 'total_geral' antes de falar em "
                        "percentual do todo."),
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {
                "dimensao": {"type": "string", "enum": sorted(DIMENSOES)},
                "filtros": _FILTROS_SCHEMA,
            },
            "required": ["dimensao"],
            "additionalProperties": False,
        },
    },
    {
        "name": "serie_temporal",
        "description": "Volume de contatos ao longo do tempo.",
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {
                "granularidade": {"type": "string", "enum": sorted(GRANULARIDADES)},
                "filtros": _FILTROS_SCHEMA,
            },
            "required": [],
            "additionalProperties": False,
        },
    },
    {
        "name": "listar_contatos",
        "description": (f"Uma amostra de até {LIMITE_MAXIMO} contatos, sem "
                        "nome, e-mail nem telefone — só empresa e atributos de "
                        "perfil. Para examinar exemplos, não para exportar a "
                        "base."),
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {
                "filtros": _FILTROS_SCHEMA,
                # ⚠️ Sem `minimum`/`maximum`: constraint numérica pode não ser
                # suportada em schema `strict: true`, e não há como conferir
                # sem chave da Anthropic — se não for suportada, a primeira
                # chamada de verdade volta 400. O teto continua na
                # `description` (o modelo continua sabendo) e a defesa real é
                # a validação de servidor em `listar_contatos`, já coberta por
                # teste.
                "limite": {"type": "integer"},
            },
            "required": [],
            "additionalProperties": False,
        },
    },
    {
        "name": "desempenho_de_campanhas",
        "description": "Envios, aberturas e cliques por campanha de e-mail.",
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {
                "filtros": {
                    "type": "object",
                    "description": "Só 'desde' e 'ate', datas AAAA-MM-DD.",
                    "properties": {"desde": {"type": "string"},
                                   "ate": {"type": "string"}},
                    "required": [],
                    "additionalProperties": False,
                },
            },
            "required": [],
            "additionalProperties": False,
        },
    },
]
