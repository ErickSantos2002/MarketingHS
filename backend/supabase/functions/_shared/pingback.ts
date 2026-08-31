// Shared helpers for Pingback relay edge functions.
//
// Resolução das URLs de webhook, em ordem: tabela public.pingback_config
// (configurada em /settings > Integrações) -> secret de env
// PINGBACK_WEBHOOK_*_URL (legado). Se nenhuma fonte tiver valor, a função lança
// (fail closed) — não há mais URLs hardcoded no repositório, pois o path da URL
// é o próprio token do webhook.
//
// A leitura da tabela usa o service_role (a tabela é RLS admin-only).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type PingbackChannel = "default" | "modal" | "paid" | "convidado";

const COLUMN_BY_CHANNEL: Record<PingbackChannel, string> = {
  default: "default_url",
  modal: "modal_url",
  paid: "paid_url",
  convidado: "convidado_url",
};

const ENV_BY_CHANNEL: Record<PingbackChannel, string> = {
  default: "PINGBACK_WEBHOOK_URL",
  modal: "PINGBACK_WEBHOOK_MODAL_URL",
  paid: "PINGBACK_WEBHOOK_PAID_URL",
  convidado: "PINGBACK_WEBHOOK_CONVIDADO_URL",
};

export async function resolvePingbackUrl(channel: PingbackChannel): Promise<string> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (url && serviceKey) {
      const sb = createClient(url, serviceKey);
      const { data, error } = await sb
        .from("pingback_config")
        .select(COLUMN_BY_CHANNEL[channel])
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        console.error(`resolvePingbackUrl(${channel}): erro ao ler pingback_config:`, error.message);
      } else {
        const value = (data as Record<string, unknown> | null)?.[COLUMN_BY_CHANNEL[channel]];
        if (typeof value === "string" && value.trim().length > 0) return value.trim();
      }
    }
  } catch (err) {
    console.error(`resolvePingbackUrl(${channel}): exceção inesperada:`, err);
  }

  const envValue = Deno.env.get(ENV_BY_CHANNEL[channel]);
  if (envValue && envValue.trim().length > 0) return envValue.trim();

  // Fail closed: sem configuracao na tabela nem no env nao ha URL para usar.
  // (As URLs hardcoded foram removidas do codigo — o path contem o token do
  // webhook. Configure em /settings > Integracoes > Pingback.)
  throw new Error(`Pingback URL nao configurada para o canal "${channel}"`);
}


export const MAX_PAYLOAD_BYTES = 50_000;

export interface ValidatedPayload {
  email: string;
  customFields?: Array<{ fieldName: string; fieldValue: string }>;
  [k: string]: unknown;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validatePingbackPayload(raw: unknown): { ok: true; data: ValidatedPayload } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Payload must be a JSON object" };
  }
  const p = raw as Record<string, unknown>;

  if (typeof p.email !== "string" || p.email.length > 255 || !EMAIL_RE.test(p.email.trim())) {
    return { ok: false, error: "Invalid or missing 'email'" };
  }

  if (p.customFields !== undefined) {
    if (!Array.isArray(p.customFields) || p.customFields.length > 30) {
      return { ok: false, error: "'customFields' must be an array of <= 30 items" };
    }
    for (const f of p.customFields) {
      if (
        !f || typeof f !== "object" ||
        typeof (f as any).fieldName !== "string" ||
        (f as any).fieldName.length > 100 ||
        typeof (f as any).fieldValue !== "string" ||
        (f as any).fieldValue.length > 2000
      ) {
        return { ok: false, error: "Invalid customField entry" };
      }
    }
  }

  return { ok: true, data: p as ValidatedPayload };
}

export function payloadTooLarge(req: Request): boolean {
  const cl = req.headers.get("content-length");
  return !!cl && parseInt(cl, 10) > MAX_PAYLOAD_BYTES;
}
