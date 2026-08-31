import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";
import { validateToken, unauthorized, ok, error, handleCors } from "../_shared/auth.ts";

// MOTOR DE FLUXOS (Fase 6). Invocado pelo pg_cron a cada minuto via
// invoke_edge_function (WEBHOOK_SECRET do Vault). Três etapas por invocação:
//   A. entrada por segmento  (RPC journey_enroll_segment, set-based)
//   B. drenagem da fila journey_events (entrada por evento + wake-up de esperas)
//   C. execução dos runs devidos (claim com lease + fencing token)
//
// O QUE ESTE WORKER NÃO FAZ (de propósito):
//   * não envia email -- ele chama journey_enqueue_email, que cria a linha em
//     campaign_sends e publica na fila email_send_queue NA MESMA TRANSAÇÃO; quem
//     envia é o process-email-queue, herdando supressão/unsubscribe/claim/422/429;
//   * não escreve em contact_events -- a timeline tem um único emissor
//     (fn_campaign_send_event). O log daqui é journey_step_log.

const WALL_CLOCK_BUDGET_MS = 100_000; // teto da Edge Function é ~150s
const RUN_BATCH = 50;
const LEASE_SECONDS = 300;
const EVENT_BATCH = 100;
const EVENT_VT = 120;
// Teto de releituras de uma mensagem da fila journey_events, tanto para erro
// (poison) quanto para adiamento por lease ativa (I4b). Depois disso a mensagem
// é abandonada em vez de circular para sempre.
const MAX_EVENT_READ_COUNT = 5;
const MAX_STEPS_PER_RUN = 20;   // trava anti-loop (o grafo já é acíclico; cinto e suspensório)
const MAX_NODE_ATTEMPTS = 3;    // erro transitório num nó: 3 tentativas, depois 'failed'

interface JourneyNode {
  id: string;
  type: string;
  config?: Record<string, unknown>;
  next?: string | null;
  next_false?: string | null;
  next_timeout?: string | null;
}

interface DueRun {
  run_id: string;
  journey_id: string;
  lead_id: string;
  current_node_id: string | null;
  state: string;
  waiting_event: string | null;
  context: Record<string, any>;
  lock_token: string;
  nodes: JourneyNode[];
  reentry: string;
}

interface EventMsg {
  msg_id: number;
  read_ct: number;
  message: {
    event_id?: string;
    lead_id: string;
    event_type: string;
    occurred_at?: string;
    metadata?: Record<string, unknown>;
  };
}

const nowIso = () => new Date().toISOString();

async function logStep(
  sb: any,
  run: DueRun,
  node: { id: string; type: string },
  result: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  const { error: err } = await sb.from("journey_step_log").insert({
    run_id: run.run_id,
    journey_id: run.journey_id,
    lead_id: run.lead_id,
    node_id: node.id,
    node_type: node.type,
    result,
    detail,
  });
  if (err) console.error("journey-worker logStep error:", run.run_id, node.id, result, err);
}

// Toda escrita num run passa por aqui: o fencing token (.eq('lock_token', ...))
// garante que um worker cujo lease expirou NÃO sobrescreve quem assumiu o run.
async function writeRun(sb: any, run: DueRun, patch: Record<string, unknown>): Promise<boolean> {
  const { data, error: err } = await sb
    .from("journey_runs")
    .update({ ...patch, updated_at: nowIso() })
    .eq("id", run.run_id)
    .eq("lock_token", run.lock_token)
    .select("id");
  if (err) {
    console.error("journey-worker writeRun error:", run.run_id, err);
    return false;
  }
  if (!data || data.length === 0) {
    console.error("journey-worker: lease perdido no run", run.run_id, "-- escrita descartada");
    return false;
  }
  return true;
}

