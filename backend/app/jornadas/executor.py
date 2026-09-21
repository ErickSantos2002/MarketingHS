"""O executor de nós de jornada. Porte de `journey-worker/index.ts`.

⚠️ O trabalho pesado NÃO está aqui. `journey_claim_due_runs` reivindica os runs
com lease e `FOR UPDATE SKIP LOCKED`; `journey_wake_on_event` acorda quem
espera; `evaluate_rules_for_lead` e `evaluate_segment_for_lead` resolvem as
condicionais. Este módulo é a máquina de estados que costura tudo.

⚠️ Duas invariantes que não se afrouxam:

1. **Toda escrita num run passa por `gravar_run`**, que só grava se o
   `lock_token` ainda for o nosso. Sem isso, dois workers avançam o mesmo
   contato por caminhos diferentes do fluxo — e o contato recebe os dois.
2. **A espera é ESCOPADA POR NÓ.** Um `waiting_since` solto no contexto não
   basta: num grafo `wait W1 -> delay -> wait W2`, o contexto de W1 sobrevive
   até W2, e sem o escopo a guarda de W2 leria aquilo como timeout genuíno —
   mandando o e-mail de "não clicou" em segundos, sem nunca dar ao contato os
   dias de espera configurados.
"""

import json
import logging
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

MAX_PASSOS_POR_RUN = 50
MAX_TENTATIVAS_POR_NO = 3
RETENTATIVA_MINUTOS = 5
TIMEOUT_PADRAO_MINUTOS = 1440


def _agora() -> datetime:
    return datetime.now(timezone.utc)


async def registrar_passo(conn, run: dict, no: dict, resultado: str,
                          detalhe: dict | None = None) -> None:
    """Uma linha em `journey_step_log`. Nunca derruba a execução do run.

    ⚠️ `journey_node_metrics` conta `DISTINCT run_id`, então registrar
    "entered" de novo para um nó que já tem o seu não infla a métrica — só
    garante que TODO nó tenha pelo menos um.
    """
    try:
        await conn.execute(
            """INSERT INTO journey_step_log
                   (run_id, journey_id, lead_id, node_id, node_type, result, detail)
               VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::jsonb)""",
            run["run_id"], run["journey_id"], run["lead_id"],
            no.get("id"), no.get("type"), resultado, detalhe or {})
    except Exception:  # noqa: BLE001
        logger.exception("falha ao registrar passo do run %s", run["run_id"])


async def gravar_run(conn, run: dict, patch: dict) -> bool:
    """⚠️ O fencing token. Só grava se o `lock_token` ainda for o nosso.

    Devolve False quando o lease expirou e outro worker assumiu — quem perdeu
    para de trabalhar naquele run. Sem isto, dois workers avançam o mesmo
    contato por caminhos diferentes do fluxo.
    """
    casts = {"context": "::jsonb", "wakeup_at": "::timestamptz"}
    partes, valores = [], []
    for i, (coluna, valor) in enumerate(patch.items(), start=3):
        partes.append(f"{coluna} = ${i}{casts.get(coluna, '')}")
        valores.append(valor)
    r = await conn.execute(
        f"""UPDATE journey_runs SET {', '.join(partes)}, updated_at = now()
             WHERE id = $1::uuid AND lock_token = $2::uuid""",
        run["run_id"], run["lock_token"], *valores)
    if r.endswith(" 0"):
        logger.warning("lease perdido no run %s — escrita descartada", run["run_id"])
        return False
    return True


async def _aplicar_tag(conn, lead_id: str, bruta: str) -> None:
    """Mesma normalização do `apply-lead-tag`. A tag nasce se não existir.

    ⚠️ O vínculo tem PK (lead_id, tag_id), então reexecutar o nó é inofensivo
    por construção.
    """
    nome = (bruta or "").lstrip("/").strip().lower()
    if not nome:
        raise ValueError("tag vazia após normalização")
    tag_id = await conn.fetchval("SELECT id FROM tags WHERE name = $1", nome)
    if tag_id is None:
        # Corrida com outro worker criando a mesma tag (`name` é UNIQUE): o
        # DO NOTHING deixa o SELECT seguinte resolver.
        tag_id = await conn.fetchval(
            "INSERT INTO tags (name) VALUES ($1) ON CONFLICT (name) DO NOTHING "
            "RETURNING id", nome)
        if tag_id is None:
            tag_id = await conn.fetchval("SELECT id FROM tags WHERE name = $1", nome)
    if tag_id is None:
        raise ValueError("tag não resolvida")
    await conn.execute(
        "INSERT INTO lead_tags (lead_id, tag_id) VALUES ($1::uuid, $2) "
        "ON CONFLICT DO NOTHING", lead_id, tag_id)


