"""Jornadas (fluxos). Substitui a `journeys-api`.

⚠️ O trabalho pesado está no banco e NÃO se reimplementa aqui. Dez funções de
jornada sobreviveram ao port e estão em produção há meses:
`journey_claim_due_runs`, `journey_wake_on_event`, `journey_enroll_event`,
`journey_enroll_segment`, `journey_node_metrics`, `validate_journey_graph`,
`evaluate_rules_for_lead`, `evaluate_segment_for_lead`, e os dois triggers.
Confira com `\\df` antes de escrever qualquer coisa parecida.

⚠️ `authenticated` + `admin_atual` desde 01/10/2026. `journeys` é admin-only
no RLS e `journey_runs` é SELECT admin — as rotas só LEEM execuções; quem as
escreve é o worker, como máquina. Teste: `tests/test_conversao_authenticated.py`.

Modo teste (prova do RD, 027): `allowed_emails` é a lista de e-mails para quem
o fluxo pode agir. Com ela preenchida, nenhum nó com efeito (e-mail, aviso,
handoff, webhook) age sobre quem está fora — ver `executor.contato_permitido`.
Teste: `tests/test_prova_jornadas.py`.
"""

import logging
import re

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from app.database import sessao
from app.dependencies import Usuario, admin_atual

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/jornadas", tags=["jornadas"])

COLUNAS = """
    j.id::text, j.name, j.description, j.status, j.entry_type, j.entry_config,
    j.reentry, j.reentry_cooldown_hours, j.entry_node_id, j.nodes,
    j.created_at::text, j.updated_at::text,
    to_jsonb(j)->'allowed_emails' AS allowed_emails
"""
# ⚠️ `to_jsonb(j)->'allowed_emails'`, e não `j.allowed_emails`: a coluna nasce
# na 027, e até ela ser aplicada a leitura devolve NULL ("sem modo teste") em
# vez de derrubar a listagem inteira com coluna inexistente. A escrita usa a
# coluna de verdade — sem a 027, gravar a lista falha, e é o certo.

# A contagem de execuções por estado, numa subconsulta lateral. A origem buscava
# TODOS os runs de TODOS os fluxos e agregava no navegador — funciona com
# dezenas de fluxos e para de funcionar sem avisar.
CONTAGEM_DE_EXECUCOES = """
    LEFT JOIN LATERAL (
        SELECT jsonb_build_object(
            'active',  count(*) FILTER (WHERE r.state = 'active'),
            'waiting', count(*) FILTER (WHERE r.state = 'waiting'),
            'done',    count(*) FILTER (WHERE r.state = 'done'),
            'failed',  count(*) FILTER (WHERE r.state = 'failed'),
            'exited',  count(*) FILTER (WHERE r.state = 'exited')
        ) AS numeros
          FROM journey_runs r WHERE r.journey_id = j.id
    ) e ON true
"""

ESTADOS = ("draft", "active", "paused", "archived")

MAXIMO_DE_PERMITIDOS = 50
_EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def _normalizar_permitidos(valor: list[str] | None) -> list[str] | None:
    """Aparado, minúsculo, sem repetidos (na ordem em que vieram), formato de
    e-mail, no máximo 50. `[]` vira `None` — o admin apagou a lista de
    propósito, e só ASSIM ela vira "sem modo teste" (Review Focus 4)."""
    if valor is None:
        return None
    lista: list[str] = []
    for bruto in valor:
        email = str(bruto).strip().lower()
        if not _EMAIL.match(email):
            raise ValueError(f"e-mail inválido na lista do modo teste: {bruto!r}")
        if email not in lista:
            lista.append(email)
    if len(lista) > MAXIMO_DE_PERMITIDOS:
        raise ValueError(f"no máximo {MAXIMO_DE_PERMITIDOS} e-mails no modo teste")
    return lista or None


class JornadaIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    entry_type: str = Field(pattern="^(segment|event)$")
    entry_config: dict = Field(default_factory=dict)
    reentry: str = Field(default="once", pattern="^(once|allowed)$")
    reentry_cooldown_hours: int | None = Field(default=None, gt=0)
    entry_node_id: str | None = None
    nodes: list[dict] = Field(default_factory=list)
    allowed_emails: list[str] | None = None

    @field_validator("allowed_emails")
    @classmethod
    def _permitidos(cls, v):
        return _normalizar_permitidos(v)


class JornadaPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    status: str | None = Field(default=None, pattern="^(draft|active|paused|archived)$")
    entry_type: str | None = Field(default=None, pattern="^(segment|event)$")
    entry_config: dict | None = None
    reentry: str | None = Field(default=None, pattern="^(once|allowed)$")
    reentry_cooldown_hours: int | None = Field(default=None, gt=0)
    entry_node_id: str | None = None
    nodes: list[dict] | None = None
    allowed_emails: list[str] | None = None

    @field_validator("allowed_emails")
    @classmethod
    def _permitidos(cls, v):
        return _normalizar_permitidos(v)


CASTS = {"entry_config": "::jsonb", "nodes": "::jsonb", "allowed_emails": "::text[]"}


def _conferir_webhooks(nos: list[dict] | None) -> None:
    """A forma da URL de cada nó `webhook` (sem DNS — o worker resolve na hora
    de mandar): o admin vê "recusado" ao salvar, não dias depois na saída."""
    from app.jornadas.saidas import DestinoRecusado, conferir_forma_da_url

    for no in nos or []:
        if isinstance(no, dict) and no.get("type") == "webhook":
            try:
                conferir_forma_da_url(str((no.get("config") or {}).get("url") or ""))
            except DestinoRecusado as e:
                raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                    f"nó {no.get('id')}: {e}") from None


def _conferir_avisos_no_modo_teste(lista, nos) -> None:
    """Antimeta nº 1: com modo teste ligado, quem RECEBE o aviso por e-mail
    também tem de estar na lista. Sem modo teste, qualquer endereço (o aviso
    real vai a um endereço de fora da empresa)."""
    from app.jornadas import modo_teste

    if not modo_teste.ligado(lista):
        return
    for no in nos or []:
        if not (isinstance(no, dict) and no.get("type") == "notify_email"):
            continue
        fora = [str(e).strip() for e in ((no.get("config") or {}).get("emails") or [])
                if str(e).strip() and not modo_teste.na_lista(lista, str(e))]
        if fora:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"nó {no.get('id')}: com o modo teste ligado, o aviso só pode ir para "
                f"e-mails da lista — fora dela: {', '.join(fora)}")


DIAS_MAXIMOS = 365


def _inteiro(v) -> bool:
    # `True` é `int` em Python — e "esperar True dias" não é config.
    return isinstance(v, int) and not isinstance(v, bool)


def _normalizar_delays(nos: list[dict] | None) -> list[dict] | None:
    """Confere a config de cada nó `delay` e devolve os nós normalizados.

    - `days` (inteiro 1–365) com `dias_uteis` (bool): espera em dias, úteis ou
      corridos (frente jornada-rd, molde da Nutrição do RD);
    - sem `days`: `minutes` > 0, como sempre foi.

    ⚠️ Com `days`, grava `minutes = days × 1440`: o trigger
    `validate_journey_graph` (028) exige `config.minutes > 0` em todo delay, e
    trocar o trigger pedia migration. O executor ignora `minutes` quando há
    `days` (`executor.instante_de_despertar`).
    """
    if nos is None:
        return None
    saida = []
    for no in nos:
        if not (isinstance(no, dict) and no.get("type") == "delay"):
            saida.append(no)
            continue
        cfg = dict(no.get("config") or {})
        nome = f"nó {no.get('id')} (esperar)"
        dias, uteis = cfg.get("days"), cfg.get("dias_uteis")
        if uteis is not None and not isinstance(uteis, bool):
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                f"{nome}: \"só dias úteis\" precisa ser verdadeiro ou falso.")
        if dias is not None:
            if not _inteiro(dias) or not 1 <= dias <= DIAS_MAXIMOS:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    f"{nome}: a espera em dias precisa ser um número inteiro de 1 a "
                    f"{DIAS_MAXIMOS}.")
            cfg["minutes"] = dias * 1440
        else:
            if uteis is True:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    f"{nome}: \"só dias úteis\" só vale com a espera em dias.")
            minutos = cfg.get("minutes")
            if not _inteiro(minutos) or minutos <= 0:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    f"{nome}: informe a espera em minutos (maior que zero) ou em dias.")
        saida.append({**no, "config": cfg})
    return saida


