import { captureLead } from "@/lib/leadCapture";

/**
 * Resolução de identidade (dnia_id) para um lead.
 *
 * SEGURANÇA: antes isso era feito no navegador chamando a RPC
 * `resolve_or_create_identity` e escrevendo direto em `public.leads` com a chave
 * publicável. Ambos foram removidos: a resolução acontece no servidor, dentro da
 * Edge Function `lead-capture` (ensureIdentity), que roda com service role e
 * grava `dnia_id`/`phone_normalized` no lead.
 *
 * Fire-and-forget: erros são logados e não quebram o fluxo de conversão.
 */
export async function resolveIdentityForLead(params: {
  leadId: string;
  whatsapp?: string | null;
  email?: string | null;
  nome?: string | null;
  utm_source?: string | null;
}) {
  const email = params.email?.trim().toLowerCase();
  if (!email) return null;

  try {
    const { lead, error } = await captureLead({
      email,
      mode: "update_only",
      fields: {
        ...(params.whatsapp ? { whatsapp: params.whatsapp } : {}),
        ...(params.nome ? { nome: params.nome } : {}),
        ...(params.utm_source ? { utm_source: params.utm_source } : {}),
      },
    });

    if (error) {
      console.error("resolveIdentityForLead error:", error);
      return null;
    }

    return lead?.dnia_id ? { dnia_id: lead.dnia_id } : null;
  } catch (err) {
    console.error("resolveIdentityForLead error:", err);
    return null;
  }
}
