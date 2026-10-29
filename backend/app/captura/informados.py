"""O que o lead digitou em cada conversão, e onde isso difere do contato
(pergunta 73, 26/10/2026).

A captura é anônima e NÃO sobrescreve o contato (R1, 02/10 — ver
`registro.py::_atualizar`). O preço era perder o que a pessoa digitou de
diferente: "Empresa Teste HS Matriz" numa reconversão de quem estava como
"Filial Sul" não ficava em lugar nenhum, e o card do vendedor mostrava a
Filial Sul sob um cabeçalho que dizia "dados informados no formulário".

Agora cada conversão guarda `dados_informados` (migration 031) e quem mostra
— o card do GrowthHS (`crm/growthhs.py`), a nota, a linha do tempo — usa
`divergencias` para dizer o que a pessoa informou DE DIFERENTE, sempre como
"não verificado".

Módulo puro: nada aqui fala com o banco.
"""

import json

from app.captura.campos import normalizar_celular_br, trocar_chaves

# Os campos de CONTATO da lista branca, na ordem em que aparecem. Fora, de
# propósito: `status`/`tipo` (estado de CRM, a mesma razão do `_atualizar`),
# `source`/`utm_*`/`ab_*` (já são colunas da conversão) e o vocabulário da
# dn.ia (`tipo_participante`, `presenca`, `interesse_*`, …), que não é dado de
# contato da HS.
CAMPOS_INFORMADOS = ("nome", "empresa", "cargo", "whatsapp", "faturamento",
                     "funcionarios", "desafios", "indicacao")
ROTULOS = {"nome": "Nome", "empresa": "Empresa", "cargo": "Cargo",
           "whatsapp": "Telefone", "faturamento": "Faturamento",
           "funcionarios": "Funcionários", "desafios": "Desafios",
           "indicacao": "Indicação"}
CHAVE_EXTRAS = "campos_extras"

# O que o card mostra (`growthhs.MAX_VALOR_EXTRA`/`MAX_DESAFIOS`): guardar
# mais seria guardar o que ninguém lê.
VALOR_MAXIMO = 500
EXTRAS_MAXIMO = 30
# O `CORPO_MAXIMO` da porta do site. Passou disso, os extras saem e ficam só
# as colunas — nunca se recusa a captura por causa do histórico.
TETO_EM_BYTES = 16 * 1024


def _texto(valor) -> str | None:
    if isinstance(valor, bool) or valor is None:
        return None
    if isinstance(valor, (int, float)):
        valor = str(valor)
    if not isinstance(valor, str):
        return None
    valor = valor.strip()[:VALOR_MAXIMO].strip()
    return valor or None


def dados_informados(campos: dict | None, extras: dict | None) -> dict | None:
    """O que vai para `lead_conversions.dados_informados`. `campos` e `extras`
    são os que a captura já validou (`higienizar`/`validar`/`mapear`)."""
    saida: dict = {}
    for chave in CAMPOS_INFORMADOS:
        texto = _texto((campos or {}).get(chave))
        if texto:
            saida[chave] = texto
    respostas: dict = {}
    for chave, valor in (extras or {}).items() if isinstance(extras, dict) else ():
        if len(respostas) >= EXTRAS_MAXIMO:
            break
        texto = _texto(valor)
        if isinstance(chave, str) and chave.strip() and texto:
            respostas[chave] = texto
    if respostas:
        saida[CHAVE_EXTRAS] = respostas
    if len(json.dumps(saida, ensure_ascii=False).encode()) > TETO_EM_BYTES:
        saida.pop(CHAVE_EXTRAS, None)
    return saida or None


def _comparavel(valor) -> str:
    """Caixa e espaços não contam: "empresa  x" é "Empresa X"."""
    return " ".join(str(valor or "").split()).casefold()


def _digitos(valor) -> str:
    return "".join(c for c in str(valor or "") if c.isdigit())


def _mesmo_telefone(informado, contato) -> bool:
    a, b = normalizar_celular_br(str(informado)), normalizar_celular_br(str(contato or ""))
    if a and b:
        return a == b
    return _digitos(informado) == _digitos(contato)


def divergencias(contato: dict, informados) -> list[dict]:
    """`[{chave, rotulo, valor}]` do que foi informado e difere do contato —
    colunas na ordem de `CAMPOS_INFORMADOS`, depois os extras (rótulo = a
    chave). Valor informado vazio não conta; contato vazio e valor informado,
    conta (é informação que o contato não tem).

    Os valores saem como texto cru: quem os põe num card ou numa nota passa
    por `growthhs.uma_linha` (vem de formulário público)."""
    if not isinstance(informados, dict):
        return []
    contato = contato or {}
    saida: list[dict] = []
    for chave in CAMPOS_INFORMADOS:
        valor = _texto(informados.get(chave))
        if not valor:
            continue
        if chave == "whatsapp":
            atual = contato.get("whatsapp") or contato.get("phone_normalized")
            igual = _mesmo_telefone(valor, atual)
        else:
            igual = _comparavel(valor) == _comparavel(contato.get(chave))
        if not igual:
            saida.append({"chave": chave, "rotulo": ROTULOS[chave], "valor": valor})
    extras = informados.get(CHAVE_EXTRAS)
    atuais = contato.get(CHAVE_EXTRAS)
    atuais = atuais if isinstance(atuais, dict) else {}
    if isinstance(extras, dict):
        for chave, valor in extras.items():
            valor = _texto(valor)
            if not isinstance(chave, str) or not valor:
                continue
            if _comparavel(valor) != _comparavel(atuais.get(chave)):
                saida.append({"chave": chave, "rotulo": chave, "valor": valor})
    return saida


def com_rotulos(lead: dict, conversao: dict | None,
                rotulos: dict[str, str] | None) -> tuple[dict, dict | None]:
    """Cópias do contato e da conversão com o rótulo do campo no lugar da
    chave nos `campos_extras` — para a NOTA ao vendedor ("Já faz testagem?:
    Sim", não "ja_faz_testagem: Sim"). Troca nos dois lados, senão o
    "Informou nesta conversão" (`divergencias`, que compara pelo MESMO nome)
    via diferença onde não há. As originais não mudam."""
    lead = {**lead, CHAVE_EXTRAS: trocar_chaves(dict(lead.get(CHAVE_EXTRAS) or {}), rotulos)}
    if conversao and isinstance(conversao.get("dados_informados"), dict):
        informados = conversao["dados_informados"]
        conversao = {**conversao, "dados_informados": {
            **informados, CHAVE_EXTRAS: trocar_chaves(informados.get(CHAVE_EXTRAS), rotulos)}}
    return lead, conversao
