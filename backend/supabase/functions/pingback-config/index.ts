// Admin-only endpoint para ler/atualizar as URLs de webhook do Pingback
// armazenadas em `public.pingback_config`. Mesmo padrão de nexus-config:
// GET devolve uma visão mascarada (a URL contém o token do webhook), PUT
// grava. Substitui os secrets PINGBACK_WEBHOOK_*_URL das Edge Functions.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
};

const FIELDS = ['default_url', 'modal_url', 'paid_url', 'convidado_url'] as const;
type Field = typeof FIELDS[number];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// A URL inteira é sensível (o path contém o token do webhook). Mostra só o
// host e os últimos 6 caracteres, o suficiente para o admin identificar qual
// webhook está salvo sem permitir reuso.
function mask(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v);
  let host = '';
  try {
    host = new URL(s).host;
  } catch {
    host = '';
  }
  const tail = s.length <= 6 ? s : s.slice(-6);
  return host ? `${host}/…${tail}` : `…${tail}`;
}

function isValidHttpsUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

function view(row: Record<string, any>) {
  const out: Record<string, unknown> = { updated_at: row.updated_at };
  for (const f of FIELDS) {
    out[`has_${f}`] = Boolean(row[f]);
    out[`${f}_masked`] = mask(row[f]);
  }
  return out;
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
    .from('pingback_config')
    .select(select)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let row = existing as Record<string, any> | null;
  if (!row) {
    const { data: inserted, error: insErr } = await admin
      .from('pingback_config')
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
      // Vazio = manter o valor atual (o input da UI vem em branco por padrão).
      if (trimmed.length === 0) continue;
      if (!isValidHttpsUrl(trimmed)) {
        return json({ error: `Valor inválido para ${f}: informe uma URL https válida` }, 400);
      }
      patch[f] = trimmed;
    }

    const { data: updated, error: updErr } = await admin
      .from('pingback_config')
      .update(patch)
      .eq('id', row!.id)
      .select(select)
      .single();
    if (updErr) return json({ error: updErr.message }, 500);

    return json(view(updated as Record<string, any>));
  }

  return json({ error: 'Method not allowed' }, 405);
});
