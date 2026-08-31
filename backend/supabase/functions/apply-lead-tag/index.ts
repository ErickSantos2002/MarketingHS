import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { identifyCaller, forbidden, PRIVILEGED } from '../_shared/callerAuth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAG_RE = /^[a-z0-9][a-z0-9._\-\/]*$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Chamado pelas landing pages (chave publicavel) e pelo painel/integradores.
  // Requisicoes sem Authorization valido sao rejeitadas.
  const caller = await identifyCaller(req);
  if (caller.kind === 'none') return forbidden(corsHeaders, 401);
  const privileged = PRIVILEGED.includes(caller.kind);

  try {
    const { lead_id, tag } = await req.json();

    if (!UUID_RE.test(String(lead_id || ''))) {
      return new Response(JSON.stringify({ error: 'lead_id must be a valid uuid' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!lead_id || typeof lead_id !== 'string') {
      return new Response(JSON.stringify({ error: 'lead_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Normalize tag: strip leading slashes, lowercase, trim
    const tagName = String(tag || '').replace(/^\/+/, '').trim().toLowerCase();
    if (!tagName) {
      return new Response(JSON.stringify({ error: 'tag is empty after normalization' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Chamadores nao privilegiados (landing pages) so podem aplicar tags derivadas
    // de slug de pagina: tamanho limitado e charset restrito.
    if (!privileged && (tagName.length > 60 || !TAG_RE.test(tagName))) {
      return new Response(JSON.stringify({ error: 'tag not allowed' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Verify lead exists
    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('id')
      .eq('id', lead_id)
      .maybeSingle();

    if (leadErr || !lead) {
      return new Response(JSON.stringify({ error: 'Lead not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Find or create tag
    let tagId: string | null = null;
    const { data: existingTag } = await supabase
      .from('tags')
      .select('id')
      .eq('name', tagName)
      .maybeSingle();

    if (existingTag) {
      tagId = existingTag.id;
    } else {
      const { data: newTag, error: insErr } = await supabase
        .from('tags')
        .insert({ name: tagName })
        .select('id')
        .single();
      if (insErr) {
        // Race condition: tag may have been created in parallel
        const { data: retry } = await supabase
          .from('tags')
          .select('id')
          .eq('name', tagName)
          .maybeSingle();
        tagId = retry?.id || null;
      } else {
        tagId = newTag.id;
      }
    }

    if (!tagId) {
      return new Response(JSON.stringify({ error: 'Failed to upsert tag' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Upsert lead_tag association
    await supabase
      .from('lead_tags')
      .upsert({ lead_id, tag_id: tagId }, { onConflict: 'lead_id,tag_id' });

    return new Response(
      JSON.stringify({ success: true, tag: tagName, tag_id: tagId, lead_id }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('apply-lead-tag error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
