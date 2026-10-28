"""O agendamento do lado do lead: rascunho, horários e confirmação.

Spec 2026-10-28-agendamento-reuniao-design.md, "Corrida" e "O fluxo". O
desenho:

- **rascunho** (etapa 1 do modal): o contato já fica guardado aqui — quem
  desiste no meio vira lead comum depois (`virar_lead_comum`, pela varredura
  do worker ou pela própria rota);
- **horários**: a agenda real dos vendedores da roleta (ou só do vendedor do
  card aberto do lead) no GrowthHS, menos as reservas do próprio MarketingHS
  que ainda não viraram evento no Outlook;
- **confirmar**: (1) sem rede, confere rascunho, "já tem" e grade; (2) rede,
  pergunta a agenda DAQUELE horário de novo; (3) numa transação, trava a
  roleta (`FOR UPDATE`), desconta as reservas, escolhe e grava. A garantia
  final é do banco: `uniq_reuniao_vendedor_inicio` e
  `uniq_reuniao_email_futura` (migration 036).

⚠️ Rede nunca dentro de transação (padrão `entrega.py`).
"""

import json
import logging
import secrets
from datetime import datetime, timedelta, timezone

import asyncpg

from app.agendamento.config import ConfigAgendamento, ler_config, pode_agendar
from app.agendamento.horarios import (escolher, fila_depois, grade, inicios_possiveis,
                                      livres_em, periodo)
from app.captura.registro import Consentimento, Origem, registrar_captura
from app.crm import growthhs
from app.database import sessao

logger = logging.getLogger(__name__)

UTC = timezone.utc
VIVAS = ("reservada", "criada", "falhou")
INDISPONIVEL = {"indisponivel": True}


class TokenDesconhecido(Exception):
    """Token que não existe (ou rascunho que já virou lead comum/abandonado,
    quando a operação exige rascunho). A rota responde 404 e nada mais."""


class HorarioInvalido(ValueError):
    """O início pedido não está na grade da página (fora do expediente, da
    antecedência ou da janela)."""


def normalizar_email(email: str) -> str:
    return (email or "").strip().lower()


def iso_z(data: datetime) -> str:
    return data.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _dados(valor) -> dict:
    if isinstance(valor, dict):
        return valor
    if isinstance(valor, str):
        try:
            return json.loads(valor)
        except ValueError:
            return {}
    return {}


def mesclar(antigo: dict, novo: dict) -> dict:
    """`colunas` e `extras` mesclam chave a chave (o novo vence); o resto o
    novo substitui."""
    saida = dict(antigo or {})
    for chave, valor in (novo or {}).items():
        if chave in ("colunas", "extras") and isinstance(valor, dict):
            saida[chave] = {**(saida.get(chave) or {}), **valor}
        else:
            saida[chave] = valor
    return saida


def respostas(dados: dict) -> dict:
    """Tudo que o lead respondeu, colunas e extras juntos."""
    return {**(dados.get("extras") or {}), **(dados.get("colunas") or {})}


async def _config_da_pagina(conn, page_slug: str) -> ConfigAgendamento:
    config = await conn.fetchval(
        "SELECT config FROM pages WHERE slug = $1 AND status = 'active'", page_slug)
    return ler_config(_dados(config))


async def _ler(conn, token: str, *, travar: bool = False):
    linha = await conn.fetchrow(
        "SELECT * FROM reuniao_agendamentos WHERE token = $1"
        + (" FOR UPDATE" if travar else ""), token)
    if linha is None:
        raise TokenDesconhecido(token)
    return linha


def _outro_ambiente(cliente, ag) -> bool:
    """O GrowthHS ativo não é o do rascunho (trocaram de ambiente no meio):
    os ids da roleta seriam de outro CRM."""
    ambiente = getattr(getattr(cliente, "cfg", None), "ambiente", None)
    return ambiente is not None and ambiente != ag["ambiente"]


# ── Rascunho ─────────────────────────────────────────────────────────────────

async def criar_rascunho(conn, *, page_slug: str, email: str, dados: dict,
                         ambiente: str) -> str:
    token = secrets.token_urlsafe(24)
    await conn.execute(
        """INSERT INTO reuniao_agendamentos (token, ambiente, page_slug, email, dados)
           VALUES ($1, $2, $3, $4, $5::jsonb)""",
        token, ambiente, page_slug, normalizar_email(email), dados or {})
    return token


