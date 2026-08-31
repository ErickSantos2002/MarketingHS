import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateAuth, unauthorized, ok, error, handleCors } from '../_shared/auth.ts'

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  if (req.method !== 'PATCH') {
    return error('Method not allowed', 405)
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  if (!(await validateAuth(req, sb, 'write'))) return unauthorized()

  const url = new URL(req.url)
  const phone = url.searchParams.get('phone')
  const email = url.searchParams.get('email')
  const dnia_id = url.searchParams.get('dnia_id')

  if (!phone && !email && !dnia_id) {
    return error('Informe phone, email ou dnia_id como query param')
  }

  // Find lead
  let query = sb.from('leads').select('*')
  if (dnia_id) query = query.eq('dnia_id', dnia_id)
  else if (email) query = query.ilike('email', email)
  else if (phone) {
    // normalize phone
    const digits = phone.replace(/\D/g, '')
    let norm = phone
    if (digits.startsWith('55') && digits.length >= 12) norm = '+' + digits
    else if (digits.length >= 10 && digits.length <= 11) norm = '+55' + digits
    query = query.or(`phone_normalized.eq.${norm},whatsapp.eq.${phone}`)
  }

  const { data: leads, error: leadErr } = await query.limit(1)
  if (leadErr) return error(leadErr.message, 500)
  if (!leads || leads.length === 0) return error('Contato não encontrado', 404)

  const lead = leads[0]
  let body: any
  try { body = await req.json() } catch { body = {} }

  const updatedFields: string[] = []

  // Update lead fields
  const allowedFields = ['status', 'nome', 'cargo', 'whatsapp', 'empresa', 'faturamento', 'funcionarios', 'desafios']
  const updateData: any = {}
  for (const f of allowedFields) {
    if (body[f] !== undefined) {
      updateData[f] = body[f]
      updatedFields.push(f)
    }
  }

  if (Object.keys(updateData).length > 0) {
    const { error: upErr } = await sb.from('leads').update(updateData).eq('id', lead.id)
    if (upErr) return error(`Erro ao atualizar lead: ${upErr.message}`, 500)
  }

  // Handle tags_add
  if (body.tags_add && Array.isArray(body.tags_add) && body.tags_add.length > 0) {
    for (const tagName of body.tags_add) {
      // Find or create tag
      let { data: tag } = await sb.from('tags').select('id').eq('name', tagName).single()
      if (!tag) {
        const { data: newTag } = await sb.from('tags').insert({ name: tagName }).select('id').single()
        tag = newTag
      }
      if (tag) {
        await sb.from('lead_tags').upsert({ lead_id: lead.id, tag_id: tag.id }, { onConflict: 'lead_id,tag_id' })
      }
    }
    updatedFields.push('tags')
  }

  // Handle tags_remove
  if (body.tags_remove && Array.isArray(body.tags_remove) && body.tags_remove.length > 0) {
    for (const tagName of body.tags_remove) {
      const { data: tag } = await sb.from('tags').select('id').eq('name', tagName).single()
      if (tag) {
        await sb.from('lead_tags').delete().eq('lead_id', lead.id).eq('tag_id', tag.id)
      }
    }
    if (!updatedFields.includes('tags')) updatedFields.push('tags')
  }

  // Handle note
  if (body.note) {
    await sb.from('lead_notes').insert({ lead_id: lead.id, content: body.note })
    updatedFields.push('note')
  }

  // Register event
  await sb.from('contact_events').insert({
    lead_id: lead.id,
    dnia_id: lead.dnia_id || null,
    source_app: 'dnmarketing',
    event_type: 'contact_updated',
    title: 'Contato atualizado via API',
    metadata: { fields_updated: updatedFields, source: 'api' }
  })

  // Re-fetch updated lead
  const { data: updatedLead } = await sb.from('leads').select('*').eq('id', lead.id).single()

  return ok({
    success: true,
    dnia_id: updatedLead?.dnia_id || lead.dnia_id,
    updated_fields: updatedFields,
    lead_score: updatedLead?.lead_score || 0,
    etiqueta: updatedLead?.etiqueta || null
  })
})
