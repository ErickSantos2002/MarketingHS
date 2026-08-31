import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TICKETIA_BASE = 'https://ticketia.dnia.ai/api/webhooks/participants';

interface LeadPayload {
  nome?: string;
  email?: string;
  whatsapp?: string;
  empresa?: string;
  cargo?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { slug, lead, test } = body as { slug?: string; lead?: LeadPayload; test?: boolean };

    if (!slug) {
      return new Response(JSON.stringify({ error: 'slug required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: page, error: pageError } = await supabase
      .from('pages')
      .select('config')
      .eq('slug', slug)
      .maybeSingle();

    if (pageError || !page) {
      return new Response(JSON.stringify({ error: 'page not found', slug }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const ticketia = (page.config as any)?.ticketia || {};
    const { enabled, event_id, event_api_key, user_api_key } = ticketia;

    // Em produção (não-teste), respeita o toggle. Em modo teste, sempre tenta validar credenciais.
    if (!enabled && !test) {
      return new Response(JSON.stringify({ skipped: true, reason: 'integration disabled' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!event_id || !event_api_key || !user_api_key) {
      return new Response(JSON.stringify({ error: 'missing ticketia credentials' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const leadData: LeadPayload = test
      ? {
          nome: 'Teste dnMarketing',
          email: `teste+${Date.now()}@dnia.ai`,
          whatsapp: '5531999999999',
          empresa: 'Teste',
          cargo: 'Teste',
        }
      : lead || {};

    const payload = {
      fullName: leadData.nome || '',
      email: leadData.email || '',
      whatsapp: leadData.whatsapp || '',
      company: leadData.empresa || '',
      position: leadData.cargo || '',
    };

    const url = `${TICKETIA_BASE}/${event_id}`;
    console.log('[ticketia] POST', url, 'test:', !!test);

    const ticketiaRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': event_api_key,
        'x-user-api-key': user_api_key,
      },
      body: JSON.stringify(payload),
    });

    const responseText = await ticketiaRes.text();
    let responseBody: any = responseText;
    try { responseBody = JSON.parse(responseText); } catch { /* keep text */ }

    console.log('[ticketia] response', ticketiaRes.status, responseBody);

    return new Response(
      JSON.stringify({
        success: ticketiaRes.ok,
        status: ticketiaRes.status,
        body: responseBody,
      }),
      {
        status: ticketiaRes.ok ? 200 : 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (err) {
    console.error('[ticketia] error', err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