def _contexto(run: dict) -> dict:
    ctx = run.get("context")
    if isinstance(ctx, str):
        ctx = json.loads(ctx or "{}")
    return dict(ctx or {})


async def executar_no(conn, run: dict, no: dict) -> dict:
    """Executa um nó. Devolve {'tipo': 'avancar'|'parar', 'proximo': id|None}."""
    cfg = no.get("config") or {}
    tipo = no.get("type")

    if tipo == "send_email":
        # ⚠️ A função do banco é quem cria a linha e enfileira. O índice
        # uniq_campaign_sends_journey_node faz a reexecução devolver
        # 'duplicate' — nenhum segundo e-mail é criado.
        resultado = await conn.fetchval(
            "SELECT journey_enqueue_email($1::uuid, $2, $3::uuid, $4::uuid)",
            run["run_id"], no["id"], run["journey_id"], run["lead_id"])
        if isinstance(resultado, str):
            resultado = json.loads(resultado)
        estado = (resultado or {}).get("status", "unknown")
        await registrar_passo(conn, run, no,
                              "enqueued" if estado == "enqueued" else "skipped",
                              resultado or {})
        return {"tipo": "avancar", "proximo": no.get("next")}

    if tipo == "delay":
        minutos = max(1, int(cfg.get("minutes") or 0))
        proximo = no.get("next")
        ok = await gravar_run(conn, run, {
            "current_node_id": proximo,
            "state": "done" if proximo is None else "waiting",
            "waiting_event": None,
            "wakeup_at": _agora() + timedelta(minutes=minutos),
            "lock_token": None,
            "locked_until": None,
            "context": {**_contexto(run), "attempts": 0},
        })
        await registrar_passo(conn, run, no, "entered" if ok else "failed",
                              {"minutes": minutos})
        return {"tipo": "parar"}

    if tipo == "wait_for_event":
        ctx = _contexto(run)
        casou = ctx.get("event_matched") is True
        # ⚠️ A espera é escopada POR NÓ — ver o aviso no topo do módulo.
        parado_aqui = (isinstance(ctx.get("waiting_since"), str)
                       and ctx.get("waiting_node_id") == no["id"])

        if casou:
            await registrar_passo(conn, run, no, "event_matched",
                                  {"event": ctx.get("last_event")})
            for chave in ("event_matched", "waiting_since", "waiting_node_id"):
                ctx.pop(chave, None)
            run["context"] = {**ctx, "attempts": 0}
            return {"tipo": "avancar", "proximo": no.get("next")}

        timeout = max(1, int(cfg.get("timeout_minutes") or TIMEOUT_PADRAO_MINUTOS))
        if not parado_aqui:
            # Ainda não esperou NESTE nó: pode ser o nó de entrada do fluxo.
            # Pausa agora, com os mesmos campos que o look-ahead grava.
            novo = {**ctx, "attempts": 0,
                    "waiting_since": _agora().isoformat(),
                    "waiting_node_id": no["id"]}
            novo.pop("event_matched", None)
            ok = await gravar_run(conn, run, {
                "current_node_id": no["id"],
                "state": "waiting",
                "waiting_event": str(cfg.get("event_type") or ""),
                "wakeup_at": _agora() + timedelta(minutes=timeout),
                "lock_token": None,
                "locked_until": None,
                "context": novo,
            })
            await registrar_passo(conn, run, no, "entered" if ok else "failed",
                                  {"timeout_minutes": timeout})
            return {"tipo": "parar"}

        # Parado NESTE nó e sem casamento: o run só foi reivindicado porque o
        # `wakeup_at` venceu de verdade — timeout genuíno.
        await registrar_passo(conn, run, no, "timeout",
                              {"event_type": cfg.get("event_type")})
        for chave in ("waiting_since", "waiting_node_id", "event_matched"):
            ctx.pop(chave, None)
        run["context"] = {**ctx, "attempts": 0}
        return {"tipo": "avancar", "proximo": no.get("next_timeout")}

    if tipo in ("branch_attribute", "branch_segment", "branch_email_event"):
        acertou = await _avaliar_condicional(conn, run, no, cfg, tipo)
        await registrar_passo(conn, run, no,
                              "branch_true" if acertou else "branch_false", {})
        return {"tipo": "avancar",
                "proximo": no.get("next") if acertou else no.get("next_false")}

    if tipo == "apply_tag":
        await _aplicar_tag(conn, run["lead_id"], str(cfg.get("tag_name") or ""))
        await registrar_passo(conn, run, no, "entered",
                              {"tag_name": cfg.get("tag_name")})
        return {"tipo": "avancar", "proximo": no.get("next")}

    if tipo == "handoff_growthhs":
        # Enfileira e segue: quem entrega é o worker (app/crm/entrega.py), com
        # re-tentativa e falha à vista na linha do tempo do contato. O fluxo
        # não espera o GrowthHS — um CRM fora do ar não pode parar as jornadas.
        from app.crm.entrega import enfileirar

        pedido = await enfileirar(conn, str(run["lead_id"]), "jornada",
                                  journey_run_id=str(run["run_id"]))
        await registrar_passo(conn, run, no, "enqueued",
                              {"handoff_id": pedido, "ja_na_fila": pedido is None})
        return {"tipo": "avancar", "proximo": no.get("next")}

    raise ValueError(f"tipo de nó desconhecido: {tipo}")


