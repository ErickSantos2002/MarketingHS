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

import json
import re
from dataclasses import dataclass, field

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


# ── Campos tipados (prova de substituição do RD, 21/10/2026) ─────────────────
# A config da página pode trazer `campos` (contrato no plano
# `docs/superpowers/plans/2026-10-21-prova-substituir-rd.md`). O front
# (`frontend/src/landing/campos.ts`) valida por cortesia; a defesa é aqui, e as
# duas pontas têm que descartar as MESMAS entradas — senão a landing mostra um
# campo que o servidor ignora calado (ou o contrário).
#
# ⚠️ `higienizar` e `CAMPOS_PERMITIDOS` ficam como estão: o que a lista branca
# aceita continua indo para a coluna como sempre foi. Os campos tipados só
# acrescentam validação e os EXTRAS (chave fora da lista branca, que vai para
# `leads.campos_extras`).

TIPOS_DE_CAMPO = frozenset({"texto", "email", "telefone", "lista", "sim_nao",
                            "texto_longo"})

# A mesma regra de `CHAVE_DE_CAMPO` do front e da regra `campo_extra` do
# `build_segment_condition` (migration 027).
CHAVE_EXTRA = re.compile(r"^[a-z][a-z0-9_]{0,39}$")

# `website` é o campo-isca (`routers/captura.py::CAMPO_ISCA`): um campo de
# verdade com essa chave faria o servidor descartar o lead como robô.
CHAVES_RESERVADAS = frozenset({"website"})

# `status` e `tipo` são estado de CRM: seguem a lista branca como hoje (o
# `_atualizar` já os ignora no contato que existe), mas nunca viram extra.
_NUNCA_EXTRA = frozenset({"status", "tipo"})

# Os campos de quando a página não diz nada — `CAMPOS_PADRAO` do front.
CAMPOS_PADRAO = ("nome", "email", "whatsapp", "cargo", "empresa")

LIMITE_TEXTO = 200
LIMITE_TEXTO_LONGO = 2000

_FORMATO_DE_EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


@dataclass(frozen=True)
class DefinicaoCampo:
    chave: str
    rotulo: str
    tipo: str
    obrigatorio: bool
    opcoes: tuple[str, ...] = ()
    # Veio de `visible_fields` (página antiga): sem validação de tipo nem de
    # tamanho — a lista branca corta em 2000 como sempre cortou (Review Focus
    # 5 do plano: página antiga capta como hoje).
    legado: bool = False


@dataclass
class CamposValidados:
    colunas: dict = field(default_factory=dict)
    extras: dict = field(default_factory=dict)
    erros: dict[str, str] = field(default_factory=dict)


def _texto(valor) -> str:
    return valor.strip() if isinstance(valor, str) else ""


def _definicao_do_email(rotulo: str = "", legado: bool = False) -> DefinicaoCampo:
    return DefinicaoCampo("email", rotulo or "E-mail", "email", True, legado=legado)


def ler_definicoes(config: dict | None) -> list[DefinicaoCampo]:
    """Os campos da página, na ordem da config — o espelho de `camposDaConfig`.

    Com `config["campos"]`: entrada que não é objeto, chave fora de
    `CHAVE_EXTRA`, chave reservada, chave repetida (fica a primeira), tipo
    desconhecido e lista sem opção são DESCARTADOS. O e-mail é sempre tipo
    e-mail e obrigatório, e entra na frente se a config não o trouxe. Se nada
    sobrar, ou sem `campos`: `visible_fields` (ou os campos padrão), tudo
    texto, só o e-mail obrigatório — o comportamento de antes da prova.
    """
    config = config if isinstance(config, dict) else {}
    lista = config.get("campos")
    if isinstance(lista, list) and lista:
        vistos: set[str] = set()
        saida: list[DefinicaoCampo] = []
        for bruto in lista:
            if not isinstance(bruto, dict):
                continue
            chave = _texto(bruto.get("chave"))
            if (not CHAVE_EXTRA.match(chave) or chave in CHAVES_RESERVADAS
                    or chave in vistos):
                continue
            rotulo = _texto(bruto.get("rotulo"))
            if chave == "email":
                vistos.add(chave)
                saida.append(_definicao_do_email(rotulo))
                continue
            tipo = bruto.get("tipo")
            if tipo not in TIPOS_DE_CAMPO:
                continue
            opcoes: tuple[str, ...] = ()
            if tipo == "lista":
                brutas = bruto.get("opcoes")
                opcoes = tuple(o for o in (_texto(x) for x in (
                    brutas if isinstance(brutas, list) else [])) if o)
                if not opcoes:
                    continue
            vistos.add(chave)
            saida.append(DefinicaoCampo(chave, rotulo or chave, tipo,
                                        bruto.get("obrigatorio") is True, opcoes))
        if saida:
            if "email" not in vistos:
                saida.insert(0, _definicao_do_email())
            return saida

    visiveis = config.get("visible_fields")
    if not isinstance(visiveis, list) or not visiveis:
        visiveis = list(CAMPOS_PADRAO)
    saida = []
    vistos = set()
    for bruto in visiveis:
        chave = _texto(bruto)
        if not chave or chave in vistos or chave in CHAVES_RESERVADAS:
            continue
        vistos.add(chave)
        saida.append(_definicao_do_email(legado=True) if chave == "email"
                     else DefinicaoCampo(chave, chave, "texto", False, legado=True))
    if "email" not in vistos:
        saida.insert(0, _definicao_do_email(legado=True))
    return saida


