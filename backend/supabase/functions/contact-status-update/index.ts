import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateAuth, unauthorized, ok, error, handleCors } from '../_shared/auth.ts'

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  if (req.method !== 'PATCH' && req.method !== 'POST') {
    return error('Method not allowed. Use PATCH or POST.', 405)
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  if (!(await validateAuth(req, sb, 'write'))) return unauthorized()

  let body: any
  try {
    body = await req.json()
  } catch {
    return error('Invalid JSON body', 400)
  }

  const dnia_id: string | undefined = body?.dnia_id
  const rawStatus: string | undefined = body?.status

  if (!dnia_id || typeof dnia_id !== 'string') {
    return error('Campo "dnia_id" é obrigatório', 400)
  }
  if (!rawStatus || typeof rawStatus !== 'string') {
    return error('Campo "status" é obrigatório', 400)
  }

  const statusInput = rawStatus.trim()
  if (statusInput.length === 0) {
    return error('Campo "status" não pode ser vazio', 400)
  }
  if (statusInput.length > 60) {
    return error('Campo "status" não pode ter mais de 60 caracteres', 400)
  }

  // Resolve / auto-create status in lead_statuses (case-insensitive, no duplicates)
  let status = statusInput
  let statusCreated = false
  {
    const { data: existing, error: lookupErr } = await sb
      .from('lead_statuses')
      .select('id, name')
      .ilike('name', statusInput)
      .maybeSingle()

    if (lookupErr) {
      console.error('status_lookup_failed', lookupErr)
      return error(`Erro ao buscar status: ${lookupErr.message}`, 500)
    }

    if (existing) {
      status = existing.name
    } else {
      const { data: inserted, error: insErr } = await sb
        .from('lead_statuses')
        .insert({ name: statusInput, color: '#888780', is_system: false })
        .select('id, name')
        .single()

      if (insErr) {
        // Possible race: re-fetch
        const { data: retry } = await sb
          .from('lead_statuses')
          .select('id, name')
          .ilike('name', statusInput)
          .maybeSingle()
        if (retry) {
          status = retry.name
        } else {
          console.error('status_insert_failed', insErr)
          return error(`Erro ao criar status: ${insErr.message}`, 500)
        }
      } else {
        status = inserted.name
        statusCreated = true
        console.log('status_created', { name: status })
      }
    }
  }

  // Look up identity
  const { data: identity, error: idErr } = await sb
    .from('ecosystem_identities')
    .select('dnia_id, dndash_lead_id, phone, email')
    .eq('dnia_id', dnia_id)
    .maybeSingle()

  if (idErr) return error(`Erro ao buscar identidade: ${idErr.message}`, 500)
  if (!identity) return error('dnia_id não encontrado', 404)
  if (!identity.dndash_lead_id) {
    return error('Identidade não possui lead vinculado em dnMarketing', 404)
  }

  const leadId = identity.dndash_lead_id

  // Capture previous status
  const { data: leadBefore } = await sb
    .from('leads')
    .select('status')
    .eq('id', leadId)
    .maybeSingle()

  const previousStatus = leadBefore?.status || null

  // Update status
  const { error: upErr } = await sb
    .from('leads')
    .update({ status })
    .eq('id', leadId)

  if (upErr) return error(`Erro ao atualizar status: ${upErr.message}`, 500)

  // Handoff Nexus if Lead Qualificado
  if (status === 'Lead Qualificado') {
    try {
      await sb.rpc('resolve_or_create_identity', {
        p_phone: identity.phone || null,
        p_email: identity.email || null,
        p_source_app: 'dndash',
        p_local_id: leadId,
        p_stage: 'opportunity',
      })
    } catch (e) {
      console.error('Failed to advance stage:', e)
    }

    await sb.from('contact_events').insert({
      lead_id: leadId,
      dnia_id,
      source_app: 'dnmarketing',
      event_type: 'lead_qualified',
      title: 'Lead qualificado via API',
      description: 'Pronto para abordagem comercial',
      metadata: { qualified_by: 'api', status_anterior: previousStatus },
    })
  }

  // Always log the status change
  await sb.from('contact_events').insert({
    lead_id: leadId,
    dnia_id,
    source_app: 'dnmarketing',
    event_type: 'contact_updated',
    title: `Status atualizado para "${status}" via API`,
    metadata: {
      fields_updated: ['status'],
      source: 'api',
      status_anterior: previousStatus,
      status_atual: status,
      status_created: statusCreated,
    },
  })

  return ok({
    success: true,
    dnia_id,
    lead_id: leadId,
    status_anterior: previousStatus,
    status_atual: status,
    status_created: statusCreated,
  })
})
