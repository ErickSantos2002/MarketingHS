import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateAuth, unauthorized, ok, error, handleCors } from '../_shared/auth.ts'

function normalizeTag(raw: string): string {
  return String(raw || '').replace(/^\/+/, '').trim().toLowerCase()
}

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  if (req.method !== 'PUT' && req.method !== 'POST') {
    return error('Method not allowed. Use PUT or POST.', 405)
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
    return error('Invalid JSON body')
  }

  const { dnia_id, nexus_contact_id, email, tags } = body || {}

  if (!dnia_id && !nexus_contact_id && !email) {
    return error('Provide at least one identifier: dnia_id, nexus_contact_id or email')
  }

  if (!Array.isArray(tags)) {
    return error('Field "tags" must be an array of strings (use [] to remove all tags)')
  }

  // Normalize, dedupe, drop empties
  const normalizedTags = Array.from(
    new Set(
      tags
        .filter((t) => typeof t === 'string')
        .map(normalizeTag)
        .filter((t) => t.length > 0)
    )
  )

  // Resolve lead_id + dnia_id
  let leadId: string | null = null
  let resolvedDniaId: string | null = null

  if (dnia_id || nexus_contact_id) {
    let q = sb.from('ecosystem_identities').select('dnia_id, dndash_lead_id')
    if (dnia_id) q = q.eq('dnia_id', dnia_id)
    else q = q.eq('nexus_contact_id', nexus_contact_id)
    const { data: ident, error: identErr } = await q.maybeSingle()
    if (identErr) return error(identErr.message, 500)
    if (!ident) return error('Contato não encontrado para o identificador informado', 404)
    resolvedDniaId = ident.dnia_id
    leadId = ident.dndash_lead_id
  } else if (email) {
    const { data: lead, error: leadErr } = await sb
      .from('leads')
      .select('id, dnia_id')
      .ilike('email', email)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle()
    if (leadErr) return error(leadErr.message, 500)
    if (!lead) return error('Contato não encontrado pelo email informado', 404)
    leadId = lead.id
    resolvedDniaId = (lead as any).dnia_id || null
  }

  if (!leadId) {
    return error('Contato encontrado mas sem lead vinculado (dndash_lead_id ausente)', 404)
  }

  // Load current tags for the lead
  const { data: currentRows, error: curErr } = await sb
    .from('lead_tags')
    .select('tag_id, tags(id, name)')
    .eq('lead_id', leadId)
  if (curErr) return error(curErr.message, 500)

  const currentMap = new Map<string, string>() // name -> tag_id
  for (const row of (currentRows || []) as any[]) {
    if (row.tags?.name) currentMap.set(row.tags.name, row.tags.id)
  }

  const currentNames = new Set(currentMap.keys())
  const targetNames = new Set(normalizedTags)

  const added: string[] = []
  const removed: string[] = []
  const kept: string[] = []

  for (const name of targetNames) {
    if (currentNames.has(name)) kept.push(name)
    else added.push(name)
  }
  for (const name of currentNames) {
    if (!targetNames.has(name)) removed.push(name)
  }

  // Resolve / create tag ids for added
  const createdTags: string[] = []
  const addedTagIds: string[] = []

  for (const name of added) {
    const { data: existing } = await sb
      .from('tags')
      .select('id')
      .eq('name', name)
      .maybeSingle()

    let tagId: string | null = existing?.id || null

    if (!tagId) {
      const { data: newTag, error: insErr } = await sb
        .from('tags')
        .insert({ name })
        .select('id')
        .single()
      if (insErr) {
        const { data: retry } = await sb
          .from('tags')
          .select('id')
          .eq('name', name)
          .maybeSingle()
        tagId = retry?.id || null
      } else {
        tagId = newTag.id
        createdTags.push(name)
      }
    }

    if (tagId) addedTagIds.push(tagId)
  }

  // Insert new associations
  if (addedTagIds.length > 0) {
    const rows = addedTagIds.map((tag_id) => ({ lead_id: leadId, tag_id }))
    await sb.from('lead_tags').upsert(rows, { onConflict: 'lead_id,tag_id' })
  }

  // Remove obsolete associations (only specific tag_ids)
  const removedTagIds = removed
    .map((name) => currentMap.get(name))
    .filter((id): id is string => !!id)

  if (removedTagIds.length > 0) {
    await sb
      .from('lead_tags')
      .delete()
      .eq('lead_id', leadId)
      .in('tag_id', removedTagIds)
  }

  // Register event
  await sb.from('contact_events').insert({
    lead_id: leadId,
    dnia_id: resolvedDniaId,
    source_app: 'nexus',
    event_type: 'tags_synced',
    title: 'Tags sincronizadas via Nexus',
    metadata: {
      added,
      removed,
      kept,
      total: normalizedTags.length,
      source: 'nexus',
    },
  })

  return ok({
    success: true,
    dnia_id: resolvedDniaId,
    lead_id: leadId,
    tags_final: normalizedTags,
    added,
    removed,
    kept,
    created_tags: createdTags,
  })
})
