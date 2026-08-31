import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validateAuth, unauthorized, ok, error, handleCors } from '../_shared/auth.ts';

interface Input {
  session_id?: string;
  converted_at?: string;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'PATCH' && req.method !== 'POST') {
    return error('Method not allowed. Use PATCH or POST.', 405);
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const authorized = await validateAuth(req, sb, 'write');
  if (!authorized) return unauthorized();

  let body: Input;
  try {
    body = await req.json();
  } catch {
    return error('Invalid JSON body');
  }

  const sessionId = body.session_id;
  const convertedAt = body.converted_at;

  if (!sessionId || typeof sessionId !== 'string') {
    return error("'session_id' is required");
  }
  if (!convertedAt || typeof convertedAt !== 'string') {
    return error("'converted_at' is required (ISO 8601 timestamp)");
  }

  const parsed = new Date(convertedAt);
  if (isNaN(parsed.getTime())) {
    return error("'converted_at' must be a valid ISO 8601 timestamp");
  }
  const newConvertedAt = parsed.toISOString();

  // Find existing
  const { data: existing, error: lookupErr } = await sb
    .from('lead_conversions')
    .select('id, lead_id, converted_at, tipo, page_slug, session_id')
    .eq('session_id', sessionId);

  if (lookupErr) return error(`Lookup failed: ${lookupErr.message}`, 500);
  if (!existing || existing.length === 0) {
    return error('Conversion not found for the provided session_id', 404);
  }

  // Update all matching rows
  const { data: updated, error: updErr } = await sb
    .from('lead_conversions')
    .update({ converted_at: newConvertedAt })
    .eq('session_id', sessionId)
    .select();

  if (updErr) return error(`Update failed: ${updErr.message}`, 500);

  // Recalculate last_conversion_date for each affected lead
  const leadIds = Array.from(new Set(existing.map((c) => c.lead_id).filter(Boolean)));
  for (const leadId of leadIds) {
    const { data: latest } = await sb
      .from('lead_conversions')
      .select('converted_at')
      .eq('lead_id', leadId)
      .order('converted_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    await sb
      .from('leads')
      .update({ last_conversion_date: latest?.converted_at || null })
      .eq('id', leadId);

    const before = existing.filter((c) => c.lead_id === leadId);
    await sb.from('contact_events').insert({
      lead_id: leadId,
      source_app: 'dnmarketing',
      event_type: 'conversion_updated',
      title: `Conversão atualizada (session_id: ${sessionId})`,
      metadata: {
        session_id: sessionId,
        new_converted_at: newConvertedAt,
        previous: before.map((b) => ({ id: b.id, converted_at: b.converted_at })),
      },
    });
  }

  return ok({
    success: true,
    affected: existing.length,
    updated,
  });
});
