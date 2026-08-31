import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { validateAuth, unauthorized, ok, error, handleCors } from '../_shared/auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ConversionInput {
  lead_id?: string;
  dnia_id?: string;
  email?: string;
  phone?: string;
  tipo: string;
  page_slug: string;
  session_id?: string | null;
  converted_at?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
  source?: string | null;
  apply_tag?: boolean;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return error('Method not allowed', 405);
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const authorized = await validateAuth(req, sb, 'write');
  if (!authorized) return unauthorized();

  let body: ConversionInput;
  try {
    body = await req.json();
  } catch {
    return error('Invalid JSON body');
  }

  if (!body.tipo || typeof body.tipo !== 'string') return error("'tipo' is required");
  if (!body.page_slug || typeof body.page_slug !== 'string') return error("'page_slug' is required");

  // Resolve lead — multiple strategies to tolerate case/format mismatches
  // and to find leads auto-created via /identity-upsert.
  let leadId = body.lead_id;
  if (!leadId) {
    if (!body.dnia_id && !body.email && !body.phone) {
      return error("Provide 'lead_id', 'dnia_id', 'email' or 'phone' to identify the lead");
    }

    const emailNorm = body.email ? body.email.trim().toLowerCase() : null;
    const phoneRaw = body.phone ? String(body.phone).trim() : null;
    let phoneNorm: string | null = null;
    if (phoneRaw) {
      const { data: norm } = await sb.rpc('normalize_phone_br', { raw: phoneRaw });
      phoneNorm = (norm as string | null) || null;
    }

    // 1) dnia_id (most precise)
    if (!leadId && body.dnia_id) {
      const { data } = await sb.from('leads').select('id').eq('dnia_id', body.dnia_id).limit(1).maybeSingle();
      if (data) leadId = data.id;
    }

    // 2) email (case-insensitive)
    if (!leadId && emailNorm) {
      const { data } = await sb
        .from('leads').select('id').ilike('email', emailNorm)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (data) leadId = data.id;
    }

    // 3) phone — try normalized first, then raw
    if (!leadId && phoneNorm) {
      const { data } = await sb
        .from('leads').select('id').eq('phone_normalized', phoneNorm)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (data) leadId = data.id;
    }
    if (!leadId && phoneRaw) {
      const { data } = await sb
        .from('leads').select('id').eq('whatsapp', phoneRaw)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (data) leadId = data.id;
    }

    // 4) Fallback via ecosystem_identities → leads (catches leads created by /identity-upsert
    //    before any normalization happened on the leads table)
    if (!leadId && (emailNorm || phoneNorm)) {
      let idQuery = sb.from('ecosystem_identities').select('dnia_id, dndash_lead_id').limit(1);
      if (emailNorm) idQuery = idQuery.ilike('email', emailNorm);
      else if (phoneNorm) idQuery = idQuery.eq('phone', phoneNorm);
      const { data: ident } = await idQuery.maybeSingle();
      if (ident?.dndash_lead_id) {
        leadId = ident.dndash_lead_id as string;
      } else if (ident?.dnia_id) {
        const { data: leadByDnia } = await sb
          .from('leads').select('id').eq('dnia_id', ident.dnia_id)
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (leadByDnia) leadId = leadByDnia.id;
      }
    }

    if (!leadId) return error('Lead not found', 404);
  }


  const now = body.converted_at || new Date().toISOString();

  // 1. Insert conversion
  const { data: conv, error: insertErr } = await sb
    .from('lead_conversions')
    .insert({
      lead_id: leadId,
      tipo: body.tipo,
      converted_at: now,
      page_slug: body.page_slug,
      session_id: body.session_id || null,
      utm_source: body.utm_source || null,
      utm_medium: body.utm_medium || null,
      utm_campaign: body.utm_campaign || null,
      utm_term: body.utm_term || null,
      utm_content: body.utm_content || null,
      source: body.source || null,
    })
    .select()
    .single();

  if (insertErr) return error(`Insert failed: ${insertErr.message}`, 500);

  // 2. Update last_conversion_date + source/tipo + UTMs (when provided)
  const leadUpdate: Record<string, unknown> = { last_conversion_date: now };
  if (body.source) leadUpdate.source = body.source;
  if (body.tipo) leadUpdate.tipo = body.tipo;
  if (body.utm_source) leadUpdate.utm_source = body.utm_source;
  if (body.utm_medium) leadUpdate.utm_medium = body.utm_medium;
  if (body.utm_campaign) leadUpdate.utm_campaign = body.utm_campaign;
  if (body.utm_term) leadUpdate.utm_term = body.utm_term;
  if (body.utm_content) leadUpdate.utm_content = body.utm_content;
  await sb.from('leads').update(leadUpdate).eq('id', leadId);

  // 3. Apply tag (fire-and-forget)
  if (body.apply_tag !== false) {
    const tagName = (body.page_slug || '').replace(/^\/+/, '').trim().toLowerCase();
    if (tagName) {
      sb.functions
        .invoke('apply-lead-tag', { body: { lead_id: leadId, tag: tagName } })
        .catch((err) => console.error('apply-lead-tag error:', err));
    }
  }

  return ok({ success: true, lead_id: leadId, conversion: conv });
});