async def _avaliar_condicional(conn, run: dict, no: dict, cfg: dict,
                               tipo: str) -> bool:
    if tipo == "branch_attribute":
        return bool(await conn.fetchval(
            "SELECT evaluate_rules_for_lead($1::uuid, $2::jsonb, $3)",
            run["lead_id"], cfg.get("rules") or [], cfg.get("logic") or "and"))

    if tipo == "branch_segment":
        return bool(await conn.fetchval(
            "SELECT evaluate_segment_for_lead($1::uuid, $2::uuid)",
            run["lead_id"], cfg.get("segment_id")))

    # branch_email_event: condicional SÍNCRONA sobre o e-mail que ESTE fluxo
    # mandou antes. A linha é única por (journey_run_id, journey_node_id).
    #
    # ⚠️ Sem linha (e-mail ainda não enviado, ou falhou, ou suprimido) o
    # resultado é FALSO — o caminho "não". É fail-safe de propósito: na dúvida,
    # não seguir o ramo que pressupõe que a pessoa recebeu.
    linha = await conn.fetchrow(
        """SELECT status, opened_at, clicked_at FROM campaign_sends
            WHERE journey_run_id = $1::uuid AND journey_node_id = $2""",
        run["run_id"], str(cfg.get("source_node_id") or ""))
    if linha is None:
        return False
    checagem = cfg.get("check")
    if checagem == "delivered":
        # Abrir ou clicar implica ter recebido — cobre o caso de o evento
        # 'delivered' não ter vindo.
        return linha["status"] in ("delivered", "opened", "clicked")
    if checagem == "opened":
        return linha["opened_at"] is not None
    if checagem == "clicked":
        return linha["clicked_at"] is not None
    return False


