import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateAuth, unauthorized, ok, error, handleCors } from '../_shared/auth.ts'

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const url = new URL(req.url)

  if (req.method === 'GET') {
    if (!(await validateAuth(req, sb, 'read'))) return unauthorized()

    const id = url.searchParams.get('id')

    if (id) {
      // id is interpolated into SQL below — validate UUID format first
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return error('Invalid id', 400)
      }

      const { data: campaign, error: cErr } = await sb.from('campaigns').select('*').eq('id', id).single()
      if (cErr || !campaign) return error('Campanha não encontrada', 404)

      // Get segment name
      let segment_name: string | null = null
      if (campaign.segment_id) {
        const { data: seg } = await sb.from('segments').select('name').eq('id', campaign.segment_id).single()
        segment_name = seg?.name || null
      }

      // Get first 20 sends
      // nullsFirst:false: a partir da Fase 3 os sends nascem 'pending' com sent_at NULL,
      // e em Postgres NULLS vem PRIMEIRO num ORDER BY DESC -- sem isso a lista mostraria
      // os ainda-nao-enviados acima dos que ja sairam.
      const { data: sends } = await sb.from('campaign_sends')
        .select('id, lead_id, dnia_id, channel, status, sent_at, opened_at, clicked_at, error')
        .eq('campaign_id', id).order('sent_at', { ascending: false, nullsFirst: false }).limit(20)

      // Live stats aggregated from campaign_sends (statuses advanced by resend-webhook).
      // Roll-up semantics: sent ⊇ delivered ⊇ opened ⊇ clicked.
      let stats = campaign.stats
      const { data: aggRows, error: aggErr } = await sb.rpc('execute_readonly_query', {
        query_text: `SELECT status, count(*)::int AS n FROM campaign_sends WHERE campaign_id = '${id}' GROUP BY status`,
      })
      if (aggErr) {
        console.error('campaign stats aggregation failed, falling back to campaigns.stats:', aggErr)
      } else {
        const m: Record<string, number> = {}
        for (const r of (aggRows ?? []) as Array<{ status: string; n: number }>) m[r.status] = r.n
        const clickedN = m.clicked ?? 0
        const openedN = clickedN + (m.opened ?? 0)
        const deliveredN = openedN + (m.delivered ?? 0)
        const sentN = deliveredN + (m.sent ?? 0)
        stats = {
          pending: m.pending ?? 0,
          sent: sentN,
          delivered: deliveredN,
          opened: openedN,
          clicked: clickedN,
          bounced: m.bounced ?? 0,
          complained: m.complained ?? 0,
          failed: m.failed ?? 0,
          unsubscribed: m.unsubscribed ?? 0,
          suppressed: m.suppressed ?? 0,
        }
      }

      return ok({ ...campaign, stats, segment_name, sends: sends || [] })
    }

    // List campaigns
    const status = url.searchParams.get('status')
    const channel = url.searchParams.get('channel')
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '20')))
    const offset = (page - 1) * limit

    let query = sb.from('campaigns').select('*', { count: 'exact' })
    if (status) query = query.eq('status', status)
    if (channel) query = query.eq('channel', channel)
    query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1)

    const { data: campaigns, count, error: listErr } = await query
    if (listErr) return error(listErr.message, 500)

    // Enrich with segment names
    const segIds = [...new Set((campaigns || []).map((c: any) => c.segment_id).filter(Boolean))]
    let segMap: Record<string, string> = {}
    if (segIds.length > 0) {
      const { data: segs } = await sb.from('segments').select('id, name').in('id', segIds)
      segMap = Object.fromEntries((segs || []).map((s: any) => [s.id, s.name]))
    }

    const result = (campaigns || []).map((c: any) => ({
      ...c,
      segment_name: c.segment_id ? segMap[c.segment_id] || null : null
    }))

    const total = count || 0
    return ok({
      data: result,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    })
  }

  if (req.method === 'POST') {
    if (!(await validateAuth(req, sb, 'write'))) return unauthorized()

    const action = url.searchParams.get('action')
    const id = url.searchParams.get('id')
    let body: any
    try { body = await req.json() } catch { body = {} }

    if (action === 'send' && id) {
      // Trigger send for draft campaign
      const { data: campaign } = await sb.from('campaigns').select('id, status').eq('id', id).single()
      if (!campaign) return error('Campanha não encontrada', 404)

      // Invoke send-campaign. I6: send-campaign agora exige autenticacao (validateAuth) --
      // a service role key NAO e um WEBHOOK_SECRET nem uma api_key valida ali, entao
      // precisamos mandar o mesmo segredo que o cron ja usa (invoke_edge_function/Vault).
      const sendUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-campaign`
      const res = await fetch(sendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('WEBHOOK_SECRET')}`
        },
        body: JSON.stringify({ campaign_id: id })
      })
      const result = await res.json()

      return ok({ success: true, campaign_id: id, status: 'sending', ...result })
    }

    // Create campaign
    if (!body.name) return error('name é obrigatório')
    if (!body.channel) return error('channel é obrigatório')

    const { data: newCampaign, error: createErr } = await sb.from('campaigns').insert({
      name: body.name,
      channel: body.channel,
      segment_id: body.segment_id || null,
      subject: body.subject || null,
      body: body.body || null,
      design: body.design || null,
      // Sempre 'draft': quem faz a transicao draft -> sending e o CAS atomico
      // dentro do send-campaign (Fase 3). Criar ja como 'sending' faria o
      // enfileirador rejeitar a campanha com 409 (status fora de STARTABLE).
      status: 'draft'
    }).select().single()

    if (createErr) return error(createErr.message, 500)

    // If send_now, invoke send-campaign (I6: mesmo WEBHOOK_SECRET do outro caminho acima --
    // send-campaign nao aceita mais a service role key sozinha como credencial).
    if (body.send_now && newCampaign) {
      const sendUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-campaign`
      fetch(sendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('WEBHOOK_SECRET')}`
        },
        body: JSON.stringify({ campaign_id: newCampaign.id })
      }).catch(() => {}) // fire and forget
    }

    return ok({ success: true, campaign: newCampaign }, 201)
  }

  return error('Method not allowed', 405)
})
