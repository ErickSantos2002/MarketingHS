"""Regras de automação. Substitui a `automations-api`.

⚠️ **A ação de toda regra é o GrowthHS** — `create_in_growthhs`,
`move_stage_growthhs`, `block_growthhs`, e o trigger de validação do banco
(`validate_automation_rule_fields`) não aceita outra coisa. Aqui existe o
cadastro das regras e a prévia de quem elas pegariam; quem AVALIA e ENFILEIRA
é o gatilho `trg_automation_on_etiqueta_change` (migration 019,
`evaluate_automation_on_etiqueta`), disparado em TODO INSERT de lead e em
toda mudança de etiqueta, status ou pontuação num UPDATE — não esta rota (a
migration 019 tirou a lista de colunas do UPDATE; a saída cedo da função é
quem filtra). O worker (`app/crm/entrega.py`) é quem entrega de fato.

⚠️ `evaluate_automation_on_etiqueta` e o trigger `trg_automation_on_etiqueta_change`
tinham sido removidos no lote 0, porque um trigger que avalia e não tem ação
para chamar é trigger sem consumidor — e voltaram no lote 8D (decisão 1),
agora enfileirando em `crm_handoffs` em vez de chamar a Edge Function do
Supabase.
"""

import logging
from datetime import datetime, timedelta, timezone

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, admin_atual

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/automacoes", tags=["automacoes"])

COLUNAS = """
    id::text, name, is_active, priority, condition_type, condition_operator,
    condition_value, conditions, condition_logic, action_type, action_value,
    action_metadata, created_at::text, updated_at::text
"""

CASTS = {"conditions": "::jsonb", "action_metadata": "::jsonb"}


class Condicao(BaseModel):
    type: str
    operator: str
    value: str = ""


class RegraIn(BaseModel):
    """⚠️ Os valores de `condition_type`, `condition_operator` e `action_type`
    NÃO são validados aqui de propósito. Quem valida é o trigger
    `validate_automation_rule_fields`, e a mensagem dele é a mensagem útil.
    Repetir a lista neste arquivo criaria uma segunda cópia do vocabulário, e a
    que diverge é sempre a que ninguém está olhando.
    """
    name: str = Field(min_length=1, max_length=200)
    priority: int = 0
    condition_type: str
    condition_operator: str
    condition_value: str = ""
    conditions: list[Condicao] = Field(default_factory=list)
    condition_logic: str = "and"
    action_type: str
    action_value: str | None = None
    action_metadata: dict = Field(default_factory=dict)
    is_active: bool = True


class RegraPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    priority: int | None = None
    condition_type: str | None = None
    condition_operator: str | None = None
    condition_value: str | None = None
    conditions: list[Condicao] | None = None
    condition_logic: str | None = None
    action_type: str | None = None
    action_value: str | None = None
    action_metadata: dict | None = None
    is_active: bool | None = None


def _linha(l) -> dict:
    d = dict(l)
    d["conditions"] = d.get("conditions") or []
    d["action_metadata"] = d.get("action_metadata") or {}
    return d