def normalizar_celular_br(valor) -> str | None:
    """Telefone do Brasil em E.164, ou `None` — o espelho de
    `normalizarCelular` do front.

    Tira tudo que não é dígito, o `55` da frente quando sobram 12–13 dígitos e
    o `0` da frente do DDD; aceita 10 ou 11 dígitos com DDD de 11 a 99.
    """
    if not isinstance(valor, str):
        return None
    d = re.sub(r"\D", "", valor)
    if len(d) in (12, 13) and d.startswith("55"):
        d = d[2:]
    if d.startswith("0"):
        d = d[1:]
    if len(d) not in (10, 11) or int(d[:2]) < 11:
        return None
    return "+55" + d


_SIM = frozenset({"sim", "true"})
_NAO = frozenset({"nao", "não", "false"})


def _validar_um(d: DefinicaoCampo, valor) -> tuple[str | None, str | None]:
    """(valor normalizado, erro). Valor `None` sem erro = ausente."""
    if d.tipo == "sim_nao" and isinstance(valor, bool):
        return ("sim" if valor else "nao"), None
    if valor is not None and not isinstance(valor, str):
        return None, "Valor inválido."
    texto = _texto(valor)
    if not texto:
        if d.obrigatorio:
            return None, ("Escolha uma opção." if d.tipo in ("lista", "sim_nao")
                          else "Preencha este campo.")
        return None, None
    if d.tipo == "email":
        if len(texto) > 320 or not _FORMATO_DE_EMAIL.match(texto):
            return None, "Informe um e-mail válido."
        return texto, None
    if d.tipo == "telefone":
        normalizado = normalizar_celular_br(texto)
        return (normalizado, None) if normalizado else (None, "Informe o celular com DDD.")
    if d.tipo == "lista":
        return (texto, None) if texto in d.opcoes else (None, "Escolha uma das opções.")
    if d.tipo == "sim_nao":
        baixo = texto.lower()
        if baixo in _SIM:
            return "sim", None
        if baixo in _NAO:
            return "nao", None
        return None, "Escolha sim ou não."
    limite = LIMITE_TEXTO_LONGO if d.tipo == "texto_longo" else LIMITE_TEXTO
    if len(texto) > limite:
        return None, f"Use até {limite} caracteres."
    return texto, None


def validar(definicoes: list[DefinicaoCampo], bruto: dict) -> CamposValidados:
    """Valida `bruto` contra as definições da página.

    - `colunas`: o que `higienizar` aceita, como sempre — inclusive fora das
      definições (UTMs, `source`, `ab_*`) —, com o valor VALIDADO por cima
      nos campos definidos (celular normalizado, `sim`/`nao`).
    - `extras`: só campos DEFINIDOS cuja chave não é coluna da lista branca.
      Campo que a página não pediu nunca vira extra: um formulário anônimo
      não escolhe as chaves de `campos_extras`.
    - `erros`: `{chave: mensagem em pt-BR}`.

    O `email` principal é validado (formato) mas não vai nem para `colunas`
    nem para `extras`: a rota cuida dele à parte. Definição `legado` (página
    antiga) não é validada — o comportamento de antes da prova.
    """
    bruto = bruto if isinstance(bruto, dict) else {}
    saida = CamposValidados(colunas=higienizar(bruto))
    for d in definicoes:
        if d.legado:
            continue
        valor, erro = _validar_um(d, bruto.get(d.chave))
        if erro:
            saida.erros[d.chave] = erro
            saida.colunas.pop(d.chave, None)
            continue
        if d.chave == "email":
            continue
        if d.chave in CAMPOS_PERMITIDOS:
            if valor is None:
                saida.colunas.pop(d.chave, None)
            else:
                saida.colunas[d.chave] = valor
        elif valor is not None and d.chave not in _NUNCA_EXTRA:
            saida.extras[d.chave] = valor
    return saida


# ── Rótulo no lugar da chave (o que o vendedor lê) ───────────────────────────
# Nasceu no agendamento (`agendamento-ajustes`, 28/10: o vendedor lia
# `testes_por_dia` em vez da pergunta) e veio para cá na frente
# faxina-tecnica (29/10), para a nota da captura normal usar o mesmo.

def rotulos_dos_campos(config) -> dict[str, str]:
    """chave -> rótulo dos campos da página (`ler_definicoes`, que já põe a
    chave como rótulo de quem não tem). Aceita a config em texto (o `jsonb`
    cru do asyncpg)."""
    if isinstance(config, str):
        try:
            config = json.loads(config)
        except ValueError:
            config = {}
    return {d.chave: d.rotulo for d in ler_definicoes(config) if d.rotulo}


def trocar_chaves(respostas, rotulos: dict[str, str] | None):
    """As respostas com o rótulo no lugar da chave. Rótulo que dois campos
    dividem, ou que é a chave de outro campo, fica na chave: duas respostas
    não podem virar uma."""
    if not isinstance(respostas, dict):
        return respostas
    rotulos = rotulos or {}
    valores = list(rotulos.values())
    mapa = {c: r for c, r in rotulos.items() if valores.count(r) == 1 and r not in rotulos}
    return {mapa.get(chave, chave): valor for chave, valor in respostas.items()}