async def completar_rascunho(conn, token: str, dados: dict) -> dict:
    ag = await _ler(conn, token, travar=True)
    if ag["status"] != "rascunho":
        raise TokenDesconhecido(token)
    juntos = mesclar(_dados(ag["dados"]), dados)
    await conn.execute(
        "UPDATE reuniao_agendamentos SET dados = $2::jsonb, atualizado_em = now() "
        "WHERE token = $1", token, juntos)
    cfg = await _config_da_pagina(conn, ag["page_slug"])
    return {"pode_agendar": pode_agendar(cfg, respostas(juntos))}


# ── Registro do lead ─────────────────────────────────────────────────────────

async def _registrar_lead(conn, ag, *, agendamento: bool) -> str:
    """A captura do lead com o que o rascunho guardou (validado nas rotas)."""
    dados = _dados(ag["dados"])
    origem = dados.get("origem") or {}
    c = dados.get("consentimento")
    consentimento = Consentimento(**c) if isinstance(c, dict) else None
    return await registrar_captura(
        conn, email=ag["email"], campos=dict(dados.get("colunas") or {}),
        extras=dict(dados.get("extras") or {}),
        origem=Origem(page_slug=ag["page_slug"], visitor_id=origem.get("visitor_id"),
                      canal=origem.get("canal"), page_url=origem.get("page_url")),
        session_id=dados.get("session_id"), consentimento=consentimento,
        tags=list(dados.get("tags") or []), agendamento=agendamento)


async def virar_lead_comum(token: str) -> None:
    """O rascunho vira lead comum (jornada normal, roleta do GrowthHS).
    Idempotente: só age sobre `rascunho`."""
    async with sessao(role="service_role") as conn:
        ag = await _ler(conn, token, travar=True)
        if ag["status"] != "rascunho":
            return
        lead_id = await _registrar_lead(conn, ag, agendamento=False)
        await conn.execute(
            """UPDATE reuniao_agendamentos
                  SET status = 'lead_comum', lead_id = $2::uuid, atualizado_em = now()
                WHERE token = $1""", token, lead_id)


# ── Horários ─────────────────────────────────────────────────────────────────

async def _candidatos(conn, ag) -> list[dict]:
    """A roleta do ambiente, na ordem da vez."""
    return [dict(r) for r in await conn.fetch(
        "SELECT user_id, nome, email FROM reuniao_roleta WHERE ambiente = $1 "
        "ORDER BY posicao, user_id", ag["ambiente"])]


async def _reservas_proprias(conn, ambiente: str, ids: list[int], inicio: datetime,
                             fim: datetime, *, exceto: str | None = None):
    return await conn.fetch(
        """SELECT vendedor_id, inicio, fim FROM reuniao_agendamentos
            WHERE ambiente = $1 AND status = ANY($2::text[])
              AND vendedor_id = ANY($3::bigint[])
              AND inicio < $5 AND fim > $4
              AND token IS DISTINCT FROM $6""",
        ambiente, list(VIVAS), ids, inicio, fim, exceto)


async def _card_do_lead(cliente, email: str) -> dict | None:
    pessoa = await cliente.buscar_pessoa(email)
    if pessoa is None:
        return None
    return await cliente.card_aberto(pessoa)


async def horarios(token: str, *, agora: datetime, cliente) -> dict:
    async with sessao(role="service_role") as conn:
        ag = await _ler(conn, token)
        if ag["status"] != "rascunho":
            raise TokenDesconhecido(token)
        cfg = await _config_da_pagina(conn, ag["page_slug"])
        roleta = await _candidatos(conn, ag)
    if not pode_agendar(cfg, respostas(_dados(ag["dados"]))) or _outro_ambiente(cliente, ag):
        return dict(INDISPONIVEL)
    janela = periodo(cfg, agora)
    if janela is None:
        return dict(INDISPONIVEL)

    try:
        card = await _card_do_lead(cliente, ag["email"])
        if card and card.get("assigned_to_id") is not None:
            ids = [int(card["assigned_to_id"])]
        else:
            ids = [int(r["user_id"]) for r in roleta]
        if not ids:
            return dict(INDISPONIVEL)
        ocupado = await cliente.agenda(ids, *janela)
    except (growthhs.ErroTransitorio, growthhs.ErroDefinitivo) as erro:
        logger.warning("[agendamento] horários indisponíveis (GrowthHS): %s", erro)
        return dict(INDISPONIVEL)

    async with sessao(role="service_role") as conn:
        # O card aberto (e o vendedor dele) fica no rascunho: é com ele que a
        # confirmação marca a reunião. Recalculado a cada abertura da etapa 3.
        await conn.execute(
            """UPDATE reuniao_agendamentos
                  SET card_existente_id = $2, vendedor_id = $3, atualizado_em = now()
                WHERE token = $1 AND status = 'rascunho'""",
            token, card["id"] if card else None,
            card.get("assigned_to_id") if card else None)
        for r in await _reservas_proprias(conn, ag["ambiente"], ids, *janela,
                                          exceto=token):
            blocos = ocupado.get(int(r["vendedor_id"]))
            if blocos is not None:
                blocos.append((r["inicio"], r["fim"]))

    dias = grade(cfg, agora, ocupado)
    if not dias:
        return dict(INDISPONIVEL)
    return {"dias": [{"data": d.isoformat(), "horarios": [iso_z(i) for i in lista]}
                     for d, lista in sorted(dias.items())],
            "duracao_min": cfg.duracao_min}