async function applyTagInline(sb: any, leadId: string, rawTag: string): Promise<void> {
  // Mesma normalização de apply-lead-tag/index.ts. NÃO chamamos aquela function:
  // ela não está no config.toml -> verify_jwt=true -> chamada server-to-server com
  // WEBHOOK_SECRET seria barrada no gateway (armadilha documentada no CLAUDE.md).
  const tagName = String(rawTag || "").replace(/^\/+/, "").trim().toLowerCase();
  if (!tagName) throw new Error("tag vazia após normalização");

  const { data: existing } = await sb.from("tags").select("id").eq("name", tagName).maybeSingle();
  let tagId = existing?.id as string | undefined;

  if (!tagId) {
    const { data: created, error: insErr } = await sb
      .from("tags")
      .insert({ name: tagName })
      .select("id")
      .maybeSingle();
    if (insErr) {
      // Corrida com outro worker/usuário criando a mesma tag (name é UNIQUE): relê.
      const { data: again } = await sb.from("tags").select("id").eq("name", tagName).maybeSingle();
      tagId = again?.id;
      if (!tagId) throw new Error(`falha ao criar tag: ${insErr.message}`);
    } else {
      tagId = created?.id;
    }
  }
  if (!tagId) throw new Error("tag não resolvida");

  // PK (lead_id, tag_id) -> idempotente por construção (reexecução do nó não quebra).
  const { error: linkErr } = await sb
    .from("lead_tags")
    .upsert({ lead_id: leadId, tag_id: tagId }, { onConflict: "lead_id,tag_id", ignoreDuplicates: true });
  if (linkErr) throw new Error(`falha ao vincular tag: ${linkErr.message}`);
}

async function handoffNexus(leadId: string, cfg: Record<string, unknown>): Promise<void> {
  const base = Deno.env.get("SUPABASE_URL");
  const secret = Deno.env.get("WEBHOOK_SECRET");
  if (!base) throw new Error("SUPABASE_URL ausente");

  const res = await fetch(`${base}/functions/v1/handoff-to-nexus`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // handoff-to-nexus está no config.toml com verify_jwt=false e não valida
      // token no corpo; o header vai por consistência com os demais chamadores.
      Authorization: `Bearer ${secret ?? ""}`,
    },
    body: JSON.stringify({
      lead_id: leadId,
      direct_stage: true,
      stage_id: cfg.stage_id,
      stage_name: cfg.stage_name ?? null,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`handoff-to-nexus ${res.status}: ${body.slice(0, 200)}`);
  }
}

// Executa UM nó. Devolve o próximo node_id (ou null = fim), ou um "parque"
// (delay/wait) que interrompe a cadeia deste run nesta invocação.
type StepOutcome =
  | { kind: "advance"; next: string | null }
  | { kind: "park" }        // o run já foi persistido (delay/wait); parar a cadeia
  | { kind: "retry" }       // erro transitório: já reagendado
  | { kind: "fail" };       // erro terminal: run já marcado como failed