async def rodar_cadeia(conn, run: dict) -> dict:
    """Roda a cadeia de nós até parar (delay, espera, fim ou erro)."""
    por_id = {str(n.get("id")): n for n in (run.get("nodes") or [])}
    passos = 0

    while passos < MAX_PASSOS_POR_RUN:
        no_id = run.get("current_node_id")
        if not no_id:
            await gravar_run(conn, run, {"state": "done", "lock_token": None,
                                         "locked_until": None})
            return {"passos": passos, "falhou": False}

        no = por_id.get(str(no_id))
        if no is None:
            # O fluxo foi editado e o nó sumiu debaixo do run. Terminal e
            # VISÍVEL — nunca silencioso.
            await gravar_run(conn, run, {
                "state": "failed", "lock_token": None, "locked_until": None,
                "context": {**_contexto(run),
                            "error": f"nó {no_id} não existe mais no fluxo"}})
            return {"passos": passos, "falhou": True}

        # Emissor genérico de "entered", para TODO nó. Sem ele o nó de entrada
        # do fluxo e todo nó logo depois de um delay ficariam sem nenhum
        # "entered", e o funil do construtor mostraria zero ali.
        await registrar_passo(conn, run, no, "entered", {})

        try:
            resultado = await executar_no(conn, run, no)
        except Exception as e:  # noqa: BLE001
            tentativas = int(_contexto(run).get("attempts") or 0) + 1
            await registrar_passo(conn, run, no, "failed",
                                  {"error": str(e)[:400], "attempts": tentativas})
            # ⚠️ Grava `current_node_id` junto com o contexto. Sem isso o nó
            # parava no valor com que o run foi reivindicado enquanto o contexto
            # avançava — e o próximo claim reprocessaria um nó de espera já
            # resolvido como se fosse timeout, seguindo o ramo errado.
            comum = {"current_node_id": run.get("current_node_id"),
                     "waiting_event": run.get("waiting_event"),
                     "lock_token": None, "locked_until": None}
            if tentativas < MAX_TENTATIVAS_POR_NO:
                # Erro transitório: reagenda o MESMO nó. Reexecutar send_email é
                # seguro por construção (o índice único do par run+nó).
                await gravar_run(conn, run, {
                    **comum, "state": "waiting",
                    "wakeup_at": _agora() + timedelta(minutes=RETENTATIVA_MINUTOS),
                    "context": {**_contexto(run), "attempts": tentativas,
                                "last_error": str(e)[:400]}})
                return {"passos": passos, "falhou": False}
            await gravar_run(conn, run, {
                **comum, "state": "failed",
                "context": {**_contexto(run), "attempts": tentativas,
                            "error": str(e)[:400]}})
            return {"passos": passos, "falhou": True}

        passos += 1

        if resultado["tipo"] == "parar":
            return {"passos": passos, "falhou": bool(resultado.get("falhou"))}

        proximo = resultado.get("proximo")
        if proximo is None:
            await gravar_run(conn, run, {
                "current_node_id": None, "state": "done", "waiting_event": None,
                "lock_token": None, "locked_until": None,
                "context": {**_contexto(run), "attempts": 0}})
            return {"passos": passos, "falhou": False}

        proximo_no = por_id.get(str(proximo))
        if proximo_no is not None and proximo_no.get("type") == "wait_for_event":
            # Look-ahead: entra em espera aqui, registrando QUANDO começou (o
            # `journey_wake_on_event` só aceita eventos posteriores a isso) e A
            # QUAL NÓ a espera pertence.
            cfg = proximo_no.get("config") or {}
            timeout = max(1, int(cfg.get("timeout_minutes") or TIMEOUT_PADRAO_MINUTOS))
            ctx = {**_contexto(run), "attempts": 0,
                   "waiting_since": _agora().isoformat(),
                   "waiting_node_id": proximo_no["id"]}
            ctx.pop("event_matched", None)
            ok = await gravar_run(conn, run, {
                "current_node_id": proximo, "state": "waiting",
                "waiting_event": str(cfg.get("event_type") or ""),
                "wakeup_at": _agora() + timedelta(minutes=timeout),
                "lock_token": None, "locked_until": None, "context": ctx})
            await registrar_passo(conn, run, proximo_no,
                                  "entered" if ok else "failed",
                                  {"timeout_minutes": timeout})
            return {"passos": passos, "falhou": False}

        # Segue na mesma invocação: condicional e tag não custam um minuto cada.
        run["current_node_id"] = proximo
        run["state"] = "active"
        run["waiting_event"] = None

    # Estouro do teto. Não deveria acontecer — o grafo é acíclico por validação
    # do banco —, mas para com rastro em vez de girar.
    await gravar_run(conn, run, {
        "current_node_id": run.get("current_node_id"),
        "waiting_event": run.get("waiting_event"),
        "state": "failed", "lock_token": None, "locked_until": None,
        "context": {**_contexto(run),
                    "error": f"mais de {MAX_PASSOS_POR_RUN} passos numa invocação"}})
    return {"passos": passos, "falhou": True}
