// Admin-only endpoint to read and update Nexus credentials stored in
// `public.nexus_config`. GET returns a masked view; PUT upserts values.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function mask(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v);
  if (s.length <= 4) return '••••';
  return '••••' + s.slice(-4);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Validate the caller as an admin.
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const token = authHeader.replace('Bearer ', '');
  const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
  if (claimsErr || !claimsData?.claims?.sub) return json({ error: 'Unauthorized' }, 401);
  const userId = claimsData.claims.sub as string;

  const admin = createClient(url, serviceKey);
  const { data: hasAdmin, error: roleErr } = await admin.rpc('has_role', {
    _user_id: userId,
    _role: 'admin',
  });
  if (roleErr || !hasAdmin) return json({ error: 'Forbidden' }, 403);

  // Ensure a single-row config exists.
  const { data: existing } = await admin
    .from('nexus_config')
    .select('id, api_key, workspace_id, base_url, updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let row = existing;
  if (!row) {
    const { data: inserted, error: insErr } = await admin
      .from('nexus_config')
      .insert({})
      .select('id, api_key, workspace_id, base_url, updated_at')
      .single();
    if (insErr) return json({ error: insErr.message }, 500);
    row = inserted;
  }

  if (req.method === 'GET') {
    return json({
      workspace_id: row!.workspace_id || '',
      base_url: row!.base_url || '',
      has_api_key: Boolean(row!.api_key),
      api_key_masked: mask(row!.api_key),
      updated_at: row!.updated_at,
    });
  }

  if (req.method === 'PUT') {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }
    const patch: Record<string, unknown> = { updated_by: userId };
    if (typeof body.workspace_id === 'string') {
      patch.workspace_id = body.workspace_id.trim() || null;
    }
    if (typeof body.base_url === 'string') {
      patch.base_url = body.base_url.trim() || null;
    }
    if (typeof body.api_key === 'string') {
      const trimmed = body.api_key.trim();
      // Only overwrite when a non-empty value is provided.
      if (trimmed.length > 0) patch.api_key = trimmed;
    }
    if (body.clear_api_key === true) patch.api_key = null;

    const { data: updated, error: updErr } = await admin
      .from('nexus_config')
      .update(patch)
      .eq('id', row!.id)
      .select('id, api_key, workspace_id, base_url, updated_at')
      .single();
    if (updErr) return json({ error: updErr.message }, 500);

    return json({
      workspace_id: updated.workspace_id || '',
      base_url: updated.base_url || '',
      has_api_key: Boolean(updated.api_key),
      api_key_masked: mask(updated.api_key),
      updated_at: updated.updated_at,
    });
  }

  return json({ error: 'Method not allowed' }, 405);
});
