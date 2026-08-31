import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateAuth, unauthorized, ok, error, handleCors } from '../_shared/auth.ts'

function getPeriodDate(period: string): string | null {
  const now = new Date()
  const map: Record<string, number> = { '7d': 7, '15d': 15, '30d': 30, '90d': 90 }
  const days = map[period]
  if (!days) return null
  now.setDate(now.getDate() - days)
  return now.toISOString()
}

function isValidTz(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false }
}

const sqlEsc = (v: string) => v.replace(/'/g, "''")

// So aceita YYYY-MM-DD estrito. Datas nunca sao escapadas antes de virar SQL
// (entram no literal TIMESTAMP '...' de tzRangeSql), entao a defesa e recusar
// qualquer coisa que nao seja exatamente uma data. execute_readonly_query roda
// SECURITY DEFINER: uma quebra de string aqui leria qualquer tabela ignorando
// RLS, mesmo com uma API key so-leitura.
const isValidDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v)

// Get today's date YYYY-MM-DD in given tz
function todayInTz(tz: string): string {
  const d = new Date()
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
  return fmt.format(d) // en-CA => YYYY-MM-DD
}

function dateRangeFromPeriod(period: string, tz: string, fromRaw: string | null, toRaw: string | null): { from: string; to: string } {
  const today = todayInTz(tz)
  if (period === 'custom') {
    return { from: fromRaw || today, to: toRaw || today }
  }
  if (period === 'today') return { from: today, to: today }
  const d = new Date(`${today}T12:00:00Z`)
  if (period === 'week') {
    d.setUTCDate(d.getUTCDate() - 6)
  } else if (period === 'month') {
    d.setUTCDate(d.getUTCDate() - 29)
  }
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' })
  return { from: fmt.format(d), to: today }
}

// Build a tstzrange [from 00:00 tz, to 23:59:59.999 tz]
function tzRangeSql(fromDate: string, toDate: string, tz: string): { startSql: string; endSql: string } {
  // Chokepoint: TODA interpolacao de data no modulo passa por aqui. Guarda de
  // invariante (defense-in-depth) -- se um ramo futuro esquecer de validar
  // date_from/date_to antes de chamar, uma data controlada pelo cliente ainda
  // assim nao chega ao SQL. Os ramos daily/events/funnel ja validam e devolvem
  // 400 limpo antes; este throw e a ultima linha de defesa, nunca deve disparar
  // em uso normal (se disparar, falha fechado: nenhuma query roda).
  if (!isValidDate(fromDate) || !isValidDate(toDate)) {
    throw new Error(`tzRangeSql: data invalida (${fromDate}..${toDate})`)
  }
  const t = sqlEsc(tz)
  return {
    startSql: `(TIMESTAMP '${fromDate} 00:00:00' AT TIME ZONE '${t}')`,
    endSql: `(TIMESTAMP '${toDate} 23:59:59.999' AT TIME ZONE '${t}')`,
  }
}

// Teto de janela para os ramos que rodam SQL agregado (daily/funnel/events).
// Ranges gigantescos varrem contact_events/lead_conversions inteiras e derrubam
// a instancia (respostas 502/503 no dashboard).
const MAX_RANGE_DAYS = 180

function rangeDays(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  return Math.floor((b - a) / 86400000) + 1
}

// Falha aberta com 504 em vez de deixar a chamada pendurada ate o gateway
// devolver 502/503 sem contexto.
const QUERY_TIMEOUT_MS = 20000

async function runQuery(sb: any, sql: string, label: string) {
  const timeout = new Promise<{ data: null; error: { message: string; timeout: true } }>((resolve) =>
    setTimeout(() => resolve({ data: null, error: { message: `${label}: query timeout`, timeout: true } }), QUERY_TIMEOUT_MS)
  )
  return await Promise.race([
    sb.rpc('execute_readonly_query', { query_text: sql }),
    timeout,
  ]) as { data: any; error: any }
}