async function executeNode(sb: any, run: DueRun, node: JourneyNode): Promise<StepOutcome> {
  const cfg = (node.config ?? {}) as Record<string, any>;

  switch (node.type) {
    case "send_email": {
      const { data, error: err } = await sb.rpc("journey_enqueue_email", {
        p_run_id: run.run_id,
        p_node_id: node.id,
        p_journey_id: run.journey_id,
        p_lead_id: run.lead_id,
      });
      if (err) throw new Error(`journey_enqueue_email: ${err.message}`);
      const status = (data as any)?.status ?? "unknown";
      // 'duplicate' = este (run, nó) já tem envio (reexecução após lease expirado).
      // Nenhum segundo email é criado nem enfileirado -- garantido pelo índice único.
      await logStep(sb, run, node, status === "enqueued" ? "enqueued" : "skipped", data ?? {});
      return { kind: "advance", next: node.next ?? null };
    }

    case "delay": {
      const minutes = Number(cfg.minutes ?? 0);
      const wake = new Date(Date.now() + Math.max(1, minutes) * 60_000).toISOString();
      const okWrite = await writeRun(sb, run, {
        current_node_id: node.next ?? null,
        state: (node.next ?? null) === null ? "done" : "waiting",
        waiting_event: null,
        wakeup_at: wake,
        lock_token: null,
        locked_until: null,
        context: { ...run.context, attempts: 0 },
      });
      await logStep(sb, run, node, okWrite ? "entered" : "failed", { wake_at: wake });
      return { kind: "park" };
    }

    case "wait_for_event": {
      const matched = run.context?.event_matched === true;
      // I2 + F1: um timeout só é genuíno se este run já esteve PARADO NESTE NÓ.
      // A espera é ESCOPADA POR NÓ (`waiting_node_id` gravado junto com
      // `waiting_since` em todo park): um `waiting_since` solto no contexto NÃO
      // basta.
      //
      // Por que o escopo por nó (F1): num grafo `wait W1 -> delay -> wait W2`, o
      // ramo "matched" de W1 avança o run e o nó `delay` persiste o contexto
      // VERBATIM (`context: { ...run.context }`) -- então um `waiting_since` de
      // W1 sobreviveria até W2. Sem o escopo, a guarda de W2 veria esse
      // `waiting_since` velho, concluiria "timeout genuíno" e mandaria o email
      // de "não clicou" em segundos -- sem NUNCA dar ao lead os dias de espera
      // configurados, e sem nunca parquear W2 (que assim jamais poderia ser
      // acordado). Comparar `waiting_node_id === node.id` torna a guarda imune a
      // isso e a qualquer nó futuro que repasse o contexto.
      const parkedHere =
        typeof run.context?.waiting_since === "string" &&
        run.context?.waiting_node_id === node.id;

      if (matched) {
        await logStep(sb, run, node, "event_matched", { event: run.context?.last_event ?? null });
        const ctx = { ...run.context };
        // Limpa as três chaves da espera na MESMA transição que avança o run --
        // e a escrita que persiste `current_node_id` (fim da cadeia, park do
        // próximo nó, ou o catch de erro, que grava current_node_id desde o I3)
        // grava este contexto junto. Não sobra nenhum resíduo de espera para o
        // próximo wait_for_event do grafo interpretar como timeout.
        delete ctx.event_matched;
        delete ctx.waiting_since;
        delete ctx.waiting_node_id;
        run.context = { ...ctx, attempts: 0 };
        return { kind: "advance", next: node.next ?? null };
      }

      const timeout = Math.max(1, Number(cfg.timeout_minutes ?? 1440));
      if (!parkedHere) {
        // Este run ainda não esperou NESTE nó: pode ser o nó de entrada do fluxo
        // (enroll grava current_node_id = entry_node_id com wakeup_at = now()),
        // ou um nó alcançado por um caminho que ainda não parqueou aqui. Pausa
        // agora, com os MESMOS campos que o look-ahead de runChain grava
        // (idempotente -- reexecutar isto não manda email nem pula passo).
        const wake = new Date(Date.now() + timeout * 60_000).toISOString();
        const ctx = {
          ...run.context,
          attempts: 0,
          waiting_since: nowIso(),
          waiting_node_id: node.id,
        };
        delete ctx.event_matched;
        const okWrite = await writeRun(sb, run, {
          current_node_id: node.id,
          state: "waiting",
          waiting_event: String(cfg.event_type ?? ""),
          wakeup_at: wake,
          lock_token: null,
          locked_until: null,
          context: ctx,
        });
        await logStep(sb, run, node, okWrite ? "entered" : "failed", { timeout_minutes: timeout });
        return { kind: "park" };
      }

      // Parqueado NESTE nó e sem match: o run só foi reivindicado porque
      // wakeup_at (waiting_since + timeout) venceu de verdade -- timeout genuíno.
      await logStep(sb, run, node, "timeout", { event_type: cfg.event_type });
      const ctx = { ...run.context, attempts: 0 };
      delete ctx.waiting_since;
      delete ctx.waiting_node_id;
      delete ctx.event_matched;
      run.context = ctx;
      return { kind: "advance", next: node.next_timeout ?? null };
    }

    case "branch_attribute": {
      const { data, error: err } = await sb.rpc("evaluate_rules_for_lead", {
        p_lead_id: run.lead_id,
        p_rules: cfg.rules ?? [],
        p_logic: cfg.logic ?? "and",
      });
      if (err) throw new Error(`evaluate_rules_for_lead: ${err.message}`);
      const hit = data === true;
      await logStep(sb, run, node, hit ? "branch_true" : "branch_false", {});
      return { kind: "advance", next: (hit ? node.next : node.next_false) ?? null };
    }

    case "branch_segment": {
      const { data, error: err } = await sb.rpc("evaluate_segment_for_lead", {
        p_lead_id: run.lead_id,
        p_segment_id: cfg.segment_id,
      });
      if (err) throw new Error(`evaluate_segment_for_lead: ${err.message}`);
      const hit = data === true;
      await logStep(sb, run, node, hit ? "branch_true" : "branch_false", { segment_id: cfg.segment_id });
      return { kind: "advance", next: (hit ? node.next : node.next_false) ?? null };
    }

    case "branch_email_event": {
      // Condicional SÍNCRONA: o contato recebeu/abriu/clicou o email enviado
      // antes neste fluxo (cfg.source_node_id = um nó send_email)? A linha do
      // envio e' unica por (journey_run_id, journey_node_id) -- indice
      // uniq_campaign_sends_journey_node. Query direta (worker e' service-role):
      // nao vale uma RPC nova para um lookup de uma linha.
      //   recebido -> status IN (delivered/opened/clicked): abrir/clicar implica
      //     ter recebido, entao cobre o caso de o webhook 'delivered' nao ter vindo.
      //   lido     -> opened_at IS NOT NULL;  clicado -> clicked_at IS NOT NULL.
      // Sem linha (email de origem ainda nao enviado neste run, ou falhou/
      // suprimido) -> hit=false -> caminho "Nao". Fail-safe.
      const { data: cs } = await sb.from("campaign_sends")
        .select("status, opened_at, clicked_at")
        .eq("journey_run_id", run.run_id)
        .eq("journey_node_id", String(cfg.source_node_id ?? ""))
        .maybeSingle();
      let hit = false;
      if (cs) {
        if (cfg.check === "delivered") hit = ["delivered", "opened", "clicked"].includes(cs.status);
        else if (cfg.check === "opened") hit = cs.opened_at != null;
        else if (cfg.check === "clicked") hit = cs.clicked_at != null;
      }
      await logStep(sb, run, node, hit ? "branch_true" : "branch_false", { check: cfg.check, source_node_id: cfg.source_node_id });
      return { kind: "advance", next: (hit ? node.next : node.next_false) ?? null };
    }

    case "apply_tag": {
      await applyTagInline(sb, run.lead_id, String(cfg.tag_name ?? ""));
      await logStep(sb, run, node, "entered", { tag_name: cfg.tag_name });
      return { kind: "advance", next: node.next ?? null };
    }

    case "handoff_nexus": {
      await handoffNexus(run.lead_id, cfg);
      await logStep(sb, run, node, "entered", { stage_id: cfg.stage_id });
      return { kind: "advance", next: node.next ?? null };
    }

    default:
      throw new Error(`tipo de nó desconhecido: ${node.type}`);
  }
}

