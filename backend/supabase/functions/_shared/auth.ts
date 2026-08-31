import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Exportado: o email-unsubscribe precisa dos headers CORS nas respostas (a
// pagina /descadastrar do app chama esta function via fetch cross-origin).
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export function validateToken(req: Request): boolean {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  return !!token && token === Deno.env.get('WEBHOOK_SECRET')
}

export async function validateAuth(
  req: Request,
  supabaseClient?: any,
  requiredPermission: 'read' | 'write' | 'read_write' = 'read_write'
): Promise<boolean> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return false

  // 1. Check WEBHOOK_SECRET (master key)
  if (token === Deno.env.get('WEBHOOK_SECRET')) return true

  // 2. Check API Keys table
  try {
    const sb = supabaseClient || createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const encoder = new TextEncoder()
    const data = encoder.encode(token)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const keyHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')

    const { data: apiKey } = await sb
      .from('api_keys')
      .select('id, permissions, expires_at, is_active')
      .eq('key_hash', keyHash)
      .eq('is_active', true)
      .single()

    if (!apiKey) return false

    // Check expiration
    if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
      await sb.from('api_keys').update({ is_active: false }).eq('id', apiKey.id)
      return false
    }

    // Check permissions
    if (requiredPermission === 'write' && apiKey.permissions === 'read') return false
    if (requiredPermission === 'read' && apiKey.permissions === 'write') return false

    // Update last_used_at (fire and forget)
    sb.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', apiKey.id).then(() => {})

    return true
  } catch (err) {
    console.error('API key validation error:', err)
    return false
  }
}

export function unauthorized() {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export function ok(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export function error(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }
  return null
}
