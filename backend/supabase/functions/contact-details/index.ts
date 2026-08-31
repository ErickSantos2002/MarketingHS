import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateAuth, unauthorized, ok, error, handleCors } from '../_shared/auth.ts'

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  if (!(await validateAuth(req, supabase, 'read'))) return unauthorized()

  try {
    const url = new URL(req.url)
    const phone = url.searchParams.get('phone')
    const email = url.searchParams.get('email')
    const dnia_id = url.searchParams.get('dnia_id')

    if (!phone && !email && !dnia_id) {
      return error('Must provide phone, email, or dnia_id', 400)
    }

    // 1. Find identity
    let query = supabase.from('ecosystem_identities').select('*')

    if (dnia_id) {
      query = query.eq('dnia_id', dnia_id)
    } else if (phone) {
      const { data: normalized } = await supabase.rpc('normalize_phone_br', { raw: phone })
      query = query.eq('phone', normalized || phone)
    } else if (email) {
      query = query.ilike('email', email.trim().toLowerCase())
    }

    const { data: identity, error: idError } = await query.maybeSingle()

    if (idError) {
      console.error('Identity lookup error:', idError)
      return error('Internal error', 500)
    }

    if (!identity) {
      return error('Contact not found', 404)
    }

    const leadId = identity.dndash_lead_id

    // 2-8. Fetch all related data in parallel
    const [leadRes, tagsRes, notesRes, eventsRes, conversionsRes, campaignsRes, segmentsRes] = await Promise.all([
      leadId
        ? supabase.from('leads').select('*').eq('id', leadId).maybeSingle()
        : Promise.resolve({ data: null }),
      leadId
        ? supabase.from('lead_tags').select('tag_id, tags(id, name, color)').eq('lead_id', leadId)
        : Promise.resolve({ data: [] }),
      leadId
        ? supabase.from('lead_notes').select('id, content, created_at').eq('lead_id', leadId).order('created_at', { ascending: false }).limit(10)
        : Promise.resolve({ data: [] }),
      supabase.from('contact_events').select('*')
        .or(`dnia_id.eq.${identity.dnia_id}${leadId ? `,lead_id.eq.${leadId}` : ''}`)
        .order('occurred_at', { ascending: false }).limit(50),
      leadId
        ? supabase.from('lead_conversions').select('id, page_slug, converted_at, tipo, utm_source, utm_campaign').eq('lead_id', leadId).order('converted_at', { ascending: false })
        : Promise.resolve({ data: [] }),
      leadId
        // nullsFirst:false: a partir da Fase 3 os sends nascem 'pending' com sent_at NULL,
        // e em Postgres NULLS vem PRIMEIRO num ORDER BY DESC -- sem isso a timeline mostraria
        // os ainda-nao-enviados acima dos que ja sairam.
        ? supabase.from('campaign_sends').select('id, status, sent_at, opened_at, clicked_at, campaigns(id, name, channel, sent_at)').eq('lead_id', leadId).order('sent_at', { ascending: false, nullsFirst: false }).limit(20)
        : Promise.resolve({ data: [] }),
      leadId
        ? supabase.from('segment_contacts').select('segment_id, segments(id, name, type)').eq('lead_id', leadId)
        : Promise.resolve({ data: [] }),
    ])

    const lead = leadRes.data as Record<string, unknown> | null
    const leadTags = (tagsRes.data || []) as Array<Record<string, unknown>>
    const notes = (notesRes.data || []) as Array<Record<string, unknown>>
    const events = (eventsRes.data || []) as Array<Record<string, unknown>>
    const conversions = (conversionsRes.data || []) as Array<Record<string, unknown>>
    const campaigns = (campaignsRes.data || []) as Array<Record<string, unknown>>
    const segments = (segmentsRes.data || []) as Array<Record<string, unknown>>

    // Ecosystem presence
    const ecosystem = {
      dnmarketing: true,
      nexus: !!identity.nexus_contact_id,
      mentoria: !!identity.mentoria_client_id,
      nexus_contact_id: identity.nexus_contact_id || null,
      mentoria_client_id: identity.mentoria_client_id || null,
    }

    // ===== status_history (inferred from event_type, works on historical data) =====
    const inferMap: Record<string, string> = {
      meeting_scheduled: 'MQL - Reunião agendada',
      scheduling_widget_booked: 'MQL - Reunião agendada',
      lead_qualified: 'Lead Qualificado',
      deal_won: 'Venda realizada',
      deal_lost: 'Perdido',
      onboarding_started: 'Cliente - Onboarding',
    }
    const trackedTypes = new Set([...Object.keys(inferMap), 'deal_moved'])

    const orderedEvents = [...events]
      .filter((e) => trackedTypes.has(String(e.event_type)))
      .sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)))

    const status_history: Array<Record<string, unknown>> = []
    let prevTo: string = 'Lead'
    for (const ev of orderedEvents) {
      const md = (ev.metadata as Record<string, unknown> | null) || {}
      const evType = String(ev.event_type)
      let to: string | null = null
      // Prefer explicit metadata.to_status if present
      const explicitTo = (md.to_status as string | undefined) || null
      const explicitFrom = (md.from_status as string | undefined) || null
      if (explicitTo) {
        to = explicitTo
      } else if (evType === 'deal_moved') {
        to = (md.to_stage as string | undefined) || (md.stage as string | undefined) || null
      } else {
        to = inferMap[evType] || null
      }
      if (!to) continue
      // Collapse only CONSECUTIVE duplicates (prevTo is updated each iteration).
      // Re-entry like MQL → Lead → MQL produces 3 distinct entries — by design.
      if (to === prevTo) continue
      status_history.push({
        from: explicitFrom || prevTo,
        to,
        at: ev.occurred_at,
        source_app: ev.source_app,
        event_type: evType,
      })
      prevTo = to
    }

    const leadScore = lead?.lead_score as number | null
    const etiqueta = lead?.etiqueta as string | null

    return ok({
      // Identity
      dnia_id: identity.dnia_id,
      stage: identity.stage,
      first_touch_app: identity.first_touch_app,
      first_touch_source: identity.first_touch_source,
      last_seen_at: identity.last_seen_at,

      // Lead data
      lead: lead ? {
        id: lead.id,
        nome: lead.nome,
        email: lead.email,
        whatsapp: lead.whatsapp,
        phone_normalized: lead.phone_normalized,
        cargo: lead.cargo,
        empresa: lead.empresa,
        faturamento: lead.faturamento,
        funcionarios: lead.funcionarios,
        etiqueta: lead.etiqueta,
        lead_score: lead.lead_score,
        status: lead.status,
        utm_source: lead.utm_source,
        utm_campaign: lead.utm_campaign,
        page_slug: lead.source,
        created_at: lead.created_at,
      } : null,

      // Score breakdown
      scoring: lead ? {
        score: leadScore,
        etiqueta,
        faixa: (leadScore ?? 0) >= 70 ? 'hotlead' : (leadScore ?? 0) >= 40 ? 'warm' : 'raw',
      } : null,

      // Tags
      tags: leadTags.map((lt: Record<string, unknown>) => lt.tags),

      // Segments
      segments: segments.map((s: Record<string, unknown>) => s.segments),

      // Notes
      notes,

      // Ecosystem
      ecosystem,

      // Status history (inferred from events; works for historical data)
      status_history,

      // Timeline
      timeline: events.map((e: Record<string, unknown>) => ({
        id: e.id,
        source_app: e.source_app,
        event_type: e.event_type,
        title: e.title,
        description: e.description,
        metadata: e.metadata,
        occurred_at: e.occurred_at,
      })),

      // Conversions
      conversions: conversions.map((c: Record<string, unknown>) => ({
        page_slug: c.page_slug,
        tipo: c.tipo,
        utm_source: c.utm_source,
        utm_campaign: c.utm_campaign,
        converted_at: c.converted_at,
      })),

      // Campaigns received
      campaigns_received: campaigns.map((c: Record<string, unknown>) => {
        const camp = c.campaigns as Record<string, unknown> | null
        return {
          campaign_name: camp?.name,
          channel: camp?.channel,
          status: c.status,
          sent_at: c.sent_at,
          opened_at: c.opened_at,
          clicked_at: c.clicked_at,
        }
      }),
    })
  } catch (err) {
    console.error('Unexpected error:', err)
    return error('Internal server error', 500)
  }
})
