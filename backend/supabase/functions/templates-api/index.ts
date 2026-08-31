import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateAuth, unauthorized, ok, error, handleCors } from '../_shared/auth.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// AUTENTICACAO: diferente dos outros *-api (campaigns-api, segments-api etc.),
// que sao consumidos so por sistemas externos (n8n, API key), este endpoint
// TAMBEM e chamado pelo browser -- a UI /templates (Tasks 4.4-4.7) fala com a
// tabela via supabase-js sob RLS para o CRUD normal, mas o fallback/uso
// programatico da API precisa aceitar o JWT de sessao do admin logado, que
// nao e nem o WEBHOOK_SECRET nem uma api_key da tabela api_keys (unicas
// credenciais aceitas por validateAuth()). Mesmo padrao dual-auth ja usado em
// resend-config-check/index.ts (isAuthorized) e delete-contact/index.ts.
async function isAuthorized(req: Request, sb: any, permission: 'read' | 'write'): Promise<boolean> {
  // 1. Server-to-server: WEBHOOK_SECRET ou API key (tabela api_keys).
  if (await validateAuth(req, sb, permission)) return true

  // 2. Navegador: JWT do usuario logado, com role admin.
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
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle()
    return !!roleData
  } catch (err) {
    console.error('templates-api isAuthorized (user JWT path) error:', err)
    return false
  }
}

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const url = new URL(req.url)

  if (req.method === 'GET') {
    if (!(await isAuthorized(req, sb, 'read'))) return unauthorized()

    const id = url.searchParams.get('id')

    if (id) {
      if (!UUID_RE.test(id)) return error('Invalid id', 400)

      const { data: template, error: tErr } = await sb.from('email_templates').select('*').eq('id', id).single()
      if (tErr || !template) return error('Template não encontrado', 404)

      return ok(template)
    }

    const category = url.searchParams.get('category')
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '20')))
    const offset = (page - 1) * limit

    let query = sb.from('email_templates').select('*', { count: 'exact' })
    if (category) query = query.eq('category', category)
    query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1)

    const { data: templates, count, error: listErr } = await query
    if (listErr) return error(listErr.message, 500)

    const total = count || 0
    return ok({
      data: templates || [],
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    })
  }

  if (req.method === 'POST') {
    if (!(await isAuthorized(req, sb, 'write'))) return unauthorized()

    let body: any
    try { body = await req.json() } catch { body = {} }

    if (!body.name) return error('name é obrigatório')

    const { data: newTemplate, error: createErr } = await sb.from('email_templates').insert({
      name: body.name,
      description: body.description || null,
      category: body.category || null,
      design: body.design || null,
      html: body.html || null,
    }).select().single()

    if (createErr) return error(createErr.message, 500)

    return ok({ success: true, template: newTemplate }, 201)
  }

  if (req.method === 'PATCH') {
    if (!(await isAuthorized(req, sb, 'write'))) return unauthorized()

    const id = url.searchParams.get('id')
    if (!id) return error('id é obrigatório')
    if (!UUID_RE.test(id)) return error('Invalid id', 400)

    let body: any
    try { body = await req.json() } catch { body = {} }

    const patch: Record<string, unknown> = {}
    if (body.name !== undefined) patch.name = body.name
    if (body.description !== undefined) patch.description = body.description
    if (body.category !== undefined) patch.category = body.category
    if (body.design !== undefined) patch.design = body.design
    if (body.html !== undefined) patch.html = body.html

    if (Object.keys(patch).length === 0) return error('Nenhum campo para atualizar')

    const { data: updated, error: updErr } = await sb.from('email_templates')
      .update(patch).eq('id', id).select().maybeSingle()

    if (updErr) return error(updErr.message, 500)
    if (!updated) return error('Template não encontrado', 404)

    return ok({ success: true, template: updated })
  }

  if (req.method === 'DELETE') {
    if (!(await isAuthorized(req, sb, 'write'))) return unauthorized()

    const id = url.searchParams.get('id')
    if (!id) return error('id é obrigatório')
    if (!UUID_RE.test(id)) return error('Invalid id', 400)

    const { data: deleted, error: delErr } = await sb.from('email_templates')
      .delete().eq('id', id).select('id')

    if (delErr) return error(delErr.message, 500)
    if (!deleted || deleted.length === 0) return error('Template não encontrado', 404)

    return ok({ success: true })
  }

  return error('Method not allowed', 405)
})
