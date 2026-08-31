import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, ok, error } from '../_shared/auth.ts'
import { getNexusCredentials } from '../_shared/nexusConfig.ts'

async function validateMergeAuth(req: Request, supabase: any): Promise<boolean> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return false

  // 1. Check WEBHOOK_SECRET (master key)
  if (token === Deno.env.get('WEBHOOK_SECRET')) return true

  // 2. Check Supabase JWT (admin users from the dashboard)
  try {
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token)
    if (!userErr && user) {
      const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('role', 'admin')
        .single()
      if (roleData) return true
    }
  } catch {}

  // 3. Check API Keys table
  try {
    const encoder = new TextEncoder()
    const data = encoder.encode(token)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const keyHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')

    const { data: apiKey } = await supabase
      .from('api_keys')
      .select('id, permissions, is_active')
      .eq('key_hash', keyHash)
      .eq('is_active', true)
      .single()

    if (apiKey && apiKey.permissions !== 'read') return true
  } catch {}

  return false
}

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  if (req.method !== 'POST') {
    return error('Method not allowed', 405)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  if (!(await validateMergeAuth(req, supabase))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }

  try {
    const body = await req.json()
    console.log('merge-identities body:', JSON.stringify(body))
    const { keep_id, discard_id } = body

    if (!keep_id || !discard_id) {
      console.log('Missing fields - keep_id:', keep_id, 'discard_id:', discard_id)
      return error('Missing required fields: keep_id and discard_id', 400)
    }

    if (keep_id === discard_id) {
      return error('keep_id and discard_id must be different', 400)
    }

    const { data, error: rpcError } = await supabase.rpc('merge_identities', {
      p_keep: keep_id,
      p_discard: discard_id,
    })

    if (rpcError) {
      console.error('Merge RPC error:', rpcError)
      return error(rpcError.message || 'Failed to merge identities', 500)
    }

    const result = data as Record<string, unknown>

    // Notify Nexus if the merged identity has a nexus_contact_id
    if (result?.nexus_contact_id) {
      try {
        const { apiKey: nexusApiKey, workspaceId: nexusWorkspaceId, baseUrl: nexusBaseUrl } = await getNexusCredentials()

        if (nexusBaseUrl && nexusApiKey && nexusWorkspaceId) {
          await fetch(`${nexusBaseUrl}/crm/contacts/${result.nexus_contact_id}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${nexusApiKey}`,
              'X-Workspace-Id': nexusWorkspaceId,
            },
            body: JSON.stringify({
              external_id: result.dnia_id,
              note: `DN.IA merge: ${discard_id} → ${result.dnia_id}`,
            }),
          })
        }
      } catch (nexusErr) {
        console.error('Nexus notification error (non-blocking):', nexusErr)
      }
    }

    return ok(result)
  } catch (err) {
    console.error('Unexpected error:', err)
    return error('Internal server error', 500)
  }
})
