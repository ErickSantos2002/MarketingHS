import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validateAuth, unauthorized, ok, error, handleCors } from '../_shared/auth.ts';

interface Input {
  session_id?: string;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'DELETE' && req.method !== 'POST') {
    return error('Method not allowed. Use DELETE or POST.', 405);
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const authorized = await validateAuth(req, sb, 'write');
  if (!authorized) return unauthorized();

  let body: Input = {};
  try {
    if (req.headers.get('content-length') && req.headers.get('content-length') !== '0') {
      body = await req.json();
    }
  } catch {
    return error('Invalid JSON body');
  }

  const url = new URL(req.url);
  const sessionId = body.session_id || url.searchParams.get('session_id') || undefined;

  if (!sessionId || typeof sessionId !== 'string') {
    return error("'session_id' is required");
  }

  // Find existing conversions for this session_id
  const { data: existing, error: lookupErr } = await sb
    .from('lead_conversions')
    .select('id, lead_id, converted_at, tipo, page_slug, session_id')
    .eq('session_id', sessionId);

  if (lookupErr) return error(`Lookup failed: ${lookupErr.message}`, 500);
  if (!existing || existing.length === 0) {
    return error('Conversion not found for the provided session_id', 404);
  }

  // Delete all matching rows
  const { error: delErr } = await sb
    .from('lead_conversions')
    .delete()
    .eq('session_id', sessionId);

  if (delErr) return error(`Delete failed: ${delErr.message}`, 500);

  // Recalculate last_conversion_date for each affected lead
  const leadIds = Array.from(new Set(existing.map((c) => c.lead_id).filter(Boolean)));
  for (const leadId of leadIds) {
    const { data: remaining } = await sb
      .from('lead_conversions')
      .select('converted_at')
      .eq('lead_id', leadId)
      .order('converted_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    await sb
      .from('leads')
      .update({ last_conversion_date: remaining?.converted_at || null })
      .eq('id', leadId);

    // Audit event
    const removed = existing.filter((c) => c.lead_id === leadId);
    await sb.from('contact_events').insert({
      lead_id: leadId,
      source_app: 'dnmarketing',
      event_type: 'conversion_unregistered',
      title: `Conversão removida (session_id: ${sessionId})`,
      metadata: { session_id: sessionId, removed_count: removed.length, removed },
    });
  }

  return ok({
    success: true,
    affected: existing.length,
    deleted: existing,
  });
});