# ── Confirmação ──────────────────────────────────────────────────────────────

async def _abandonar(conn, token: str) -> None:
    """M2: o rascunho que esbarrou na reserva de OUTRO token com o mesmo
    e-mail sai de cena — mas sem perder o que o lead respondeu nele: a
    captura é registrada COM a marca de agendamento (os dados vão para o
    contato e a conversão, e a jornada de handoff não matricula — o card é
    o da outra reserva). A varredura não o pega depois."""
    ag = await conn.fetchrow(
        "SELECT * FROM reuniao_agendamentos WHERE token = $1 AND status = 'rascunho' "
        "FOR UPDATE", token)
    if ag is None:
        return
    lead_id = None
    try:
        async with conn.transaction():
            lead_id = await _registrar_lead(conn, ag, agendamento=True)
    except Exception:  # noqa: BLE001 — a resposta ao lead não depende disto
        logger.exception("[agendamento] rascunho %s: captura do ja_tem não registrada",
                         ag["id"])
    await conn.execute(
        """UPDATE reuniao_agendamentos SET status = 'abandonada', lead_id = $2::uuid,
                  atualizado_em = now()
            WHERE token = $1""", token, lead_id)


def _ja_tem(_linha=None) -> dict:
    """⚠️ Sem dia nem hora (revisão de segurança, 28/10): o e-mail digitado
    não é verificado — devolver o horário da reserva de OUTRO token deixaria
    qualquer um descobrir quando é a reunião de quem tem aquele e-mail. O
    convite, com dia, hora e link, chega no e-mail do dono."""
    return {"status": "ja_tem"}


async def _outra_viva(conn, ag):
    return await conn.fetchrow(
        """SELECT inicio, fim FROM reuniao_agendamentos
            WHERE ambiente = $1 AND email = $2 AND status = ANY($3::text[])
              AND token <> $4
            ORDER BY inicio LIMIT 1""",
        ag["ambiente"], ag["email"], list(VIVAS), ag["token"])


