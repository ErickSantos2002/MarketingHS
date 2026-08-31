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

    const { data: rules, error: listErr } = await sb.from('automation_rules')
      .select('*')
      .order('priority', { ascending: false })

    if (listErr) return error(listErr.message, 500)

    const result = (rules || []).map((r: any) => ({
      ...r,
      condition: `${r.condition_type} ${r.condition_operator} ${r.condition_value}`,
      action: `${r.action_type}${r.action_metadata?.stage_name ? ' em ' + r.action_metadata.stage_name : ''}`
    }))

    return ok({ data: result })
  }

  if (req.method === 'POST') {
    if (!(await validateAuth(req, sb, 'write'))) return unauthorized()

    let body: any
    try { body = await req.json() } catch { return error('Body JSON inválido') }

    if (!body.name || !body.condition_type || !body.condition_operator || !body.condition_value || !body.action_type) {
      return error('name, condition_type, condition_operator, condition_value e action_type são obrigatórios')
    }

    // conditions/condition_logic são as colunas de regra MULTI-condição
    // (migration 20260406235621). Sem persisti-las, o automationEngine cai no
    // fallback de condição única e aplica uma regra diferente da pedida.
    const conditions = Array.isArray(body.conditions) ? body.conditions : []
    const conditionLogic = body.condition_logic === 'or' ? 'or' : 'and'

    const { data: rule, error: createErr } = await sb.from('automation_rules').insert({
      name: body.name,
      priority: body.priority || 0,
      condition_type: body.condition_type,
      condition_operator: body.condition_operator,
      condition_value: body.condition_value,
      conditions,
      condition_logic: conditionLogic,
      action_type: body.action_type,
      action_value: body.action_value || null,
      action_metadata: body.action_metadata || {},
      is_active: body.is_active !== undefined ? body.is_active : true
    }).select().single()

    if (createErr) return error(createErr.message, 500)
    return ok({ success: true, rule }, 201)
  }

  if (req.method === 'PATCH') {
    if (!(await validateAuth(req, sb, 'write'))) return unauthorized()

    const id = url.searchParams.get('id')
    if (!id) return error('id query param é obrigatório')

    let body: any
    try { body = await req.json() } catch { return error('Body JSON inválido') }

    const allowedFields = [
      'is_active', 'name', 'priority',
      'condition_type', 'condition_operator', 'condition_value',
      'conditions', 'condition_logic',
      'action_type', 'action_value', 'action_metadata'
    ]
    const updateData: any = {}
    for (const f of allowedFields) {
      if (body[f] !== undefined) updateData[f] = body[f]
    }

    if (Object.keys(updateData).length === 0) return error('Nenhum campo para atualizar')
    if (updateData.conditions !== undefined && !Array.isArray(updateData.conditions)) {
      return error('conditions deve ser um array')
    }
    if (updateData.condition_logic !== undefined && !['and', 'or'].includes(updateData.condition_logic)) {
      return error("condition_logic deve ser 'and' ou 'or'")
    }

    const { data: updated, error: upErr } = await sb.from('automation_rules').update(updateData).eq('id', id).select().single()
    if (upErr) return error(upErr.message, 500)
    if (!updated) return error('Regra não encontrada', 404)

    return ok({ success: true, rule: updated })
  }

  return error('Method not allowed', 405)
})