// Roda a cadeia de nós de um run até "parar" (delay/wait/fim/erro).
async function runChain(sb: any, run: DueRun): Promise<{ steps: number; failed: boolean }> {
  const byId = new Map<string, JourneyNode>(
    (Array.isArray(run.nodes) ? run.nodes : []).map((n) => [String(n.id), n]),
  );
  let steps = 0;

  while (steps < MAX_STEPS_PER_RUN) {
    const nodeId = run.current_node_id;
    if (!nodeId) {
      await writeRun(sb, run, { state: "done", lock_token: null, locked_until: null });
      return { steps, failed: false };
    }

    const node = byId.get(String(nodeId));
    if (!node) {
      // O fluxo foi editado e o nó sumiu debaixo do run. Terminal e VISÍVEL --
      // nunca silencioso.
      await writeRun(sb, run, {
        state: "failed",
        lock_token: null,
        locked_until: null,
        context: { ...run.context, error: `nó ${nodeId} não existe mais no fluxo` },
      });
      return { steps, failed: true };
    }

    // I5: emissor genérico único de "entered" -- roda para TODO nó, no início
    // da execução dele, independente do tipo. Antes disso, "entered" só era
    // logado (a) pela própria entrada do delay/wait em si mesmos, e (b) pela
    // continuação "mesma invocação" logo abaixo -- o que deixava o nó de
    // ENTRADA do fluxo (primeiro claim de um run novo) e todo nó que vem
    // IMEDIATAMENTE depois de um delay (reclamado numa invocação nova, não em
    // continuação) sem nenhum "entered": o funil do builder mostrava 0 ali.
    // journey_node_metrics conta DISTINCT run_id, então logar de novo aqui
    // para um nó que já tem seu próprio "entered" (delay, wait_for_event) não
    // infla a métrica -- só garante que TODO nó tenha pelo menos um.
    await logStep(sb, run, node, "entered", {});

    let outcome: StepOutcome;
    try {
      outcome = await executeNode(sb, run, node);
    } catch (err) {
      const attempts = Number(run.context?.attempts ?? 0) + 1;
      await logStep(sb, run, node, "failed", { error: String(err).slice(0, 400), attempts });
      // I3: persiste current_node_id/waiting_event JUNTO com o context nas duas
      // escritas abaixo. `run.current_node_id`/`run.waiting_event` em memória já
      // refletem o nó que de fato estava sendo executado quando o erro ocorreu
      // (executeNode's wait_for_event branch avança os dois em lockstep antes de
      // devolver "advance"; o loop "mesma invocação" também atualiza os dois
      // juntos antes de chamar executeNode de novo). Sem gravar isso aqui, o
      // catch deixava current_node_id parado no valor com que o run foi
      // reivindicado (ex.: um nó wait_for_event já superado) enquanto o
      // context avançava sem event_matched -- o próximo claim reprocessava o
      // nó de espera já resolvido como se fosse um timeout genuíno (branch
      // errado) e reexecutava nós que já tinham rodado (apply_tag/handoff_nexus).
      if (attempts < MAX_NODE_ATTEMPTS) {
        // Erro transitório (Nexus fora do ar, rede): reagenda o MESMO nó em 5 min.
        // Reexecutar send_email é seguro por construção (índice único (run, nó)).
        await writeRun(sb, run, {
          current_node_id: run.current_node_id,
          waiting_event: run.waiting_event,
          state: "waiting",
          wakeup_at: new Date(Date.now() + 5 * 60_000).toISOString(),
          lock_token: null,
          locked_until: null,
          context: { ...run.context, attempts, last_error: String(err).slice(0, 400) },
        });
        return { steps, failed: false };
      }
      await writeRun(sb, run, {
        current_node_id: run.current_node_id,
        waiting_event: run.waiting_event,
        state: "failed",
        lock_token: null,
        locked_until: null,
        context: { ...run.context, attempts, error: String(err).slice(0, 400) },
      });
      return { steps, failed: true };
    }

    steps++;

    if (outcome.kind === "park" || outcome.kind === "retry" || outcome.kind === "fail") {
      return { steps, failed: outcome.kind === "fail" };
    }

    // advance
    const next = outcome.next;
    if (next === null) {
      await writeRun(sb, run, {
        current_node_id: null,
        state: "done",
        waiting_event: null,
        lock_token: null,
        locked_until: null,
        context: { ...run.context, attempts: 0 },
      });
      return { steps, failed: false };
    }

    const nextNode = byId.get(String(next));
    if (nextNode && nextNode.type === "wait_for_event") {
      // Entra em espera: registra QUANDO começou a esperar (journey_wake_on_event
      // só aceita eventos posteriores a isso), A QUAL NÓ essa espera pertence
      // (F1 -- a guarda de timeout do executeNode exige waiting_node_id ===
      // node.id; um waiting_since órfão de outro nó não pode valer como timeout)
      // e agenda o timeout.
      const cfg = (nextNode.config ?? {}) as Record<string, any>;
      const timeout = Math.max(1, Number(cfg.timeout_minutes ?? 1440));
      const ctx = {
        ...run.context,
        attempts: 0,
        waiting_since: nowIso(),
        waiting_node_id: nextNode.id,
      };
      delete ctx.event_matched;
      const okWrite = await writeRun(sb, run, {
        current_node_id: next,
        state: "waiting",
        waiting_event: String(cfg.event_type ?? ""),
        wakeup_at: new Date(Date.now() + timeout * 60_000).toISOString(),
        lock_token: null,
        locked_until: null,
        context: ctx,
      });
      await logStep(sb, run, nextNode, okWrite ? "entered" : "failed", { timeout_minutes: timeout });
      return { steps, failed: false };
    }

    // Segue na mesma invocação (branches e tags não custam um minuto cada).
    // "entered" do próximo nó é emitido no topo do laço (I5), não aqui mais --
    // evita logar duas vezes o mesmo nó na mesma invocação.
    run.current_node_id = next;
    run.state = "active";
    run.waiting_event = null;
  }

  // Estouro do teto de passos: para o run e deixa o rastro (não deveria acontecer,
  // o grafo é acíclico por validação de banco). Terminal (sem retry), mas grava
  // current_node_id/waiting_event correntes para o rastro ficar fiel (I3).
  await writeRun(sb, run, {
    current_node_id: run.current_node_id,
    waiting_event: run.waiting_event,
    state: "failed",
    lock_token: null,
    locked_until: null,
    context: { ...run.context, error: `mais de ${MAX_STEPS_PER_RUN} passos numa invocação` },
  });
  return { steps, failed: true };
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return error("Method not allowed", 405);
  if (!validateToken(req)) return unauthorized();

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const started = Date.now();
  let enrolled = 0, woken = 0, deferred = 0, executed = 0, steps = 0, failed = 0;

  // ---- A. Entrada por segmento (varredura) --------------------------------
  const { data: segJourneys, error: sjErr } = await sb
    .from("journeys")
    .select("id")
    .eq("status", "active")
    .eq("entry_type", "segment");
  if (sjErr) console.error("journey-worker list segment journeys error:", sjErr);

  for (const j of segJourneys ?? []) {
    const { data: n, error: enErr } = await sb.rpc("journey_enroll_segment", {
      p_journey_id: j.id,
      p_limit: 500,
    });
    if (enErr) { console.error("journey-worker journey_enroll_segment error:", j.id, enErr); continue; }
    enrolled += typeof n === "number" ? n : 0;
  }

  // ---- B. Fila de eventos (entrada por evento + wake-up de esperas) --------
  while (Date.now() - started < WALL_CLOCK_BUDGET_MS / 2) {
    const { data: msgs, error: rdErr } = await sb.rpc("journey_queue_read", {
      p_vt: EVENT_VT,
      p_qty: EVENT_BATCH,
    });
    if (rdErr) { console.error("journey-worker journey_queue_read error:", rdErr); break; }

    const list = (msgs ?? []) as EventMsg[];
    if (list.length === 0) break;

    const done: number[] = [];
    for (const m of list) {
      const { lead_id, event_type, occurred_at, metadata } = m.message ?? ({} as any);
      if (!lead_id || !event_type) { done.push(m.msg_id); continue; }

      try {
        const { data: w, error: wErr } = await sb.rpc("journey_wake_on_event", {
          p_lead_id: lead_id,
          p_event_type: event_type,
          p_occurred_at: occurred_at ?? nowIso(),
          p_metadata: metadata ?? {},
        });
        if (wErr) throw new Error(wErr.message);
        // `w` é o jsonb {woken, deferred} devolvido por journey_wake_on_event.
        const wokenNow = Number(w?.woken ?? 0);
        const deferredNow = Number(w?.deferred ?? 0);
        woken += wokenNow;

        const { data: e, error: eErr } = await sb.rpc("journey_enroll_event", {
          p_lead_id: lead_id,
          p_event_type: event_type,
        });
        if (eErr) throw new Error(eErr.message);
        enrolled += typeof e === "number" ? e : 0;

        // I4b: existe run que casaria com este evento, mas está com LEASE ATIVA
        // (outro worker o reivindicou e está executando). O wake NÃO pode
        // roubar a lease -- e descartar a mensagem aqui faria o lead que ABRIU
        // o email nunca acordar: o run venceria por timeout e ele receberia o
        // email de "não abriu". Então NÃO apagamos a mensagem: ela volta pela
        // fila após o visibility timeout e é reaplicada num tick seguinte, com
        // a lease já expirada/liberada.
        //
        // Reprocessar a mensagem é seguro:
        //   * journey_wake_on_event só casa com run em state='waiting' -- um run
        //     que já avançou (ou que já foi acordado nesta passada) não casa de
        //     novo: nada de acordar duas vezes;
        //   * journey_enroll_event é barrado pelo guard de run aberto/cooldown
        //     (+ uniq_journey_runs_open) -- nenhum run duplicado.
        //
        // Poison guard: read_ct cresce a cada releitura. Se a mensagem NUNCA
        // conseguir se aplicar (ex.: um run travado com lease renovada
        // indefinidamente por um bug), ela é abandonada após MAX_EVENT_READ_COUNT
        // releituras em vez de circular para sempre. Isso só descarta a mensagem
        // da fila DO FLUXO -- a timeline do lead (contact_events) é escrita por
        // fn_campaign_send_event, num caminho totalmente separado deste worker, e
        // não é afetada.
        //
        // F2: a condição é `deferredNow > 0` SOZINHA -- NÃO `&& wokenNow === 0`.
        // journey_wake_on_event agrega por LEAD, e um lead pode estar em vários
        // fluxos ao mesmo tempo: se ele está parado no fluxo X (com lease ativa)
        // e no fluxo Y (livre), um único email_opened acorda Y (woken=1) e adia X
        // (deferred=1). Exigir `wokenNow === 0` faria a mensagem ser apagada por
        // causa de Y -- e X nunca acordaria: o lead que ABRIU receberia o email
        // de "não abriu" de X. Adiar sempre que houver QUALQUER run adiado é
        // seguro justamente porque o reprocessamento é idempotente (o wake só
        // casa com state='waiting', então Y -- agora 'active' -- não acorda duas
        // vezes).
        if (deferredNow > 0 && m.read_ct <= MAX_EVENT_READ_COUNT) {
          console.warn(
            "journey-worker: evento adiado (run com lease ativa), mensagem devolvida à fila:",
            m.msg_id, event_type, "read_ct=", m.read_ct, "woken=", wokenNow,
          );
          deferred++;
          continue; // NÃO entra em `done` -> não é apagada
        }
        if (deferredNow > 0 && m.read_ct > MAX_EVENT_READ_COUNT) {
          console.error(
            "journey-worker: evento adiado além do limite de releituras -- abandonado:",
            m.msg_id, event_type, "read_ct=", m.read_ct,
          );
        }

        done.push(m.msg_id);
      } catch (err) {
        // Não deleta a mensagem: volta após o visibility timeout. Se for poison,
        // read_ct cresce e a mensagem é abandonada aqui.
        console.error("journey-worker event error:", m.msg_id, err);
        if (m.read_ct > MAX_EVENT_READ_COUNT) done.push(m.msg_id);
      }
    }

    if (done.length > 0) {
      const { error: delErr } = await sb.rpc("journey_queue_delete", { p_msg_ids: done });
      if (delErr) console.error("journey-worker journey_queue_delete error:", delErr);
    }
    if (list.length < EVENT_BATCH) break;
  }

  // ---- C. Runs devidos ----------------------------------------------------
  while (Date.now() - started < WALL_CLOCK_BUDGET_MS) {
    const { data: runs, error: clErr } = await sb.rpc("journey_claim_due_runs", {
      p_limit: RUN_BATCH,
      p_lease_seconds: LEASE_SECONDS,
    });
    if (clErr) { console.error("journey-worker journey_claim_due_runs error:", clErr); break; }

    const list = (runs ?? []) as DueRun[];
    if (list.length === 0) break;

    for (const run of list) {
      // Contexto pode vir null do banco em linhas antigas; normaliza.
      run.context = (run.context ?? {}) as Record<string, any>;
      const r = await runChain(sb, run);
      executed++;
      steps += r.steps;
      if (r.failed) failed++;
      if (Date.now() - started > WALL_CLOCK_BUDGET_MS) break;
    }

    if (list.length < RUN_BATCH) break;
  }

  return ok({ enrolled, woken, deferred, executed, steps, failed });
});