function queryError(e: any, label: string) {
  console.error(`${label} query failed:`, e)
  if (e?.timeout) return error('Consulta excedeu o tempo limite. Reduza o período e tente novamente.', 504)
  return error(`Query failed: ${e?.message || e}`, 500)
}


Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  if (req.method !== 'GET') return error('Method not allowed', 405)

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  if (!(await validateAuth(req, sb, 'read'))) return unauthorized()

  const url = new URL(req.url)
  const type = url.searchParams.get('type') || 'overview'
  const period = url.searchParams.get('period') || '30d'
  const since = getPeriodDate(period)

  const tz = url.searchParams.get('tz') || 'America/Sao_Paulo'
  if (!isValidTz(tz)) return error('Invalid tz', 400)

  if (type === 'overview') {
    const { count: totalLeads } = await sb.from('leads').select('*', { count: 'exact', head: true })
    const { count: hotleads } = await sb.from('leads').select('*', { count: 'exact', head: true }).eq('etiqueta', 'hotlead')
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const { count: leadsHoje } = await sb.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', today.toISOString())
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7)
    const { count: leadsSemana } = await sb.from('leads').select('*', { count: 'exact', head: true }).gte('created_at', weekAgo.toISOString())
    const { data: scoredLeads } = await sb.from('leads').select('lead_score').not('lead_score', 'is', null).gt('lead_score', 0)
    const scores = (scoredLeads || []).map((l: any) => l.lead_score)
    const scoreMedio = scores.length > 0 ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length) : 0
    const { count: warmLeads } = await sb.from('leads').select('*', { count: 'exact', head: true }).gt('lead_score', 0).neq('etiqueta', 'hotlead')
    const { count: leadsNoNexus } = await sb.from('ecosystem_identities').select('*', { count: 'exact', head: true }).not('nexus_contact_id', 'is', null)
    const { count: clientesAtivos } = await sb.from('ecosystem_identities').select('*', { count: 'exact', head: true }).in('stage', ['client', 'active'])
    const total = totalLeads || 0
    const hot = hotleads || 0
    const taxaHotlead = total > 0 ? ((hot / total) * 100).toFixed(1) + '%' : '0%'
    return ok({
      total_leads: total, hotleads: hot, warm_leads: warmLeads || 0,
      raw_leads: total - (hot + (warmLeads || 0)),
      leads_hoje: leadsHoje || 0, leads_semana: leadsSemana || 0,
      score_medio: scoreMedio, taxa_hotlead: taxaHotlead,
      leads_no_nexus: leadsNoNexus || 0, clientes_ativos: clientesAtivos || 0,
    })
  }

  if (type === 'leads') {
    let query = sb.from('leads').select('created_at, etiqueta')
    if (since) query = query.gte('created_at', since)
    const { data: leads } = await query.order('created_at', { ascending: true })
    const dayMap: Record<string, { total: number; hotleads: number }> = {}
    for (const lead of (leads || [])) {
      const date = (lead.created_at || '').slice(0, 10)
      if (!date) continue
      if (!dayMap[date]) dayMap[date] = { total: 0, hotleads: 0 }
      dayMap[date].total++
      if (lead.etiqueta === 'hotlead') dayMap[date].hotleads++
    }
    const data = Object.entries(dayMap).map(([date, v]) => ({ date, ...v }))
    return ok({ period, data })
  }

  if (type === 'sources') {
    let query = sb.from('leads').select('utm_source, etiqueta')
    if (since) query = query.gte('created_at', since)
    const { data: leads } = await query
    const sourceMap: Record<string, { total: number; hotleads: number }> = {}
    for (const lead of (leads || [])) {
      const src = lead.utm_source || '(direto)'
      if (!sourceMap[src]) sourceMap[src] = { total: 0, hotleads: 0 }
      sourceMap[src].total++
      if (lead.etiqueta === 'hotlead') sourceMap[src].hotleads++
    }
    const data = Object.entries(sourceMap).map(([utm_source, v]) => ({
      utm_source, ...v,
      taxa_hot: v.total > 0 ? ((v.hotleads / v.total) * 100).toFixed(1) + '%' : '0%',
    })).sort((a, b) => b.total - a.total)
    return ok({ data })
  }

  if (type === 'pages') {
    let query = sb.from('leads').select('source, etiqueta')
    if (since) query = query.gte('created_at', since)
    const { data: leads } = await query
    const pageMap: Record<string, { total: number; hotleads: number }> = {}
    for (const lead of (leads || [])) {
      const src = lead.source || '(desconhecido)'
      if (!pageMap[src]) pageMap[src] = { total: 0, hotleads: 0 }
      pageMap[src].total++
      if (lead.etiqueta === 'hotlead') pageMap[src].hotleads++
    }
    const slugs = Object.keys(pageMap).filter((s) => s !== '(desconhecido)')
    let titleMap: Record<string, string> = {}
    if (slugs.length > 0) {
      const { data: pages } = await sb.from('pages').select('slug, name').in('slug', slugs)
      titleMap = Object.fromEntries((pages || []).map((p: any) => [p.slug, p.name]))
    }
    const data = Object.entries(pageMap).map(([page_slug, v]) => ({
      page_slug, title: titleMap[page_slug] || page_slug,
      total_leads: v.total, hot_leads: v.hotleads,
      taxa_hot: v.total > 0 ? ((v.hotleads / v.total) * 100).toFixed(1) + '%' : '0%',
    })).sort((a, b) => b.total_leads - a.total_leads)
    return ok({ data })
  }

  // ============ NEW: daily ============
  if (type === 'daily') {
    const date = url.searchParams.get('date') || todayInTz(tz)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return error('Invalid date (use YYYY-MM-DD)', 400)
    const { startSql, endSql } = tzRangeSql(date, date, tz)

    const sql = `
      WITH win AS (SELECT ${startSql} AS s, ${endSql} AS e),
      new_leads AS (
        SELECT id, status, utm_source, created_at FROM leads, win
        WHERE created_at >= win.s AND created_at <= win.e
      ),
      meetings AS (
        SELECT COUNT(*)::int AS n FROM contact_events ce, win
        WHERE ce.event_type IN ('meeting_scheduled','scheduling_widget_booked')
          AND ce.occurred_at >= win.s AND ce.occurred_at <= win.e
      ),
      won AS (
        SELECT COUNT(*)::int AS n FROM contact_events ce, win
        WHERE ce.event_type = 'deal_won' AND ce.occurred_at >= win.s AND ce.occurred_at <= win.e
      ),
      lost AS (
        SELECT COUNT(*)::int AS n FROM contact_events ce, win
        WHERE ce.event_type = 'deal_lost' AND ce.occurred_at >= win.s AND ce.occurred_at <= win.e
      ),
      mql_conversions AS (
        SELECT DISTINCT lc.lead_id FROM lead_conversions lc, win
        WHERE lc.tipo = 'mql_reuniao_agendada'
          AND lc.converted_at >= win.s AND lc.converted_at <= win.e
      ),
      mql_existing AS (
        SELECT COUNT(*)::int AS n FROM mql_conversions mc
        JOIN leads l ON l.id = mc.lead_id, win
        WHERE l.created_at < win.s
      ),
      mql_total_cte AS (
        SELECT COUNT(*)::int AS n FROM mql_conversions
      ),
      by_status AS (
        SELECT COALESCE(status, 'Lead') AS k, COUNT(*)::int AS v FROM new_leads GROUP BY 1
      ),
      by_source AS (
        SELECT COALESCE(NULLIF(utm_source,''), '(direto)') AS k, COUNT(*)::int AS v FROM new_leads GROUP BY 1
      )
      SELECT
        (SELECT COUNT(*)::int FROM new_leads) AS new_leads,
        (SELECT n FROM meetings) AS meetings_scheduled,
        (SELECT n FROM won) AS deals_won,
        (SELECT n FROM lost) AS deals_lost,
        (SELECT n FROM mql_existing) AS mql_from_existing,
        (SELECT n FROM mql_total_cte) AS mql_total,
        COALESCE((SELECT jsonb_object_agg(k, v) FROM by_status), '{}'::jsonb) AS by_status,
        COALESCE((SELECT jsonb_object_agg(k, v) FROM by_source), '{}'::jsonb) AS by_source
    `
    const { data, error: e } = await runQuery(sb, sql, 'daily')
    if (e) return queryError(e, 'daily')
    const row = (data as any[])?.[0] || {}
    return ok({ date, tz, ...row })
  }

  // ============ NEW: funnel ============
  if (type === 'funnel') {
    const periodParam = url.searchParams.get('period') || 'month'
    const allowed = ['today', 'week', 'month', 'custom']
    if (!allowed.includes(periodParam)) return error('Invalid period', 400)
    const { from, to } = dateRangeFromPeriod(periodParam, tz, url.searchParams.get('date_from'), url.searchParams.get('date_to'))
    // period='custom' devolve date_from/date_to crus do query string. Sem esta
    // validacao eles caem direto no literal TIMESTAMP de tzRangeSql (injecao de
    // SQL via execute_readonly_query, SECURITY DEFINER). daily e events ja fazem
    // o mesmo; o funnel era o unico ramo sem a checagem.
    if (!isValidDate(from) || !isValidDate(to)) {
      return error('Invalid date_from/date_to (use YYYY-MM-DD)', 400)
    }
    if (rangeDays(from, to) > MAX_RANGE_DAYS) {
      return error(`Período máximo de ${MAX_RANGE_DAYS} dias`, 400)
    }
    const { startSql, endSql } = tzRangeSql(from, to, tz)

    const sql = `
      WITH win AS (SELECT ${startSql} AS s, ${endSql} AS e),
      base AS (
        SELECT id, etiqueta, status FROM leads, win
        WHERE created_at >= win.s AND created_at <= win.e
      ),
      ev AS (
        SELECT DISTINCT lead_id, event_type FROM contact_events ce, win
        WHERE ce.occurred_at >= win.s AND ce.occurred_at <= win.e
          AND ce.lead_id IN (SELECT id FROM base)
      ),
      qual AS (
        SELECT id FROM base
        WHERE etiqueta IN ('warm','hotlead')
           OR id IN (SELECT lead_id FROM ev WHERE event_type = 'lead_qualified')
      ),
      mql AS (
        SELECT DISTINCT lead_id AS id FROM ev
        WHERE event_type IN ('meeting_scheduled','scheduling_widget_booked')
      ),
      sql_stage AS (
        SELECT id FROM base
        WHERE LOWER(COALESCE(status,'')) LIKE '%negocia%'
           OR id IN (
             SELECT lead_id FROM contact_events ce, win
             WHERE ce.event_type = 'deal_moved'
               AND ce.occurred_at >= win.s AND ce.occurred_at <= win.e
               AND LOWER(COALESCE(ce.metadata->>'to_stage', ce.metadata->>'stage','')) LIKE '%negocia%'
           )
      ),
      won AS (
        SELECT DISTINCT lead_id AS id FROM ev WHERE event_type = 'deal_won'
      )
      SELECT
        (SELECT COUNT(*)::int FROM base) AS lead,
        (SELECT COUNT(*)::int FROM qual) AS qualified,
        (SELECT COUNT(*)::int FROM mql)  AS mql,
        (SELECT COUNT(*)::int FROM sql_stage) AS sql,
        (SELECT COUNT(*)::int FROM won) AS won
    `
    const { data, error: e } = await runQuery(sb, sql, 'funnel')
    if (e) return queryError(e, 'funnel')
    const r = (data as any[])?.[0] || { lead: 0, qualified: 0, mql: 0, sql: 0, won: 0 }
    const pct = (num: number, den: number) => den > 0 ? Number(((num / den) * 100).toFixed(2)) : 0
    return ok({
      period: periodParam, date_from: from, date_to: to, tz,
      stages: [
        { stage: 'lead', count: r.lead, conversion_from_prev: null },
        { stage: 'qualified', count: r.qualified, conversion_from_prev: pct(r.qualified, r.lead) },
        { stage: 'mql', count: r.mql, conversion_from_prev: pct(r.mql, r.qualified) },
        { stage: 'sql', count: r.sql, conversion_from_prev: pct(r.sql, r.mql) },
        { stage: 'won', count: r.won, conversion_from_prev: pct(r.won, r.sql) },
      ],
    })
  }

  // ============ NEW: events ============
  if (type === 'events') {
    const eventTypeRaw = url.searchParams.get('event_type')
    if (!eventTypeRaw) return error('event_type is required (CSV)', 400)
    const eventTypes = eventTypeRaw.split(',').map((s) => s.trim()).filter(Boolean)
    if (!eventTypes.length) return error('event_type is required', 400)
    const inList = eventTypes.map((t) => `'${sqlEsc(t)}'`).join(',')

    const today = todayInTz(tz)
    const normDate = (v: string | null, fallback: string): string => {
      if (!v) return fallback
      const m = v.match(/^(\d{4}-\d{2}-\d{2})/)
      return m ? m[1] : v
    }
    const from = normDate(url.searchParams.get('date_from'), today)
    const to = normDate(url.searchParams.get('date_to'), today)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return error('Invalid date_from/date_to (use YYYY-MM-DD ou ISO 8601)', 400)
    }
    if (rangeDays(from, to) > MAX_RANGE_DAYS) {
      return error(`Período máximo de ${MAX_RANGE_DAYS} dias`, 400)
    }
    const groupBy = url.searchParams.get('group_by') || 'none'
    if (!['none', 'day', 'source'].includes(groupBy)) return error('Invalid group_by', 400)
    const { startSql, endSql } = tzRangeSql(from, to, tz)

    let sql: string
    if (groupBy === 'day') {
      sql = `
        WITH win AS (SELECT ${startSql} AS s, ${endSql} AS e),
        base AS (
          SELECT (ce.occurred_at AT TIME ZONE '${sqlEsc(tz)}')::date AS d, ce.event_type
          FROM contact_events ce, win
          WHERE ce.event_type IN (${inList})
            AND ce.occurred_at >= win.s AND ce.occurred_at <= win.e
        )
        SELECT to_char(d, 'YYYY-MM-DD') AS date, event_type, COUNT(*)::int AS count
        FROM base GROUP BY d, event_type ORDER BY d ASC
      `
    } else if (groupBy === 'source') {
      sql = `
        WITH win AS (SELECT ${startSql} AS s, ${endSql} AS e)
        SELECT COALESCE(NULLIF(l.utm_source,''),'(direto)') AS utm_source, ce.event_type, COUNT(*)::int AS count
        FROM contact_events ce, win
        LEFT JOIN leads l ON l.id = ce.lead_id
        WHERE ce.event_type IN (${inList})
          AND ce.occurred_at >= win.s AND ce.occurred_at <= win.e
        GROUP BY 1, 2 ORDER BY count DESC
      `
    } else {
      sql = `
        WITH win AS (SELECT ${startSql} AS s, ${endSql} AS e)
        SELECT ce.event_type, COUNT(*)::int AS count
        FROM contact_events ce, win
        WHERE ce.event_type IN (${inList})
          AND ce.occurred_at >= win.s AND ce.occurred_at <= win.e
        GROUP BY ce.event_type ORDER BY count DESC
      `
    }

    const [seriesRes, totalRes] = await Promise.all([
      runQuery(sb, sql, 'events'),
      runQuery(sb, `WITH win AS (SELECT ${startSql} AS s, ${endSql} AS e)
          SELECT COUNT(*)::int AS total FROM contact_events ce, win
          WHERE ce.event_type IN (${inList})
            AND ce.occurred_at >= win.s AND ce.occurred_at <= win.e`, 'events-total'),
    ])
    if (seriesRes.error) return queryError(seriesRes.error, 'events')
    const total = ((totalRes.data as any[]) || [{ total: 0 }])[0]?.total || 0
    return ok({
      tz, date_from: from, date_to: to, event_types: eventTypes,
      group_by: groupBy, total, data: seriesRes.data || [],
    })
  }

  return error('type inválido. Use: overview, leads, sources, pages, daily, funnel, events')
})
