import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateAuth, unauthorized, ok, error, handleCors } from '../_shared/auth.ts'
import { getIntegrationSecret } from '../_shared/secrets.ts'

// AUTENTICACAO (correcao C2, achado do review final): este endpoint e chamado
// pelo browser (ResendCard.tsx via supabase.functions.invoke), que so consegue
// anexar o JWT de sessao do admin logado -- nunca o WEBHOOK_SECRET nem uma
// api_key da tabela api_keys, que eram as UNICAS credenciais aceitas por
// validateAuth(). Resultado: 401 em TODA chamada da UI, sempre ("Nao foi
// possivel chamar a funcao..."). Mesmo padrao ja usado em send-campaign/index.ts
// (isAuthorized) e em delete-contact/index.ts (auth.getUser() + user_roles):
// aceita ADICIONALMENTE um JWT de usuario com role admin, sem abrir mao da
// checagem -- nunca vira no-auth.
async function isAuthorized(req: Request, sb: any): Promise<boolean> {
  // 1. Server-to-server: WEBHOOK_SECRET ou API key (tabela api_keys).
  if (await validateAuth(req, sb, 'read')) return true

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
    console.error('resend-config-check isAuthorized (user JWT path) error:', err)
    return false
  }
}

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors
  if (req.method !== 'GET') return error('Method not allowed', 405)

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  if (!(await isAuthorized(req, sb))) return unauthorized()

  // Vault primeiro, com fallback para Deno.env.get (getIntegrationSecret nunca
  // lanca) -- senao o card acusa falso "faltando" para quem configurou pela
  // UI nova (ResendConfigCard/resend-config), que grava só no Vault.
  const missing: string[] = []
  const apiKey = await getIntegrationSecret(sb, 'RESEND_API_KEY')
  const webhookSecret = await getIntegrationSecret(sb, 'RESEND_WEBHOOK_SECRET')

  // "from" tambem passa a considerar dashboard_settings.resend_from (gravado
  // pela UI nova) antes do env, pelo mesmo motivo acima -- nao é segredo
  // (não passa por getIntegrationSecret/Vault), mas o card não pode acusar
  // falta dele depois de salvar pela UI.
  let from = Deno.env.get('EMAIL_FROM') ?? null
  const { data: fromRow } = await sb
    .from('dashboard_settings')
    .select('setting_value')
    .eq('setting_key', 'resend_from')
    .maybeSingle()
  const storedFrom = (fromRow?.setting_value as any)?.from
  if (typeof storedFrom === 'string' && storedFrom.length > 0) from = storedFrom

  if (!apiKey) missing.push('RESEND_API_KEY')
  if (!from) missing.push('EMAIL_FROM')
  if (!webhookSecret) missing.push('RESEND_WEBHOOK_SECRET')

  // I5 (achado do review final): UNSUBSCRIBE_SECRET nao entrava em nenhuma
  // checagem aqui, entao o card reportava "Conectado" enquanto TODO email saia
  // sem List-Unsubscribe/List-Unsubscribe-Post/rodape (RFC 8058) -- o worker
  // process-email-queue faz buildUnsubscribeUrl() retornar null em silencio
  // quando o secret esta ausente. Reportado num campo PROPRIO (nao dentro de
  // `missing`, que bloqueia o "ok:true"): a ausencia deste secret nao afeta a
  // conectividade com o Resend, entao o card deve poder mostrar "Conectado" E,
  // separadamente, um aviso de compliance bem visivel -- ver ResendCard.tsx.
  const unsubscribeSecretMissing = !(await getIntegrationSecret(sb, 'UNSUBSCRIBE_SECRET'))

  if (missing.length) return ok({ ok: false, missing, unsubscribe_secret_missing: unsubscribeSecretMissing })

  try {
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) {
      console.error('resend-config-check: Resend respondeu', res.status)
      return ok({ ok: false, missing: [], unsubscribe_secret_missing: unsubscribeSecretMissing, api_error: `Resend respondeu ${res.status}` })
    }
    const body = await res.json()
    const domains = (body?.data ?? []).map((d: any) => ({ name: d.name, status: d.status }))
    return ok({ ok: true, from, domains, unsubscribe_secret_missing: unsubscribeSecretMissing })
  } catch (err) {
    console.error('resend-config-check error:', err)
    return ok({ ok: false, missing: [], unsubscribe_secret_missing: unsubscribeSecretMissing, api_error: 'Falha ao conectar ao Resend' })
  }
})
