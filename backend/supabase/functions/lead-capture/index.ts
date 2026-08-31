import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { identifyCaller, forbidden, PRIVILEGED } from "../_shared/callerAuth.ts";

// Whitelisted lead fields that public capture flows may set
const ALLOWED_FIELDS = new Set([
  "nome",
  "whatsapp",
  "cargo",
  "empresa",
  "faturamento",
  "funcionarios",
  "desafios",
  "tipo",
  "tipo_participante",
  "source",
  "presenca",
  "origem_campanha",
  "indicacao",
  "interesse_formacao",
  "interesse_ecossistema",
  "interesse_mtia",
  "data_interesse",
  "status",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "ab_test",
  "ab_var",
  "ab_vid",
]);

const RETURN_COLUMNS =
  "id, session_id, nome, email, whatsapp, cargo, empresa, faturamento, funcionarios, desafios, etiqueta, dnia_id, phone_normalized, deleted_at, deleted_by, utm_source, source";

// Ensure every lead row gets a dnia_id via resolve_or_create_identity.
// Idempotent: safe to call on insert OR update; only writes back if changes.
async function ensureIdentity(sb: any, lead: any) {
  try {
    const { data, error } = await sb.rpc("resolve_or_create_identity", {
      p_phone: lead.whatsapp ?? null,
      p_email: lead.email ?? null,
      p_nome: lead.nome ?? null,
      p_source_app: "dnmarketing",
      p_local_id: lead.id,
      p_utm_source: lead.utm_source ?? lead.source ?? null,
      p_stage: "lead",
    });
    if (error) {
      console.error("[lead-capture] resolve_identity_failed", { id: lead.id, message: error.message });
      return lead;
    }
    const result = data as any;
    if (!result?.dnia_id) return lead;
    const patch: Record<string, unknown> = {};
    if (lead.dnia_id !== result.dnia_id) patch.dnia_id = result.dnia_id;
    if (result.phone_normalized && lead.phone_normalized !== result.phone_normalized) {
      patch.phone_normalized = result.phone_normalized;
    }
    if (Object.keys(patch).length > 0) {
      const { error: upErr } = await sb.from("leads").update(patch).eq("id", lead.id);
      if (upErr) {
        console.error("[lead-capture] persist_identity_failed", { id: lead.id, message: upErr.message });
      } else {
        return { ...lead, ...patch };
      }
    }
    return lead;
  } catch (err) {
    console.error("[lead-capture] ensure_identity_unexpected", { message: (err as Error).message });
    return lead;
  }
}

// PII: chamadores publicos (landing pages, com a chave publicavel) NAO recebem os
// dados pessoais do lead existente — so o necessario para continuar o fluxo de
// conversao, mais flags booleanas de completude. Isso evita que qualquer pessoa
// com um e-mail consiga extrair nome/telefone/empresa da base. Chamadores
// privilegiados (admin/API key/webhook) continuam recebendo o registro completo.
const PUBLIC_LEAD_KEYS = ["id", "session_id", "etiqueta", "dnia_id"] as const;
const PROFILE_KEYS = ["cargo", "empresa", "faturamento", "funcionarios", "desafios"] as const;

function projectLead(lead: any, privileged: boolean) {
  if (!lead) return lead;
  if (privileged) return lead;
  const out: Record<string, unknown> = {};
  for (const k of PUBLIC_LEAD_KEYS) out[k] = lead[k] ?? null;
  out.has_nome = Boolean(lead.nome);
  out.has_whatsapp = Boolean(lead.whatsapp);
  out.profile_complete = PROFILE_KEYS.every((k) => Boolean(lead[k]));
  return out;
}