async def _normalizar_saida(conn, entry_config: dict | None) -> dict | None:
    """`entry_config.saida_status`: lista de status do contato que encerram a
    jornada (molde da saída "Venda" do RD). Cada item precisa existir em
    `lead_statuses` e volta com o nome canônico; desconhecido é 400 com a
    lista do que vale. Ausente ou `[]` = sem saída (o de antes)."""
    if entry_config is None or "saida_status" not in entry_config:
        return entry_config
    lista = entry_config["saida_status"]
    if not isinstance(lista, list) or not all(
            isinstance(s, str) and s.strip() for s in lista):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "\"Sair da jornada quando o status for…\" precisa ser uma lista de status.")
    if not lista:
        return entry_config
    linhas = await conn.fetch("SELECT name FROM lead_statuses ORDER BY sort_order")
    por_nome = {l["name"].lower(): l["name"] for l in linhas}
    canonica, desconhecidos = [], []
    for bruto in lista:
        nome = por_nome.get(bruto.strip().lower())
        if nome is None:
            desconhecidos.append(bruto.strip())
        elif nome not in canonica:
            canonica.append(nome)
    if desconhecidos:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Status desconhecido em \"sair da jornada\": "
            + ", ".join(repr(d) for d in desconhecidos)
            + ". Os que existem são: " + ", ".join(l["name"] for l in linhas) + ".")
    return {**entry_config, "saida_status": canonica}


def _sem_execucoes() -> dict:
    return {"active": 0, "waiting": 0, "done": 0, "failed": 0, "exited": 0}