async def confirmar(token: str, inicio: datetime, *, agora: datetime, cliente) -> dict:
    if inicio.tzinfo is None:
        raise HorarioInvalido("início sem fuso")
    inicio = inicio.astimezone(UTC)

    # (1) Sem rede: o rascunho, "já tem", a grade.
    async with sessao(role="service_role") as conn:
        ag = await _ler(conn, token)
        if ag["status"] in VIVAS:
            return _ja_tem(ag)  # clique duplo: a mesma reserva
        if ag["status"] != "rascunho":
            raise TokenDesconhecido(token)
        # M1: toda chamada pública conta como mexida — a varredura só
        # abandona quem parou de mexer, inclusive quem leva "ocupado".
        await conn.execute(
            "UPDATE reuniao_agendamentos SET atualizado_em = now() WHERE token = $1", token)
        outra = await _outra_viva(conn, ag)
        if outra is not None:
            await _abandonar(conn, token)
            return _ja_tem(outra)
        cfg = await _config_da_pagina(conn, ag["page_slug"])
        roleta = await _candidatos(conn, ag)
    if not pode_agendar(cfg, respostas(_dados(ag["dados"]))):
        raise TokenDesconhecido(token)
    if inicio not in {i for lista in inicios_possiveis(cfg, agora).values() for i in lista}:
        raise HorarioInvalido("horário fora da grade")
    fim = inicio + timedelta(minutes=cfg.duracao_min)

    fixo = ag["vendedor_id"] if ag["card_existente_id"] is not None else None
    ids = [int(fixo)] if fixo is not None else [int(r["user_id"]) for r in roleta]
    if not ids or _outro_ambiente(cliente, ag):
        return {"status": "indisponivel"}

    # (2) Rede: a agenda DAQUELE horário, agora.
    nomes = {int(r["user_id"]): (r["nome"], r["email"]) for r in roleta}
    try:
        ocupado = await cliente.agenda(ids, inicio, fim)
        if fixo is not None and int(fixo) not in nomes:
            for v in await cliente.vendedores():
                if v["id"] == int(fixo):
                    nomes[int(fixo)] = (v["nome"], v["email"])
    except (growthhs.ErroTransitorio, growthhs.ErroDefinitivo) as erro:
        logger.warning("[agendamento] confirmação sem agenda (GrowthHS): %s", erro)
        return {"status": "indisponivel"}
    livres = livres_em(ocupado, inicio, fim)

    # (3) Transação: trava, desconta, escolhe, grava.
    try:
        async with sessao(role="service_role") as conn:
            # I1: UMA confirmação por ambiente de cada vez, nos dois caminhos
            # (roleta e vendedor fixo do card aberto). Sem isto, duas
            # confirmações de horários que se SOBREPÕEM sem o mesmo início
            # (12:00 e 12:30, 60 min) liam as reservas ao mesmo tempo e
            # passavam as duas — o índice único só pega início idêntico.
            await conn.execute("SELECT pg_advisory_xact_lock(hashtext('reuniao:' || $1))",
                               ag["ambiente"])
            ag = await _ler(conn, token, travar=True)
            if ag["status"] in VIVAS:
                return _ja_tem(ag)
            if ag["status"] != "rascunho":
                raise TokenDesconhecido(token)
            if fixo is not None:
                fila = [int(fixo)]
            else:
                fila = [int(r["user_id"]) for r in await conn.fetch(
                    "SELECT user_id FROM reuniao_roleta WHERE ambiente = $1 "
                    "ORDER BY posicao, user_id FOR UPDATE", ag["ambiente"])]
            tomados = {int(r["vendedor_id"]) for r in await _reservas_proprias(
                conn, ag["ambiente"], fila, inicio, fim, exceto=token)}
            escolhido = escolher(fila, livres - tomados)
            if escolhido is None:
                return {"status": "ocupado"}
            nome, email = nomes.get(escolhido, (None, None))
            await conn.execute(
                """UPDATE reuniao_agendamentos
                      SET status = 'reservada', vendedor_id = $2, vendedor_nome = $3,
                          vendedor_email = $4, inicio = $5, fim = $6,
                          -- M3: a fila só pega depois do registro do lead.
                          visivel_em = now() + interval '30 seconds',
                          atualizado_em = now()
                    WHERE token = $1""",
                token, escolhido, nome, email, inicio, fim)
            if fixo is None:
                for posicao, uid in enumerate(fila_depois(fila, escolhido)):
                    await conn.execute(
                        "UPDATE reuniao_roleta SET posicao = $3 "
                        "WHERE ambiente = $1 AND user_id = $2",
                        ag["ambiente"], uid, posicao)
    except asyncpg.UniqueViolationError as erro:
        if erro.constraint_name == "uniq_reuniao_email_futura":
            async with sessao(role="service_role") as conn:
                outra = await _outra_viva(conn, ag)
                if outra is not None:
                    await _abandonar(conn, token)
            if outra is not None:
                return _ja_tem(outra)
        return {"status": "ocupado"}

    # Depois do commit: o lead, marcado (não entra na jornada de handoff).
    try:
        async with sessao(role="service_role") as conn:
            ag = await _ler(conn, token)
            lead_id = await _registrar_lead(conn, ag, agendamento=True)
            await conn.execute(
                "UPDATE reuniao_agendamentos SET lead_id = $2::uuid WHERE token = $1",
                token, lead_id)
    except Exception:  # noqa: BLE001 — a reserva vale; a execução registra de novo
        # ⚠️ O id da linha, nunca o token (o token é a credencial do rascunho).
        logger.exception("[agendamento] reserva %s gravada, lead não registrado", ag["id"])

    # ⚠️ Sem `vendedor_nome` na resposta pública (revisão de segurança, 28/10):
    # diria qual vendedor atende aquele cliente a quem não provou ser o dono do
    # e-mail. O nome fica no banco e no e-mail ao vendedor.
    return {"status": "reservada", "inicio": iso_z(inicio), "fim": iso_z(fim)}
