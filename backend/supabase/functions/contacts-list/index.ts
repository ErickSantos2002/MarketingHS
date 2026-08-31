import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateAuth, unauthorized, ok, error, handleCors } from '../_shared/auth.ts'

const STATUS_CHANGE_EVENT_TYPES = [
  'deal_moved',
  'lead_qualified',
  'meeting_scheduled',
  'scheduling_widget_booked',
  'deal_won',
  'deal_lost',
  'onboarding_started',
]

const sqlEscape = (v: string) => v.replace(/'/g, "''")

function parseTsParam(raw: string | null, tz: string): string | null {
  if (!raw) return null
  const s = raw.trim()
  if (!s) return null
  // Date-only YYYY-MM-DD => interpret in tz
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    // emit a Postgres-castable expression via string compare; safe: tz already validated
    return `(TIMESTAMP '${s} 00:00:00' AT TIME ZONE '${sqlEscape(tz)}')`
  }
  // Otherwise: treat as ISO 8601 timestamptz literal
  const d = new Date(s)
  if (isNaN(d.getTime())) return null
  return `'${d.toISOString()}'::timestamptz`
}

function isValidTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

function encodeCursor(created_at: string, id: string): string {
  return btoa(JSON.stringify({ c: created_at, id }))
}
function decodeCursor(c: string): { c: string; id: string } | null {
  try {
    const o = JSON.parse(atob(c))
    if (o && typeof o.c === 'string' && typeof o.id === 'string') return o
    return null
  } catch {
    return null
  }
}

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
    const q = url.searchParams.get('q') || ''
    const etiqueta = url.searchParams.get('etiqueta')
    const status = url.searchParams.get('status')
    const stage = url.searchParams.get('stage')

    const tz = url.searchParams.get('tz') || 'America/Sao_Paulo'
    if (!isValidTz(tz)) return error('Invalid tz', 400)

    const createdAfter = parseTsParam(url.searchParams.get('created_after'), tz)
    const createdBefore = parseTsParam(url.searchParams.get('created_before'), tz)
    const updatedAfter = parseTsParam(url.searchParams.get('updated_after'), tz)
    const updatedBefore = parseTsParam(url.searchParams.get('updated_before'), tz)
    const statusChangedAfter = parseTsParam(url.searchParams.get('status_changed_after'), tz)

    const cursorRaw = url.searchParams.get('cursor')
    const usingCursor = !!cursorRaw
    let cursor: { c: string; id: string } | null = null
    if (cursorRaw) {
      cursor = decodeCursor(cursorRaw)
      if (!cursor) return error('Invalid cursor', 400)
    }

    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'))
    const limit = Math.min(
      usingCursor ? 500 : 100,
      Math.max(1, parseInt(url.searchParams.get('limit') || '20'))
    )
    const offset = (page - 1) * limit

    const statusEventsList = STATUS_CHANGE_EVENT_TYPES.map((t) => `'${t}'`).join(',')
    const lastStatusChangeSql = `(SELECT MAX(ce.occurred_at) FROM contact_events ce WHERE ce.lead_id = l.id AND ce.event_type IN (${statusEventsList}))`

    const buildWhere = () => {
      let where = 'WHERE 1=1'
      if (q) {
        const s = sqlEscape(q)
        where += ` AND (l.nome ILIKE '%${s}%' OR l.email ILIKE '%${s}%' OR l.whatsapp ILIKE '%${s}%')`
      }
      if (etiqueta) where += ` AND l.etiqueta = '${sqlEscape(etiqueta)}'`
      if (status) where += ` AND l.status = '${sqlEscape(status)}'`
      if (stage) where += ` AND ei.stage = '${sqlEscape(stage)}'`
      if (createdAfter) where += ` AND l.created_at >= ${createdAfter}`
      if (createdBefore) where += ` AND l.created_at <= ${createdBefore}`
      if (updatedAfter) where += ` AND l.updated_at >= ${updatedAfter}`
      if (updatedBefore) where += ` AND l.updated_at <= ${updatedBefore}`
      if (statusChangedAfter) where += ` AND ${lastStatusChangeSql} >= ${statusChangedAfter}`
      if (cursor) {
        const cTs = `'${sqlEscape(cursor.c)}'::timestamptz`
        const cId = `'${sqlEscape(cursor.id)}'::uuid`
        where += ` AND (l.created_at, l.id) < (${cTs}, ${cId})`
      }
      return where
    }

    const selectFields = `l.id, l.nome, l.email, l.whatsapp, l.cargo, l.faturamento, l.etiqueta, l.status, l.utm_source, l.utm_campaign, l.source as page_slug, l.created_at, l.updated_at, l.dnia_id, l.phone_normalized, ei.stage, ei.nexus_contact_id, ei.mentoria_client_id, ei.first_touch_source, ${lastStatusChangeSql} AS status_changed_at`

    const where = buildWhere()
    const orderBy = 'ORDER BY l.created_at DESC, l.id DESC'
    const fetchLimit = usingCursor ? limit + 1 : limit

    const dataQuery = `SELECT ${selectFields} FROM leads l LEFT JOIN ecosystem_identities ei ON l.dnia_id = ei.dnia_id ${where} ${orderBy} LIMIT ${fetchLimit}${usingCursor ? '' : ` OFFSET ${offset}`}`

    const tasks: Promise<unknown>[] = [
      supabase.rpc('execute_readonly_query', { query_text: dataQuery }),
    ]
    if (!usingCursor) {
      const countQuery = `SELECT COUNT(*)::int as total FROM leads l LEFT JOIN ecosystem_identities ei ON l.dnia_id = ei.dnia_id ${where}`
      tasks.push(supabase.rpc('execute_readonly_query', { query_text: countQuery }))
    }

    const results = await Promise.all(tasks) as Array<{ data: unknown; error: unknown }>
    const dataResult = results[0]
    const countResult = results[1]

    if (dataResult.error) {
      console.error('Data query error:', dataResult.error)
      return error('Query failed', 500)
    }

    let rows = (dataResult.data as Array<Record<string, unknown>>) || []

    if (usingCursor) {
      const hasMore = rows.length > limit
      if (hasMore) rows = rows.slice(0, limit)
      const last = rows[rows.length - 1]
      const next_cursor = hasMore && last
        ? encodeCursor(String(last.created_at), String(last.id))
        : null
      return ok({
        data: rows,
        pagination: { limit, next_cursor, has_more: hasMore },
      })
    }

    const totalArr = (countResult?.data as Array<{ total: number }>) || []
    const total = totalArr[0]?.total || 0

    return ok({
      data: rows,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    })
  } catch (err) {
    console.error('Unexpected error:', err)
    return error('Internal server error', 500)
  }
})