function sanitize(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!input || typeof input !== "object") return out;
  for (const key of Object.keys(input)) {
    if (!ALLOWED_FIELDS.has(key)) continue;
    const v = (input as Record<string, unknown>)[key];
    if (v === undefined || v === null) continue;
    if (typeof v === "string") {
      const trimmed = v.slice(0, 2000);
      if (trimmed === "") continue;
      out[key] = trimmed;
    } else if (typeof v === "boolean" || typeof v === "number") {
      out[key] = v;
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const caller = await identifyCaller(req);
  if (caller.kind === "none") return forbidden(corsHeaders, 401);
  const privileged = PRIVILEGED.includes(caller.kind);

  try {
    const body = await req.json().catch(() => ({}));
    const email =
      typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 320) {
      console.error("[lead-capture] invalid_email", { email });
      return new Response(
        JSON.stringify({ error: "invalid_email" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const mode: "upsert" | "update_only" =
      body?.mode === "update_only" ? "update_only" : "upsert";
    const sessionId: string | null =
      typeof body?.sessionId === "string" && body.sessionId.length <= 100
        ? body.sessionId
        : null;
    const fields = sanitize(body?.fields || {});

    console.log("[lead-capture] request", {
      email,
      mode,
      hasSession: !!sessionId,
      fieldKeys: Object.keys(fields),
      status: (fields as any).status,
      source: (fields as any).source,
    });

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: existing, error: lookupError } = await sb
      .from("leads")
      .select(RETURN_COLUMNS)
      .eq("email", email)
      .maybeSingle();

    if (lookupError) {
      console.error("[lead-capture] lookup_failed", { email, message: lookupError.message });
      return new Response(
        JSON.stringify({ error: "lookup_failed", details: lookupError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (existing) {
      const wasDeleted = Boolean((existing as any).deleted_at);
      const previousDeletedBy = (existing as any).deleted_by ?? null;
      const previousDeletedAt = (existing as any).deleted_at ?? null;

      const updatePayload: Record<string, unknown> = { ...fields };
      if (sessionId && !(existing as any).session_id) {
        updatePayload.session_id = sessionId;
      }
      if (wasDeleted) {
        // Restore soft-deleted contact when they re-engage via capture form
        updatePayload.deleted_at = null;
        updatePayload.deleted_by = null;
      }
      if (Object.keys(updatePayload).length > 0) {
        const { error: updateError } = await sb.from("leads").update(updatePayload).eq("id", (existing as any).id);
        if (updateError) {
          console.error("[lead-capture] update_failed", { id: (existing as any).id, message: updateError.message });
          return new Response(
            JSON.stringify({ error: "update_failed", details: updateError.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }

      if (wasDeleted) {
        await sb.from("contact_events").insert({
          lead_id: (existing as any).id,
          dnia_id: (existing as any).dnia_id ?? null,
          source_app: "dnmarketing",
          event_type: "contact_reactivated",
          title: "Contato reativado por nova conversão",
          metadata: {
            previous_deleted_at: previousDeletedAt,
            previous_deleted_by: previousDeletedBy,
            reason: "lead_capture_reconversion",
          },
        });
      }

      const { data: fresh } = await sb
        .from("leads")
        .select(RETURN_COLUMNS)
        .eq("id", (existing as any).id)
        .maybeSingle();
      const finalLead = await ensureIdentity(sb, fresh ?? existing);
      console.log("[lead-capture] updated", { id: (existing as any).id, status: (fields as any).status, dnia_id: (finalLead as any)?.dnia_id });
      return new Response(
        JSON.stringify({ lead: projectLead(finalLead, privileged), isNew: false, reactivated: wasDeleted }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (mode === "update_only") {
      console.log("[lead-capture] update_only_notfound", { email });
      return new Response(
        JSON.stringify({ lead: null, isNew: false, notFound: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const insertPayload: Record<string, unknown> = {
      email,
      session_id: sessionId,
      tipo: (fields as any).tipo || "lead",
      ...fields,
    };

    const { data: created, error: insertError } = await sb
      .from("leads")
      .insert(insertPayload)
      .select(RETURN_COLUMNS)
      .single();

    if (insertError) {
      console.error("[lead-capture] insert_failed", { email, message: insertError.message, payload: insertPayload });
      return new Response(
        JSON.stringify({ error: "insert_failed", details: insertError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const finalCreated = await ensureIdentity(sb, created);
    console.log("[lead-capture] inserted", { id: (created as any)?.id, email, status: (fields as any).status, dnia_id: (finalCreated as any)?.dnia_id });
    return new Response(
      JSON.stringify({ lead: projectLead(finalCreated, privileged), isNew: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[lead-capture] unexpected", { message: (err as Error).message, stack: (err as Error).stack });
    return new Response(
      JSON.stringify({ error: "unexpected", details: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