@router.get("")
async def listar(usuario: Usuario = Depends(admin_atual)):
    """Prioridade decrescente: a primeira que bate é a que vale.

    ⚠️ `admin_atual` desde 01/10/2026: a política de `automation_rules` é
    admin-only, e com `usuario_atual` o não-admin levaria lista vazia, sem erro.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            f"SELECT {COLUNAS} FROM automation_rules ORDER BY priority DESC, created_at")
    return [_linha(l) for l in linhas]


# ---------------------------------------------------------------------------
# A prévia: quantos contatos a regra pegaria
# ---------------------------------------------------------------------------

# ⚠️ Este é o ÚNICO lugar onde o vocabulário de condição vira SQL. A origem
# tinha DUAS implementações que discordavam entre si: `queryMatchingLeads`
# (a contagem, em PostgREST) e `evaluateSingleCondition` (a avaliação em tempo
# real, em JavaScript). Elas divergiam no NULL — `.neq('status', x)` no Postgres
# descarta quem tem status nulo, enquanto `lead.status !== x` em JS aceita. O
# mesmo contato entrava numa conta e não na outra.
#
# Onde as duas divergiam, a escolha foi feita caso a caso e está aqui por
# escrito, para não virar mistério depois:
#
#   status/etiqueta com `is_not`  -> semântica do SQL: `<>` NÃO pega quem tem o
#       campo nulo. Contato sem status não "tem status diferente de X"; ele não
#       tem status. Era o que a contagem fazia, e é o que o usuário via.
#   score                         -> `coalesce(lead_score, 0)`: sem pontuação
#       conta como zero. Aqui as duas concordavam no espírito; a contagem é que
#       destoava, porque `.gt()` descartava o nulo em silêncio.
#
# A avaliação em tempo real volta no lote 5, aqui, servida por esta mesma
# função — não por uma segunda cópia no navegador.
#
# ⚠️ Valor SEMPRE em parâmetro, nunca concatenado. `build_segment_condition`, no
# banco, monta SQL com quote_literal; aqui não há motivo para repetir isso.
def _condicao_sql(c: Condicao, params: list) -> str | None:
    def p(valor) -> str:
        params.append(valor)
        return f"${len(params)}"

    tipo, op, val = c.type, c.operator, c.value

    if tipo == "status":
        return f"l.status = {p(val)}" if op == "is" else f"l.status <> {p(val)}"

    if tipo == "etiqueta":
        return f"l.etiqueta = {p(val)}" if op == "is" else f"l.etiqueta <> {p(val)}"

    if tipo == "tag":
        existe = (f"EXISTS (SELECT 1 FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id"
                  f" WHERE lt.lead_id = l.id AND t.name = {p(val)})")
        return existe if op == "contains" else f"NOT {existe}"

    if tipo == "score":
        try:
            n = int(val or 0)
        except ValueError:
            return None
        alvo = p(n)
        return (f"coalesce(l.lead_score, 0) > {alvo}" if op == "greater_than"
                else f"coalesce(l.lead_score, 0) < {alvo}")

    if tipo == "created_at":
        if op == "after":
            return f"l.created_at >= {p(val)}::timestamptz"
        if op == "before":
            # O dia inteiro conta: 'antes de 10/09' inclui 10/09 até 23:59:59,
            # como fazia a origem. Cortar à meia-noite perderia o dia todo.
            return f"l.created_at < ({p(val)}::date + 1)"
        if op == "between":
            partes = (val or "").split("|")
            if len(partes) != 2:
                return None
            return (f"l.created_at >= {p(partes[0])}::timestamptz"
                    f" AND l.created_at < ({p(partes[1])}::date + 1)")
        if op == "last_n_days":
            try:
                dias = int(val or 0)
            except ValueError:
                return None
            corte = datetime.now(timezone.utc) - timedelta(days=dias)
            return f"l.created_at >= {p(corte)}"
        return None

    return None


class PreviaIn(BaseModel):
    conditions: list[Condicao] = Field(default_factory=list)
    condition_logic: str = "and"
    # Compatibilidade com a regra de campo único, que ainda existe na tabela.
    condition_type: str | None = None
    condition_operator: str | None = None
    condition_value: str | None = None


@router.post("/previa")
async def previa(dados: PreviaIn, usuario: Usuario = Depends(admin_atual)):
    """Quantos contatos a regra pegaria, sem contar quem já está no GrowthHS.

    ⚠️ Só o TOTAL e uma amostra voltam. A origem trazia a lista inteira de leads
    para o navegador só para chamar `.length` — com a base crescida isso é a
    página inteira de contatos trafegando para mostrar um número.
    """
    condicoes = dados.conditions or []
    if not condicoes and dados.condition_type:
        condicoes = [Condicao(type=dados.condition_type,
                              operator=dados.condition_operator or "is",
                              value=dados.condition_value or "")]

    params: list = []
    partes = [s for s in (_condicao_sql(c, params) for c in condicoes) if s]
    if not partes:
        return {"total": 0, "amostra": []}

    juncao = " OR " if (dados.condition_logic or "and").lower() == "or" else " AND "
    onde = "(" + juncao.join(f"({s})" for s in partes) + ")"

    # ⚠️ Quem já está no GrowthHS fica de fora — a regra não o mandaria de
    # novo. `dnia_id` nulo NÃO é exclusão: contato sem identidade no ecossistema
    # nunca esteve no GrowthHS. `nexus_contact_id` (agendamento "dn.nexus") não
    # entra aqui — é outro produto (restrição global do 8D).
    fora_do_growthhs = """
        AND NOT EXISTS (
            SELECT 1 FROM ecosystem_identities ei
             WHERE l.dnia_id IS NOT NULL
               AND ei.dnia_id = l.dnia_id
               AND ei.growthhs_card_id IS NOT NULL
        )"""

    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        total = await conn.fetchval(
            f"SELECT count(*) FROM leads l WHERE {onde} {fora_do_growthhs}", *params)
        amostra = await conn.fetch(
            f"""SELECT l.id::text, l.nome, l.email, l.etiqueta
                  FROM leads l WHERE {onde} {fora_do_growthhs}
                 ORDER BY l.created_at DESC LIMIT 5""", *params)
    return {"total": int(total or 0), "amostra": [dict(a) for a in amostra]}


# ---------------------------------------------------------------------------
# Escrita — admin. ⚠️ Regra de automação decide quem vai para o comercial:
# `usuario_atual` aqui deixaria um `sem_papel` criar e apagar regra.
# ---------------------------------------------------------------------------

# A escrita mora aqui e a metade pública (routers/publico.py) chama estas duas
# funções. Duas cópias do INSERT divergiriam no dia em que uma coluna nova
# entrasse — e a que ninguém olha é a pública.

# Revisão final do 8D (I1, I4): o que o vocabulário do banco ACEITA mas a
# regra não consegue CUMPRIR. Recusado ao salvar — admin e `/publico` passam
# pelas duas funções abaixo —, porque uma regra "ativa" que nunca dispara (tag)
# ou que só gera falha (mover) é o modo de falhar calado que este lote existe
# para evitar. A prévia continua contando tag: é leitura.
MSG_TAG = ("Condição por tag ainda não dispara envio ao GrowthHS; use etiqueta, "
           "status, pontuação ou data de criação.")
MSG_MOVER = ("O GrowthHS ainda não tem rota para mover card de etapa — regra de "
             "mover fica disponível quando o contrato tiver a rota.")


def _recusar_o_que_nao_dispara(condition_type: str | None,
                               conditions: list[Condicao] | None,
                               action_type: str | None) -> None:
    """I1: o gatilho (019/020) não tem ramo 'tag' — nem a origem tinha — e
    adicionar tag grava `lead_tags`, não `leads`. I4: o contrato do GrowthHS
    não tem rota de mover card. Confere só o que veio: num PATCH, o campo
    ausente é o que já está gravado."""
    if condition_type == "tag" or any(c.type == "tag" for c in conditions or []):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, MSG_TAG)
    if action_type == "move_stage_growthhs":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, MSG_MOVER)


def _papel(user_id: str | None) -> dict:
    """A escrita é compartilhada com `/publico` (chave de API, sem usuário).
    Com usuário, a sessão é dele e o RLS vale; sem, é a máquina."""
    if user_id:
        return {"role": "authenticated", "user_id": user_id}
    return {"role": "service_role"}


async def inserir_regra(dados: RegraIn, user_id: str | None = None) -> str:
    _recusar_o_que_nao_dispara(dados.condition_type, dados.conditions, dados.action_type)
    campos = dados.model_dump()
    campos["conditions"] = [c.model_dump() for c in dados.conditions]
    colunas = list(campos)
    nomes = ", ".join(colunas)
    marcas = ", ".join(f"${i}{CASTS.get(c, '')}" for i, c in enumerate(colunas, 1))
    valores = [campos[c] for c in colunas]
    try:
        async with sessao(**_papel(user_id)) as conn:
            novo = await conn.fetchval(
                f"INSERT INTO automation_rules ({nomes}) VALUES ({marcas}) RETURNING id",
                *valores)
    except asyncpg.exceptions.RaiseError as exc:
        # A mensagem do trigger nomeia o campo inválido — é a útil.
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    return str(novo)


async def atualizar_regra(regra_id: str, dados: RegraPatch,
                          user_id: str | None = None) -> None:
    campos = dados.model_dump(exclude_unset=True)
    if not campos:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nada a atualizar.")
    _recusar_o_que_nao_dispara(dados.condition_type, dados.conditions, dados.action_type)
    if "conditions" in campos and dados.conditions is not None:
        campos["conditions"] = [c.model_dump() for c in dados.conditions]

    partes, valores = [], []
    for i, (coluna, valor) in enumerate(campos.items(), start=2):
        partes.append(f"{coluna} = ${i}{CASTS.get(coluna, '')}")
        valores.append(valor)

    try:
        async with sessao(**_papel(user_id)) as conn:
            r = await conn.execute(
                f"UPDATE automation_rules SET {', '.join(partes)} WHERE id = $1::uuid",
                regra_id, *valores)
    except asyncpg.exceptions.RaiseError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    if r.endswith(" 0"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Regra não encontrada.")


@router.post("", status_code=status.HTTP_201_CREATED)
async def criar(dados: RegraIn, usuario: Usuario = Depends(admin_atual)):
    return {"id": await inserir_regra(dados, usuario.id)}


@router.patch("/{regra_id}")
async def editar(regra_id: str, dados: RegraPatch,
                 usuario: Usuario = Depends(admin_atual)):
    await atualizar_regra(regra_id, dados, usuario.id)
    return {"id": regra_id}


@router.delete("/{regra_id}", status_code=status.HTTP_204_NO_CONTENT)
async def excluir(regra_id: str, usuario: Usuario = Depends(admin_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        r = await conn.execute(
            "DELETE FROM automation_rules WHERE id = $1::uuid", regra_id)
    if r.endswith(" 0"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Regra não encontrada.")