@router.get("")
async def listar(usuario: Usuario = Depends(admin_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            f"""SELECT {COLUNAS}, e.numeros AS runs
                  FROM journeys j {CONTAGEM_DE_EXECUCOES}
                 ORDER BY j.created_at DESC""")
    return {"data": [{**dict(l), "runs": l["runs"] or _sem_execucoes()}
                     for l in linhas]}


@router.get("/{jornada_id}")
async def detalhe(jornada_id: str, usuario: Usuario = Depends(admin_atual)):
    """O fluxo, as métricas por nó e a contagem de execuções.

    ⚠️ As métricas saem de `journey_node_metrics`, que já existe no banco. Não
    recalcule por nó aqui: seria a segunda implementação da mesma conta, e a que
    diverge é sempre a que ninguém está olhando.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            f"""SELECT {COLUNAS}, e.numeros AS runs
                  FROM journeys j {CONTAGEM_DE_EXECUCOES}
                 WHERE j.id = $1::uuid""", jornada_id)
        if linha is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Fluxo não encontrado.")
        metricas = await conn.fetchval(
            "SELECT journey_node_metrics($1::uuid)", jornada_id)
    d = dict(linha)
    runs = d.pop("runs", None) or _sem_execucoes()
    return {"data": d, "metrics": metricas or {}, "runs": runs}


@router.post("", status_code=status.HTTP_201_CREATED)
async def criar(dados: JornadaIn, usuario: Usuario = Depends(admin_atual)):
    """Nasce sempre em `draft` — o status não vem do corpo.

    ⚠️ O trigger `fn_journeys_validate` recusa grafo inválido ou cíclico com uma
    mensagem que EXPLICA o que está errado no fluxo. Ela é a mensagem de erro do
    usuário; mascarar por um genérico deixaria quem monta o fluxo sem saber
    onde errou.
    """
    _conferir_webhooks(dados.nodes)
    _conferir_avisos_no_modo_teste(dados.allowed_emails, dados.nodes)
    campos = dados.model_dump()
    campos["nodes"] = _normalizar_delays(campos["nodes"])
    if campos["allowed_emails"] is None:
        # Sem lista, a coluna fica fora do INSERT (o NULL do DEFAULT vale): a
        # criação de jornada sem modo teste não depende da 027 estar aplicada.
        campos.pop("allowed_emails")
    if campos.pop("reentry_cooldown_hours") is None:
        # Sem valor explícito, o DEFAULT 168 (7 dias) da coluna assume.
        colunas = list(campos)
    else:
        campos["reentry_cooldown_hours"] = dados.reentry_cooldown_hours
        colunas = list(campos)

    nomes = ", ".join(colunas)
    marcas = ", ".join(f"${i}{CASTS.get(c, '')}" for i, c in enumerate(colunas, 1))
    try:
        async with sessao(role="authenticated", user_id=usuario.id) as conn:
            campos["entry_config"] = await _normalizar_saida(conn, campos["entry_config"])
            novo = await conn.fetchval(
                f"INSERT INTO journeys ({nomes}, status) "
                f"VALUES ({marcas}, 'draft') RETURNING id",
                *[campos[c] for c in colunas])
    except asyncpg.exceptions.RaiseError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    return {"success": True, "journey": {"id": str(novo)}}


@router.patch("/{jornada_id}")
async def editar(jornada_id: str, dados: JornadaPatch,
                 usuario: Usuario = Depends(admin_atual)):
    """PATCH parcial. A validação do grafo continua sendo do trigger."""
    campos = dados.model_dump(exclude_unset=True)
    if not campos:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nada a atualizar.")
    _conferir_webhooks(campos.get("nodes"))
    if "nodes" in campos:
        campos["nodes"] = _normalizar_delays(campos["nodes"])

    try:
        async with sessao(role="authenticated", user_id=usuario.id) as conn:
            if "entry_config" in campos:
                campos["entry_config"] = await _normalizar_saida(conn, campos["entry_config"])
            partes, valores = [], []
            for i, (coluna, valor) in enumerate(campos.items(), start=2):
                partes.append(f"{coluna} = ${i}{CASTS.get(coluna, '')}")
                valores.append(valor)
            if "nodes" in campos or "allowed_emails" in campos:
                # A lista e os nós EM VIGOR depois do PATCH: o que veio no
                # corpo, e o resto do que está gravado.
                atual = await conn.fetchrow(
                    """SELECT to_jsonb(j)->'allowed_emails' AS lista, j.nodes
                         FROM journeys j WHERE j.id = $1::uuid FOR UPDATE""", jornada_id)
                if atual is not None:
                    _conferir_avisos_no_modo_teste(
                        campos["allowed_emails"] if "allowed_emails" in campos
                        else atual["lista"],
                        campos["nodes"] if "nodes" in campos else atual["nodes"])
            r = await conn.execute(
                f"""UPDATE journeys SET {', '.join(partes)}, updated_at = now()
                     WHERE id = $1::uuid""",
                jornada_id, *valores)
    except asyncpg.exceptions.RaiseError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    if r.endswith(" 0"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Fluxo não encontrado.")
    return {"id": jornada_id}


@router.delete("/{jornada_id}", status_code=status.HTTP_204_NO_CONTENT)
async def excluir(jornada_id: str, usuario: Usuario = Depends(admin_atual)):
    """⚠️ `guard_journey_delete` é mais restritivo que as outras guardas do
    projeto: só apaga fluxo em `draft` E sem NENHUMA execução, mesmo antiga.

        status != 'draft'          -> 'fluxo % nao pode ser excluido (status %)'
        existe journey_runs        -> 'fluxo % ja possui execucoes'

    A mensagem do banco vira 409, como em segmento e campanha.
    """
    try:
        async with sessao(role="authenticated", user_id=usuario.id) as conn:
            r = await conn.execute(
                "DELETE FROM journeys WHERE id = $1::uuid", jornada_id)
    except asyncpg.exceptions.RaiseError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc))
    if r.endswith(" 0"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Fluxo não encontrado.")


@router.get("/{jornada_id}/execucoes")
async def execucoes(jornada_id: str, usuario: Usuario = Depends(admin_atual)):
    """As execuções do fluxo, com o contato junto."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        existe = await conn.fetchval(
            "SELECT 1 FROM journeys WHERE id = $1::uuid", jornada_id)
        if existe is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Fluxo não encontrado.")
        linhas = await conn.fetch(
            """SELECT r.id::text, r.lead_id::text, r.current_node_id, r.state,
                      r.wakeup_at::text, r.waiting_event, r.entered_at::text,
                      r.updated_at::text,
                      COALESCE(l.nome, '-') AS lead_name,
                      COALESCE(l.email, '-') AS lead_email
                 FROM journey_runs r
                 LEFT JOIN leads l ON l.id = r.lead_id
                WHERE r.journey_id = $1::uuid
                ORDER BY r.updated_at DESC
                LIMIT 200""", jornada_id)
    return [dict(l) for l in linhas]
