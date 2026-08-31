import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateAuth, unauthorized, ok, error, handleCors } from '../_shared/auth.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Dual-auth: server-to-server (WEBHOOK_SECRET / api_keys) OU JWT de admin do
// browser -- mesmo padrão de resend-config-check/index.ts. Esta function é
// chamada pelo browser (supabase.functions.invoke a partir do admin), então
// validateAuth (que só aceita WEBHOOK_SECRET/api_keys) sozinha bloquearia
// toda chamada da UI com 401.
async function isAuthorized(req: Request, sb: any, permission: 'read' | 'write'): Promise<boolean> {
  if (await validateAuth(req, sb, permission)) return true

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return false
  try {
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) return false
    const { data: roleData } = await sb
      .from('user_roles').select('role')
      .eq('user_id', user.id).eq('role', 'admin').maybeSingle()
    return !!roleData
  } catch (err) {
    console.error('journeys-api isAuthorized error:', err)
    return false
  }
}

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const url = new URL(req.url)
  const id = url.searchParams.get('id')

  if (req.method === 'GET') {
    if (!(await isAuthorized(req, sb, 'read'))) return unauthorized()

    if (id) {
      if (!UUID_RE.test(id)) return error('id inválido')
      const { data: journey, error: gErr } = await sb.from('journeys').select('*').eq('id', id).maybeSingle()
      if (gErr) return error(gErr.message, 500)
      if (!journey) return error('Fluxo não encontrado', 404)

      const { data: metrics } = await sb.rpc('journey_node_metrics', { p_journey_id: id })

      const { data: runRows } = await sb.from('journey_runs').select('state').eq('journey_id', id)
      const runs = { active: 0, waiting: 0, done: 0, failed: 0, exited: 0 } as Record<string, number>
      for (const r of runRows ?? []) runs[r.state] = (runs[r.state] ?? 0) + 1

      return ok({ data: journey, metrics: metrics ?? {}, runs })
    }

    const { data: list, error: lErr } = await sb.from('journeys')
      .select('*').order('created_at', { ascending: false })
    if (lErr) return error(lErr.message, 500)

    // Contagem de runs por fluxo (uma query, agregada em memória: o volume de
    // fluxos é pequeno -- dezenas, não milhares).
    const { data: allRuns } = await sb.from('journey_runs').select('journey_id, state')
    const byJourney = new Map<string, Record<string, number>>()
    for (const r of allRuns ?? []) {
      const cur = byJourney.get(r.journey_id) ?? { active: 0, waiting: 0, done: 0, failed: 0, exited: 0 }
      cur[r.state] = (cur[r.state] ?? 0) + 1
      byJourney.set(r.journey_id, cur)
    }

    return ok({
      data: (list ?? []).map((j: any) => ({
        ...j,
        runs: byJourney.get(j.id) ?? { active: 0, waiting: 0, done: 0, failed: 0, exited: 0 },
      })),
    })
  }

  if (req.method === 'POST') {
    if (!(await isAuthorized(req, sb, 'write'))) return unauthorized()
    let body: any
    try { body = await req.json() } catch { return error('Body JSON inválido') }

    if (!body.name || !body.entry_type) return error('name e entry_type são obrigatórios')
    if (!['segment', 'event'].includes(body.entry_type)) return error('entry_type inválido')

    const { data: journey, error: cErr } = await sb.from('journeys').insert({
      name: body.name,
      description: body.description ?? null,
      entry_type: body.entry_type,
      entry_config: body.entry_config ?? {},
      reentry: body.reentry === 'allowed' ? 'allowed' : 'once',
      // Sem valor explícito, o DEFAULT 168 (7 dias) da coluna assume (C1).
      ...(Number.isFinite(Number(body.reentry_cooldown_hours)) && Number(body.reentry_cooldown_hours) > 0
        ? { reentry_cooldown_hours: Math.floor(Number(body.reentry_cooldown_hours)) }
        : {}),
      entry_node_id: body.entry_node_id ?? null,
      nodes: Array.isArray(body.nodes) ? body.nodes : [],
      status: 'draft',
    }).select().single()

    // O trigger trg_journeys_validate rejeita grafo inválido/cíclico com RAISE:
    // a mensagem do banco é a mensagem de erro do usuário (é ela que explica o
    // que está errado no fluxo). Não mascarar.
    if (cErr) return error(cErr.message, 400)
    return ok({ success: true, journey }, 201)
  }

  if (req.method === 'PATCH') {
    if (!(await isAuthorized(req, sb, 'write'))) return unauthorized()
    if (!id || !UUID_RE.test(id)) return error('id query param é obrigatório')

    let body: any
    try { body = await req.json() } catch { return error('Body JSON inválido') }

    const allowed = [
      'name', 'description', 'status', 'entry_type', 'entry_config', 'reentry',
      'reentry_cooldown_hours', 'entry_node_id', 'nodes',
    ]
    const patch: any = {}
    for (const f of allowed) if (body[f] !== undefined) patch[f] = body[f]
    if (Object.keys(patch).length === 0) return error('Nenhum campo para atualizar')

    if (patch.reentry_cooldown_hours !== undefined) {
      const n = Number(patch.reentry_cooldown_hours)
      if (!Number.isFinite(n) || n <= 0) return error('reentry_cooldown_hours deve ser um número positivo')
      patch.reentry_cooldown_hours = Math.floor(n)
    }

    if (patch.status && !['draft', 'active', 'paused', 'archived'].includes(patch.status)) {
      return error('status inválido')
    }

    const { data: journey, error: uErr } = await sb.from('journeys')
      .update(patch).eq('id', id).select().single()
    if (uErr) return error(uErr.message, 400)
    if (!journey) return error('Fluxo não encontrado', 404)
    return ok({ success: true, journey })
  }

  if (req.method === 'DELETE') {
    if (!(await isAuthorized(req, sb, 'write'))) return unauthorized()
    if (!id || !UUID_RE.test(id)) return error('id query param é obrigatório')

    // A guarda REAL é o trigger trg_journeys_delete_guard (só rascunho sem runs).
    // Aqui só traduzimos o erro do banco.
    const { error: dErr } = await sb.from('journeys').delete().eq('id', id)
    if (dErr) return error(dErr.message, 400)
    return ok({ success: true })
  }

  return error('Method not allowed', 405)
})
