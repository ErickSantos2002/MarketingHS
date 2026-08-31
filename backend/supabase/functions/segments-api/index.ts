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
      // Single segment detail
      const { data: segment, error: segErr } = await sb.from('segments').select('*').eq('id', id).single()
      if (segErr || !segment) return error('Segmento não encontrado', 404)

      let contacts: any[] = []
      if (segment.type === 'dynamic') {
        const { data: rpcData } = await sb.rpc('evaluate_segment_rules', { p_segment_id: id })
        const ids = (rpcData || []).slice(0, 20).map((r: any) => r.lead_id)
        if (ids.length > 0) {
          const { data } = await sb.from('leads').select('id, nome, email, whatsapp, etiqueta, status').in('id', ids)
          contacts = data || []
        }
      } else {
        const { data } = await sb.from('segment_contacts')
          .select('lead_id, leads(id, nome, email, whatsapp, etiqueta, status)')
          .eq('segment_id', id).limit(20)
        contacts = (data || []).map((r: any) => r.leads).filter(Boolean)
      }

      return ok({ ...segment, contacts })
    }

    // List segments
    const type = url.searchParams.get('type')
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '20')))
    const offset = (page - 1) * limit

    let query = sb.from('segments').select('*', { count: 'exact' })
    if (type) query = query.eq('type', type)
    query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1)

    const { data: segments, count, error: listErr } = await query
    if (listErr) return error(listErr.message, 500)

    // Get contact counts
    const result = await Promise.all((segments || []).map(async (seg: any) => {
      let contacts_count = 0
      if (seg.type === 'dynamic') {
        const { data: rpcData } = await sb.rpc('evaluate_segment_rules', { p_segment_id: seg.id })
        contacts_count = rpcData?.length || 0
      } else {
        const { count: c } = await sb.from('segment_contacts').select('*', { count: 'exact', head: true }).eq('segment_id', seg.id)
        contacts_count = c || 0
      }
      return { ...seg, contacts_count }
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
    try { body = await req.json() } catch { return error('Body JSON inválido') }

    if (action === 'add_contacts' && id) {
      // Add contacts to static segment
      const { data: seg } = await sb.from('segments').select('type').eq('id', id).single()
      if (!seg) return error('Segmento não encontrado', 404)
      if (seg.type !== 'static') return error('Só é possível adicionar contatos a segmentos estáticos')

      const contactIds = body.contact_ids
      if (!Array.isArray(contactIds) || contactIds.length === 0) return error('contact_ids é obrigatório')

      const rows = contactIds.map((lid: string) => ({ segment_id: id, lead_id: lid }))
      const { error: insErr } = await sb.from('segment_contacts').upsert(rows, { onConflict: 'segment_id,lead_id' })
      if (insErr) return error(insErr.message, 500)

      return ok({ success: true, segment_id: id, contacts_added: contactIds.length })
    }

    // Create segment
    if (!body.name) return error('name é obrigatório')

    const { data: newSeg, error: createErr } = await sb.from('segments').insert({
      name: body.name,
      type: body.type || 'dynamic',
      description: body.description || null,
      rules: body.rules || [],
      logic: body.logic === 'or' ? 'or' : 'and'
    }).select().single()

    if (createErr) return error(createErr.message, 500)

    // If static + contact_ids
    if (body.type === 'static' && Array.isArray(body.contact_ids) && body.contact_ids.length > 0) {
      const rows = body.contact_ids.map((lid: string) => ({ segment_id: newSeg.id, lead_id: lid }))
      await sb.from('segment_contacts').insert(rows)
    }

    return ok({ success: true, segment: newSeg }, 201)
  }

  return error('Method not allowed', 405)
})
