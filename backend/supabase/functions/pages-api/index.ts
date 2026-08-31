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

    const slug = url.searchParams.get('slug')

    if (slug) {
      const { data: page, error: pErr } = await sb.from('pages').select('*').eq('slug', slug).single()
      if (pErr || !page) return error('Página não encontrada', 404)

      // Count leads for this page
      const { count: totalLeads } = await sb.from('leads').select('*', { count: 'exact', head: true }).eq('source', slug)
      const { count: hotLeads } = await sb.from('leads').select('*', { count: 'exact', head: true }).eq('source', slug).eq('etiqueta', 'hotlead')

      return ok({
        ...page,
        active: page.status === 'active',
        total_leads: totalLeads || 0,
        hot_leads: hotLeads || 0
      })
    }

    // List all pages
    const { data: pages, error: listErr } = await sb.from('pages').select('*').order('created_at', { ascending: false })
    if (listErr) return error(listErr.message, 500)

    // Enrich with lead counts
    const result = await Promise.all((pages || []).map(async (p: any) => {
      const { count: totalLeads } = await sb.from('leads').select('*', { count: 'exact', head: true }).eq('source', p.slug)
      const { count: hotLeads } = await sb.from('leads').select('*', { count: 'exact', head: true }).eq('source', p.slug).eq('etiqueta', 'hotlead')
      const { data: lastLead } = await sb.from('leads').select('created_at').eq('source', p.slug).order('created_at', { ascending: false }).limit(1)

      return {
        id: p.id,
        slug: p.slug,
        title: p.name,
        active: p.status === 'active',
        total_leads: totalLeads || 0,
        hot_leads: hotLeads || 0,
        last_lead_at: lastLead?.[0]?.created_at || null,
        config: p.config
      }
    }))

    return ok({ data: result })
  }

  if (req.method === 'POST') {
    if (!(await validateAuth(req, sb, 'write'))) return unauthorized()

    let body: any
    try { body = await req.json() } catch { return error('Body JSON inválido') }

    if (!body.title || !body.slug) return error('title e slug são obrigatórios')

    const { data: newPage, error: createErr } = await sb.from('pages').insert({
      name: body.title,
      slug: body.slug,
      component_name: body.slug,
      page_type: body.page_type || 'landing',
      template_base: body.template_base || null,
      config: body.config || {},
      status: 'inactive',
      description: body.description || null
    }).select().single()

    if (createErr) return error(createErr.message, 500)
    return ok({ success: true, page: newPage }, 201)
  }

  if (req.method === 'PATCH') {
    if (!(await validateAuth(req, sb, 'write'))) return unauthorized()

    const slug = url.searchParams.get('slug')
    if (!slug) return error('slug query param é obrigatório')

    const { data: page, error: pErr } = await sb.from('pages').select('*').eq('slug', slug).single()
    if (pErr || !page) return error('Página não encontrada', 404)

    let body: any
    try { body = await req.json() } catch { return error('Body JSON inválido') }

    const updateData: any = {}

    // Merge config
    if (body.config) {
      updateData.config = { ...(page.config as any || {}), ...body.config }
    }

    // Active/status
    if (body.active !== undefined) {
      updateData.status = body.active ? 'active' : 'inactive'
    }

    // UTM preset
    let utmLink: string | null = null
    if (body.utm_preset) {
      const currentConfig = updateData.config || (page.config as any || {})
      const presets = currentConfig.utm_presets || []
      presets.push(body.utm_preset)
      updateData.config = { ...currentConfig, utm_presets: presets }

      // Generate UTM link
      const params = new URLSearchParams()
      if (body.utm_preset.utm_source) params.set('utm_source', body.utm_preset.utm_source)
      if (body.utm_preset.utm_medium) params.set('utm_medium', body.utm_preset.utm_medium)
      if (body.utm_preset.utm_campaign) params.set('utm_campaign', body.utm_preset.utm_campaign)
      if (body.utm_preset.utm_term) params.set('utm_term', body.utm_preset.utm_term)
      if (body.utm_preset.utm_content) params.set('utm_content', body.utm_preset.utm_content)
      utmLink = `https://dnia.ai/${slug}?${params.toString()}`
    }

    if (Object.keys(updateData).length > 0) {
      const { error: upErr } = await sb.from('pages').update(updateData).eq('id', page.id)
      if (upErr) return error(upErr.message, 500)
    }

    const response: any = { success: true, page_slug: slug }
    if (utmLink) response.utm_link = utmLink

    return ok(response)
  }

  return error('Method not allowed', 405)
})
