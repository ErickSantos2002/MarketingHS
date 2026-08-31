import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateAuth, unauthorized, ok, error, handleCors } from '../_shared/auth.ts'
import { getIntegrationSecret } from '../_shared/secrets.ts'
import { htmlToText } from '../_shared/htmlToText.ts'

// Envio de UM email de teste a partir de um template de email_templates.
// Chamada exclusivamente pelo browser (TemplatePreview.tsx, rota
// /templates/:id/preview) para o admin conferir o template no cliente de email
// real antes de usa-lo numa campanha.
//
// NAO e um caminho de campanha:
//   - nao cria linha em campaign_sends;
//   - nao manda tags de correlacao (campaign_id/lead_id/send_id) para o Resend
//     -- o resend-webhook resolve envios por essas tags, e um teste nao pode
//     aparecer nas metricas de nenhuma campanha;
//   - nao passa pela fila pgmq (envio unico, sincrono).
// Toda a logica de envio em massa continua em send-campaign/process-email-queue.
//
// O HTML NUNCA vem do corpo da requisicao: so o template_id. E o que impede
// usar este endpoint para disparar conteudo arbitrario com o dominio verificado
// do remetente.

// AUTENTICACAO: mesmo padrao de resend-config-check/send-campaign. A entrada em
// config.toml traz verify_jwt = false (senao o gateway barraria os chamadores
// server-to-server), entao a checagem TEM de acontecer aqui dentro.
async function isAuthorized(req: Request, sb: any): Promise<boolean> {
  // 1. Server-to-server: WEBHOOK_SECRET ou API key (tabela api_keys).
  if (await validateAuth(req, sb, 'write')) return true

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
    console.error('send-test-email isAuthorized (user JWT path) error:', err)
    return false
  }
}

// Espelha EMAIL_MERGE_TAGS de src/components/admin/campaigns/emailEditorConfig.ts
// (Deno nao importa de src/). unsubscribe_url vira '#': o link real e assinado
// por destinatario em process-email-queue e nao existe para um envio de teste.
const SAMPLE_MERGE_TAGS: Record<string, string> = {
  '{{nome}}': 'João Silva',
  '{{empresa}}': 'Empresa LTDA',
  '{{email}}': 'joao@empresa.com',
  '{{unsubscribe_url}}': '#',
}

function applySampleMergeTags(html: string): string {
  let out = html
  for (const [tag, sample] of Object.entries(SAMPLE_MERGE_TAGS)) {
    out = out.split(tag).join(sample)
  }
  return out
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors
  if (req.method !== 'POST') return error('Method not allowed', 405)

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  if (!(await isAuthorized(req, sb))) return unauthorized()

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return error('Corpo da requisição inválido')
  }

  const templateId = typeof body?.template_id === 'string' ? body.template_id.trim() : ''
  const to = typeof body?.to === 'string' ? body.to.trim() : ''

  if (!templateId) return error('template_id é obrigatório')
  if (!EMAIL_RE.test(to)) return error('Email de destino inválido')

  const { data: template, error: tplErr } = await sb
    .from('email_templates')
    .select('name, html')
    .eq('id', templateId)
    .maybeSingle()

  if (tplErr) {
    console.error('send-test-email: erro ao ler template', templateId, tplErr)
    return error('Falha ao carregar o template', 500)
  }
  if (!template) return error('Template não encontrado', 404)
  if (!template.html || String(template.html).trim().length === 0) {
    return error('Este template ainda não tem conteúdo para enviar')
  }

  // Supressao: um teste nao pode furar a lista de descadastro. Se o admin
  // mandar para um endereco suprimido, o erro e explicito -- envio silencioso
  // seria uma violacao de compliance dificil de perceber.
  const { data: suppressed, error: supErr } = await sb
    .from('email_suppressions')
    .select('reason')
    .eq('email', to.toLowerCase())
    .maybeSingle()

  if (supErr) {
    console.error('send-test-email: erro ao checar supressão', supErr)
    return error('Falha ao verificar a lista de descadastro', 500)
  }
  if (suppressed) {
    return error(`Este endereço está na lista de descadastro (${suppressed.reason}) e não pode receber emails`)
  }

  // Credenciais na MESMA ordem de prioridade de process-email-queue: Vault ->
  // env para a chave; dashboard_settings.resend_from -> EMAIL_FROM -> hardcoded
  // para o remetente. Divergir daqui faria o teste sair de um remetente
  // diferente do que a campanha real usaria -- ou seja, testaria a coisa errada.
  const resendKey = await getIntegrationSecret(sb, 'RESEND_API_KEY')
  if (!resendKey) return error('RESEND_API_KEY não configurada', 500)

  let emailFrom = 'DN.IA <noreply@dnia.ai>'
  const envEmailFrom = Deno.env.get('EMAIL_FROM')
  if (envEmailFrom) emailFrom = envEmailFrom
  try {
    const { data: fromRow, error: fromErr } = await sb
      .from('dashboard_settings')
      .select('setting_value')
      .eq('setting_key', 'resend_from')
      .maybeSingle()
    if (fromErr) console.error('send-test-email: erro ao ler dashboard_settings.resend_from:', fromErr)
    const storedFrom = (fromRow?.setting_value as { from?: string } | null)?.from
    if (typeof storedFrom === 'string' && storedFrom.length > 0) emailFrom = storedFrom
  } catch (err) {
    console.error('send-test-email: exceção ao ler dashboard_settings.resend_from:', err)
  }

  // Mesma parte text/plain que o envio real produz (ver process-email-queue):
  // sem ela o email de teste nao reproduziria o que o contato recebe, que e
  // justamente o que este endpoint existe para conferir.
  const html = applySampleMergeTags(String(template.html))
  const text = htmlToText(html)

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: emailFrom,
        to: [to],
        subject: `[Teste] ${template.name}`,
        html,
        ...(text ? { text } : {}),
      }),
    })

    if (!res.ok) {
      const errBody = await res.text()
      console.error('send-test-email: Resend respondeu', res.status, errBody)
      return error(`O Resend recusou o envio (${res.status})`, 502)
    }

    const sent = await res.json()
    return ok({ sent: true, to, from: emailFrom, resend_email_id: sent?.id ?? null })
  } catch (err) {
    console.error('send-test-email: falha ao chamar o Resend:', err)
    return error('Falha ao conectar ao Resend', 502)
  }
})
