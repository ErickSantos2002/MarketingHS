import { supabase } from "@/integrations/supabase/client";
import { getUtmParams } from "@/lib/utm";
import { getAbParams, recordAbConversion } from "@/lib/ab";

interface ConversionParams {
  leadId: string;
  tipo: string;
  pageSlug: string;
  sessionId?: string | null;
  source?: string | null;
  utmOverrides?: Partial<{
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_term: string | null;
    utm_content: string | null;
  }>;
}

export async function registerConversion(params: ConversionParams) {
  const utmParams = params.utmOverrides || getUtmParams();
  const ab = getAbParams();
  const now = new Date().toISOString();

  try {
    // 1. Insert into lead_conversions (com a variante A/B, quando houver)
    await supabase.from("lead_conversions").insert({
      lead_id: params.leadId,
      tipo: params.tipo,
      converted_at: now,
      page_slug: params.pageSlug,
      session_id: params.sessionId || null,
      source: params.source || null,
      utm_source: utmParams.utm_source || null,
      utm_medium: utmParams.utm_medium || null,
      utm_campaign: utmParams.utm_campaign || null,
      utm_term: utmParams.utm_term || null,
      utm_content: utmParams.utm_content || null,
      ab_test: ab.ab_test,
      ab_var: ab.ab_var,
      ab_vid: ab.ab_vid,
      // colunas ab_* ainda ausentes do types.ts auto-gerado (não editar o gerado)
    } as never);

    // 2. `leads.last_conversion_date` e as colunas ab_* de last-touch são
    // atualizadas no servidor pelo trigger de `lead_conversions` — o cliente não
    // escreve mais direto na tabela `leads` (sem UPDATE público via Data API).

    // 3. Conversão A/B `lead_criado` no coletor (fire-and-forget, idempotente)
    recordAbConversion("lead_criado", { lead_id: params.leadId, page_slug: params.pageSlug });

    // 4. Apply route-based tag (fire-and-forget)
    const tagName = (params.pageSlug || "").replace(/^\/+/, "").trim().toLowerCase();
    if (tagName) {
      supabase.functions
        .invoke("apply-lead-tag", { body: { lead_id: params.leadId, tag: tagName } })
        .catch((err) => console.error("apply-lead-tag error:", err));
    }
  } catch (err) {
    console.error("Erro ao registrar conversão:", err);
  }
}
