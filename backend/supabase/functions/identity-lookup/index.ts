import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateAuth, unauthorized, ok, error, handleCors } from '../_shared/auth.ts'

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
    const phone = url.searchParams.get('phone')
    const email = url.searchParams.get('email')
    const universal_id = url.searchParams.get('universal_id') || url.searchParams.get('dnia_id')

    if (!phone && !email && !universal_id) {
      return error('Must provide phone, email, or dnia_id', 400)
    }

    let query = supabase.from('ecosystem_identities').select('*')

    if (universal_id) {
      query = query.eq('dnia_id', universal_id)
    } else if (phone) {
      const { data: normalized } = await supabase.rpc('normalize_phone_br', { raw: phone })
      if (normalized) {
        query = query.eq('phone', normalized)
      } else {
        query = query.eq('phone', phone)
      }
    } else if (email) {
      query = query.ilike('email', email.trim().toLowerCase())
    }

    const { data: identity, error: idError } = await query.maybeSingle()

    if (idError) {
      console.error('Lookup error:', idError)
      return error('Internal error', 500)
    }

    if (!identity) {
      return error('Identity not found', 404)
    }

    let lead = null
    if (identity.dndash_lead_id) {
      const { data: leadData } = await supabase
        .from('leads')
        .select('nome, email, whatsapp, cargo, faturamento, funcionarios, etiqueta, status, utm_source, utm_campaign, source, created_at')
        .eq('id', identity.dndash_lead_id)
        .maybeSingle()

      if (leadData) {
        lead = {
          cargo: leadData.cargo,
          faturamento: leadData.faturamento,
          funcionarios: leadData.funcionarios,
          etiqueta: leadData.etiqueta,
          status: leadData.status,
          utm_source: leadData.utm_source,
          utm_campaign: leadData.utm_campaign,
          page_slug: leadData.source,
          created_at: leadData.created_at,
        }
      }
    }

    return ok({
      dnia_id: identity.dnia_id,
      phone: identity.phone,
      email: identity.email,
      nome: identity.nome,
      stage: identity.stage,
      first_touch_source: identity.first_touch_source,
      first_touch_app: identity.first_touch_app,
      dndash_lead_id: identity.dndash_lead_id,
      nexus_contact_id: identity.nexus_contact_id,
      mentoria_client_id: identity.mentoria_client_id,
      lead,
      last_seen_at: identity.last_seen_at,
      created_at: identity.created_at,
    })
  } catch (err) {
    console.error('Unexpected error:', err)
    return error('Internal server error', 500)
  }
})
