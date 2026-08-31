// Admin-only endpoint para ler/atualizar as credenciais do Meta (Conversions
// API) armazenadas em `public.meta_config`. Mesmo padrão de nexus-config e
// pingback-config: GET devolve visão mascarada, PUT grava.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
};

const FIELDS = ['pixel_id', 'access_token', 'test_event_code'] as const;
type Field = typeof FIELDS[number];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function maskSecret(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v);
  if (s.length <= 8) return '••••';
  return `${s.slice(0, 4)}••••${s.slice(-4)}`;
}

function view(row: Record<string, any>) {
  return {
    updated_at: row.updated_at,
    has_pixel_id: Boolean(row.pixel_id),
    // Pixel ID não é secreto: mostra na íntegra para o admin conferir.
    pixel_id: row.pixel_id ?? null,
    has_access_token: Boolean(row.access_token),
    access_token_masked: maskSecret(row.access_token),
    has_test_event_code: Boolean(row.test_event_code),
    test_event_code: row.test_event_code ?? null,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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

  const select = `id, ${FIELDS.join(', ')}, updated_at`;

  const { data: existing } = await admin
    .from('meta_config')
    .select(select)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let row = existing as Record<string, any> | null;
  if (!row) {
    const { data: inserted, error: insErr } = await admin
      .from('meta_config')
      .insert({})
      .select(select)
      .single();
    if (insErr) return json({ error: insErr.message }, 500);
    row = inserted as Record<string, any>;
  }

  if (req.method === 'GET') return json(view(row!));

  if (req.method === 'PUT') {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }

    const patch: Record<string, unknown> = { updated_by: userId };
    for (const f of FIELDS) {
      if (body?.clear?.[f] === true) {
        patch[f] = null;
        continue;
      }
      const raw = body?.[f];
      if (typeof raw !== 'string') continue;
      const trimmed = raw.trim();
      // Vazio = manter o valor atual (a UI envia campos em branco).
      if (trimmed.length === 0) continue;
      if (f === 'pixel_id' && !/^\d{6,25}$/.test(trimmed)) {
        return json({ error: 'Pixel ID inválido: use apenas dígitos' }, 400);
      }
      if (f === 'access_token' && trimmed.length < 20) {
        return json({ error: 'Access token inválido: muito curto' }, 400);
      }
      patch[f] = trimmed;
    }

    const { data: updated, error: updErr } = await admin
      .from('meta_config')
      .update(patch)
      .eq('id', row!.id)
      .select(select)
      .single();
    if (updErr) return json({ error: updErr.message }, 500);

    return json(view(updated as Record<string, any>));
  }

  return json({ error: 'Method not allowed' }, 405);
});
