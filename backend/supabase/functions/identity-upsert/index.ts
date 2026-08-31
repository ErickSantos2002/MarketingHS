import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateAuth, unauthorized, ok, error, handleCors } from '../_shared/auth.ts'
import { extractAbParams, attachVisitorToContact } from '../_shared/ab.ts'
import { getNexusCredentials } from '../_shared/nexusConfig.ts'

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  if (!(await validateAuth(req, supabase, 'write'))) return unauthorized()

  try {
    const body = await req.json()
    const {
      phone,
      email,
      nome,
      source_app,
      local_id,
      stage,
      metadata,
      source,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_term,
      utm_content,
    } = body
    const contactFields: Record<string, unknown> = {
      ...((metadata && typeof metadata === 'object' && (metadata as any).contact_fields) || {}),
      ...((body && typeof body === 'object' && (body as any).contact_fields) || {}),
    }
    const ENRICHABLE_KEYS = ['cargo', 'empresa', 'faturamento', 'funcionarios', 'desafios'] as const
    const enrichPayload: Record<string, unknown> = {}
    for (const k of ENRICHABLE_KEYS) {
      const v = contactFields[k]
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        enrichPayload[k] = v
      }
    }

    // Build UTM payload (only non-empty values)
    const UTM_ENRICHABLE_KEYS = ['source', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const
    const rawUtmInputs: Record<string, unknown> = {
      source,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_term,
      utm_content,
    }
    const utmPayload: Record<string, string> = {}
    for (const k of UTM_ENRICHABLE_KEYS) {
      const v = rawUtmInputs[k]
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        utmPayload[k] = String(v).trim()
      }
    }

    if (!source_app) {
      return error('Missing required field: source_app', 400)
    }

    if (!phone && !email) {
      return error('Must provide phone or email', 400)
    }

    const { data, error: rpcError } = await supabase.rpc('resolve_or_create_identity', {
      p_phone: phone || null,
      p_email: email || null,
      p_nome: nome || null,
      p_source_app: source_app,
      p_local_id: local_id || null,
      p_stage: stage || null,
      p_utm_source: utmPayload.utm_source || null,
    })

    if (rpcError) {
      console.error('RPC error:', rpcError)
      return error('Failed to resolve identity', 500)
    }

    const result = data as Record<string, unknown>
    const uid = result?.dnia_id as string | undefined

    // Update ecosystem_identities with local_id for specific apps
    if (uid && local_id && source_app === 'nexus') {
      await supabase
        .from('ecosystem_identities')
        .update({ nexus_contact_id: local_id })
        .eq('dnia_id', uid)
    } else if (uid && local_id && source_app === 'mentoria') {
      await supabase
        .from('ecosystem_identities')
        .update({ mentoria_client_id: local_id })
        .eq('dnia_id', uid)
    }

    // Merge UTM + source into event metadata (caller metadata wins on conflicts)
    const eventMetadata = {
      ...utmPayload,
      ...(metadata && typeof metadata === 'object' ? metadata : {}),
    }

    // Auto-create lead if dndash_lead_id is null
    if (uid && !result.dndash_lead_id) {
      try {
        const { data: newLead, error: leadErr } = await supabase
          .from('leads')
          .insert({
            tipo: source || 'externo',
            nome: nome || null,
            email: email || null,
            whatsapp: phone || null,
            phone_normalized: (result.phone_normalized as string) || null,
            source: utmPayload.source || source_app,
            utm_source: utmPayload.utm_source || null,
            utm_medium: utmPayload.utm_medium || null,
            utm_campaign: utmPayload.utm_campaign || null,
            utm_term: utmPayload.utm_term || null,
            utm_content: utmPayload.utm_content || null,
            dnia_id: uid,
            status: 'Lead',
            ...enrichPayload,
          })
          .select('id')
          .single()

        if (leadErr) {
          console.error('Auto-create lead error:', leadErr)
        } else if (newLead) {
          // Link lead back to ecosystem_identities
          await supabase
            .from('ecosystem_identities')
            .update({ dndash_lead_id: newLead.id })
            .eq('dnia_id', uid)

          // Register sync event
          await supabase.from('contact_events').insert({
            lead_id: newLead.id,
            dnia_id: uid,
            source_app: source_app,
            event_type: 'contact_synced',
            title: `Contato sincronizado via ${source_app}`,
            metadata: eventMetadata,
          })

          // Update result with the new lead id
          result.dndash_lead_id = newLead.id
        }
      } catch (leadCreateErr) {
        console.error('Auto-create lead unexpected error:', leadCreateErr)
      }
    } else if (uid && result.dndash_lead_id) {
      // Lead already exists — register update event (fire-and-forget)
      supabase.from('contact_events').insert({
        lead_id: result.dndash_lead_id as string,
        dnia_id: uid,
        source_app: source_app,
        event_type: 'contact_updated',
        title: `Contato atualizado via ${source_app}`,
        metadata: eventMetadata,
      }).then(() => {})
    }

    // Enrich existing lead — fill only null/empty fields, never overwrite
    if (uid && result.dndash_lead_id && (Object.keys(enrichPayload).length > 0 || Object.keys(utmPayload).length > 0)) {
      try {
        const leadId = result.dndash_lead_id as string
        const { data: existing } = await supabase
          .from('leads')
          .select('tipo, cargo, empresa, faturamento, funcionarios, desafios, source, utm_source, utm_medium, utm_campaign, utm_term, utm_content')
          .eq('id', leadId)
          .single()
        if (existing) {
          const patch: Record<string, unknown> = {}
          // Contact fields
          for (const k of Object.keys(enrichPayload)) {
            const current = (existing as Record<string, unknown>)[k]
            if (current === null || current === undefined || String(current).trim() === '') {
              patch[k] = enrichPayload[k]
            }
          }
          // UTM + source
          for (const k of Object.keys(utmPayload)) {
            const current = (existing as Record<string, unknown>)[k]
            if (current === null || current === undefined || String(current).trim() === '') {
              patch[k] = utmPayload[k]
            }
          }
          // Map payload source into tipo when empty
          if (source !== undefined && source !== null && String(source).trim() !== '') {
            const currentTipo = (existing as Record<string, unknown>)['tipo']
            if (currentTipo === null || currentTipo === undefined || String(currentTipo).trim() === '') {
              patch['tipo'] = String(source).trim()
            }
          }
          if (Object.keys(patch).length > 0) {
            await supabase.from('leads').update(patch).eq('id', leadId)
          }
        }
      } catch (enrichErr) {
        console.error('Enrich lead error (non-blocking):', enrichErr)
      }
    }

    // Costura A/B (Nexus etapa 1: upsert de contato já com ab_vid). Cria o
    // vínculo ab_vid <-> contato o mais cedo possível — atribui até leads que
    // abandonam nas etapas seguintes do agendamento.
    const ab = extractAbParams(body)
    if (ab.ab_vid || ab.ab_test) {
      await attachVisitorToContact(supabase, {
        ab,
        email: email || null,
        phone: phone || null,
        phone_normalized: (result.phone_normalized as string) || null,
        lead_id: (result.dndash_lead_id as string) || null,
        dnia_id: uid || null,
        source_app,
        metadata: { origin: 'identity-upsert' },
      })
    }

    // If a merge occurred, notify Nexus about the new DNIA_ID
    if (result?.merged === true && result?.nexus_contact_id) {
      try {
        const { apiKey: nexusApiKey, workspaceId: nexusWorkspaceId, baseUrl: nexusBaseUrl } = await getNexusCredentials()

        if (nexusBaseUrl && nexusApiKey && nexusWorkspaceId) {
          const nexusContactId = result.nexus_contact_id as string
          console.log(`Merge detected: notifying Nexus contact ${nexusContactId} about new DNIA_ID ${uid}`)

          await fetch(`${nexusBaseUrl}/crm/contacts/${nexusContactId}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${nexusApiKey}`,
              'X-Workspace-Id': nexusWorkspaceId,
            },
            body: JSON.stringify({
              external_id: uid,
              note: `DN.IA merge: ${result.merged_from} → ${uid}`,
            }),
          })
        }
      } catch (nexusErr) {
        console.error('Nexus merge notification error (non-blocking):', nexusErr)
      }
    }

    return ok(result)
  } catch (err) {
    console.error('Unexpected error:', err)
    return error('Internal server error', 500)
  }
})
