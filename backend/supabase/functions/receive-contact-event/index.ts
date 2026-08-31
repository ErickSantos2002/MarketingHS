import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateAuth, handleCors } from '../_shared/auth.ts'
import { extractAbParams, attachVisitorToContact, recordConversion } from '../_shared/ab.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Validate auth (API key or WEBHOOK_SECRET)
    if (!(await validateAuth(req, supabase, 'write'))) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json()
    const { phone, email, dnia_id, nome, source_app, event_type, title, description, metadata, occurred_at } = body
    // Accept custom qualification fields either at top level or nested under metadata.contact_fields
    const contactFields: Record<string, unknown> = {
      ...((metadata && typeof metadata === 'object' && (metadata as any).contact_fields) || {}),
      ...((body && typeof body === 'object' && (body as any).contact_fields) || {}),
    }
    const ENRICHABLE_KEYS = ['cargo', 'empresa', 'faturamento', 'funcionarios', 'desafios'] as const
    const enrichPayload: Record<string, unknown> = {}
    for (const k of ENRICHABLE_KEYS) {
      const v = contactFields[k]
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        enrichPayload[k] = v
      }
    }

    if (!source_app || !event_type || !title) {
      return new Response(JSON.stringify({ error: 'Missing required fields: source_app, event_type, title' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!['nexus', 'mentoria', 'dnmarketing', 'website'].includes(source_app)) {
      return new Response(JSON.stringify({ error: 'Invalid source_app. Must be nexus, mentoria, dnmarketing or website' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let uid = dnia_id
    if (!uid) {
      if (!phone && !email) {
        return new Response(JSON.stringify({ error: 'Must provide dnia_id, phone, or email' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data, error: rpcError } = await supabase.rpc('resolve_or_create_identity', {
        p_phone: phone || null,
        p_email: email || null,
        p_nome: nome || null,
        p_source_app: source_app,
        p_stage: event_type === 'deal_won' ? 'client'
          : event_type === 'opportunity_created' ? 'opportunity'
          : null,
      })

      if (rpcError) {
        console.error('resolve_or_create_identity error:', rpcError)
        return new Response(JSON.stringify({ error: 'Failed to resolve identity' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      uid = (data as any)?.dnia_id
    }

    if (!uid) {
      return new Response(JSON.stringify({ error: 'Could not resolve identity' }), {
        status: 422,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: identity } = await supabase
      .from('ecosystem_identities')
      .select('dndash_lead_id, email, phone, nome')
      .eq('dnia_id', uid)
      .single()

    let leadId = identity?.dndash_lead_id || null

    // Auto-create lead if missing — mirrors identity-upsert behavior
    // so contacts that arrive from Nexus (or any source) become visible in dnMarketing
    if (!leadId) {
      try {
        // Use the event's occurred_at as created_at so the lead reflects the
        // real first-touch timestamp from the source platform (e.g. Nexus),
        // not the moment the webhook happened to arrive at dnMarketing.
        const eventTs = occurred_at || new Date().toISOString()
        const { data: newLead, error: leadErr } = await supabase
          .from('leads')
          .insert({
            tipo: 'externo',
            nome: nome || identity?.nome || null,
            email: email || identity?.email || null,
            whatsapp: phone || identity?.phone || null,
            phone_normalized: identity?.phone || null,
            source: source_app,
            dnia_id: uid,
            status: 'Lead',
            created_at: eventTs,
            updated_at: eventTs,
            last_conversion_date: null,
            ...enrichPayload,
          })
          .select('id')
          .single()

        if (leadErr) {
          console.error('Auto-create lead error:', leadErr)
        } else if (newLead) {
          leadId = newLead.id
          await supabase
            .from('ecosystem_identities')
            .update({ dndash_lead_id: newLead.id })
            .eq('dnia_id', uid)

          // The fn_lead_insert_event trigger always stamps a 'form_submitted'
          // event with occurred_at=now(). For externally-sourced leads (Nexus,
          // Mentoria) that is misleading and pollutes "Hoje" filters — remove
          // it so the timeline only contains the real source event we're about
          // to insert below.
          if (source_app !== 'dnmarketing') {
            await supabase
              .from('contact_events')
              .delete()
              .eq('lead_id', newLead.id)
              .eq('source_app', 'dnmarketing')
              .eq('event_type', 'form_submitted')
          }
        }
      } catch (leadCreateErr) {
        console.error('Auto-create lead unexpected error:', leadCreateErr)
    }

    // Enrich existing lead — fill only null/empty fields, never overwrite
    if (leadId && Object.keys(enrichPayload).length > 0) {
      try {
        const { data: existing } = await supabase
          .from('leads')
          .select('cargo, empresa, faturamento, funcionarios, desafios')
          .eq('id', leadId)
          .single()
        if (existing) {
          const patch: Record<string, unknown> = {}
          for (const k of Object.keys(enrichPayload)) {
            const current = (existing as Record<string, unknown>)[k]
            if (current === null || current === undefined || String(current).trim() === '') {
              patch[k] = enrichPayload[k]
            }
          }
          if (Object.keys(patch).length > 0) {
            await supabase.from('leads').update(patch).eq('id', leadId)
          }
        }
      } catch (enrichErr) {
        console.error('Enrich lead error (non-blocking):', enrichErr)
      }
    }
    }

    const { data: event, error: insertError } = await supabase
      .from('contact_events')
      .insert({
        dnia_id: uid,
        lead_id: leadId,
        source_app,
        event_type,
        title,
        description: description || null,
        metadata: metadata || {},
        occurred_at: occurred_at || new Date().toISOString(),
      })
      .select()
      .single()

    if (insertError) {
      console.error('Insert error:', insertError)
      return new Response(JSON.stringify({ error: insertError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Costura A/B + conversão de agendamento (server-side, via API existente).
    // Fallback por email/whatsapp quando a chamada chega sem ab_vid.
    const ab = extractAbParams(body)
    const stitched = await attachVisitorToContact(supabase, {
      ab,
      email: email || identity?.email || null,
      phone: phone || identity?.phone || null,
      phone_normalized: identity?.phone || null,
      lead_id: leadId,
      dnia_id: uid,
      source_app,
      metadata: { origin: 'receive-contact-event', event_type },
    })
    if (['meeting_scheduled', 'scheduling_widget_booked'].includes(event_type)) {
      await recordConversion(supabase, {
        ab: stitched,
        name: 'agendamento',
        lead_id: leadId,
        dnia_id: uid,
        metadata: { event_type },
      })
    }

    if (event_type === 'deal_won') {
      await supabase.rpc('resolve_or_create_identity', {
        p_phone: phone || null,
        p_email: email || null,
        p_source_app: source_app,
        p_stage: 'client',
      })
      if (identity?.dndash_lead_id) {
        await supabase.from('leads')
          .update({ status: 'Qualificado' })
          .eq('id', identity.dndash_lead_id)
      }
    }

    if (event_type === 'health_updated') {
      await supabase
        .from('ecosystem_identities')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('dnia_id', uid)
    }

    return new Response(JSON.stringify({
      success: true,
      event_id: event.id,
      dnia_id: uid,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Unexpected error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
