import { supabase } from "@/integrations/supabase/client";

/**
 * Projeção pública do lead. A Edge Function `lead-capture` NÃO devolve dados
 * pessoais (nome, telefone, empresa...) para chamadores públicos — apenas o
 * identificador, a etiqueta e flags de completude. PII fica restrita a
 * chamadores privilegiados (painel admin / API key / webhook).
 */
export interface CapturedLead {
  id: string;
  session_id: string | null;
  etiqueta: string | null;
  dnia_id: string | null;
  has_nome?: boolean;
  has_whatsapp?: boolean;
  profile_complete?: boolean;
}

export interface CaptureLeadInput {
  email: string;
  sessionId?: string | null;
  mode?: "upsert" | "update_only";
  fields?: Record<string, unknown>;
}

export interface CaptureLeadResult {
  lead: CapturedLead | null;
  isNew: boolean;
  notFound?: boolean;
  error?: string;
}

/**
 * Server-side lead lookup + upsert by email.
 * Replaces the previous client-side public SELECT/UPDATE on the `leads` table.
 */
export async function captureLead(input: CaptureLeadInput): Promise<CaptureLeadResult> {
  try {
    const { data, error } = await supabase.functions.invoke("lead-capture", {
      body: {
        email: input.email,
        sessionId: input.sessionId ?? null,
        mode: input.mode ?? "upsert",
        fields: input.fields ?? {},
      },
    });

    if (error) {
      return { lead: null, isNew: false, error: error.message };
    }
    return {
      lead: (data?.lead as CapturedLead | null) ?? null,
      isNew: !!data?.isNew,
      notFound: !!data?.notFound,
    };
  } catch (err) {
    return { lead: null, isNew: false, error: (err as Error).message };
  }
}
