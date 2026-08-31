import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateAuth, validateToken, unauthorized, ok, error, handleCors } from '../_shared/auth.ts'
import { getIntegrationSecret } from '../_shared/secrets.ts'

// Configuração do Resend pela UI (ResendConfigCard.tsx). Ao contrário de
// resend-config-check (só diagnóstico, read-only), esta função GRAVA os
// segredos -- por isso o teste da chave (GET /domains) precisa classificar
// os 3 casos documentados na doc oficial do Resend
// (https://resend.com/docs/api-reference/errors,
//  https://resend.com/docs/api-reference/api-keys/create-api-key):
//   200                        -> chave válida, full access (lista domínios)
//   401 name=restricted_api_key -> chave VÁLIDA, sending-only (não lista domínios)
//   403 name=invalid_api_key    -> chave inválida
// Testar só "deu 200?" reprovaria uma chave de envio perfeitamente válida.
//
// Segredos vão para o Vault via as RPCs set_integration_secret/
// get_integration_secret (migration 20260714160000_resend_config.sql), NUNCA
// para uma tabela comum e NUNCA ecoados de volta na resposta. O remetente
// ("from") não é segredo e fica em dashboard_settings (setting_key=
// 'resend_from'), já com RLS admin-only.
//
// action 'enable_tracking': liga open/click tracking no domínio (PATCH
// /domains/:id). O Resend vem com os dois DESLIGADOS por padrão -- por isso
// o webhook recebe email.sent/email.delivered mas nunca email.opened/
// email.clicked mesmo com tudo mais configurado certo. Exige uma chave full
// access (sending_only recebe o mesmo 401 restricted_api_key de sempre) e
// exige um CNAME novo no DNS (o subdomínio de tracking) que só o usuário
// pode aplicar -- a função devolve os registros para a UI mostrar.

const RESEND_DOMAINS_URL = 'https://api.resend.com/domains'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/ // mesma forma de process-email-queue/index.ts

interface ResendDomain {
  id: string
  name: string
  status: string
  capabilities?: { sending?: string; receiving?: string } | null
}

type TestResult =
  | { valid: true; scope: 'full'; domains: ResendDomain[] }
  | { valid: true; scope: 'sending_only'; domains: [] }
  | { valid: false; reason: 'invalid_api_key' | 'network' | 'unknown'; status?: number }

// AUTENTICACAO (mesmo padrão de resend-config-check/index.ts): a UI chama do
// navegador com o JWT de sessão do admin logado -- validateAuth() sozinho
// (WEBHOOK_SECRET / api_keys) daria 401 sempre nesse caminho. Aceita
// ADICIONALMENTE um JWT de usuário com role admin, sem abrir mão da checagem.
//
// I2 (achado do review): a rota 'save' GRAVA segredos (RESEND_API_KEY,
// UNSUBSCRIBE_SECRET, RESEND_WEBHOOK_SECRET). Uma api_key da tabela
// `api_keys` com permissions='write' NUNCA pode autorizar 'save' -- se
// vazasse, permitiria trocar o RESEND_API_KEY por um de outra conta Resend
// (toda campanha passaria a sair -- e ser lida -- pela conta do atacante,
// exfiltrando a base de contatos) ou rotacionar o UNSUBSCRIBE_SECRET e
// quebrar todo link de descadastro já entregue. Por isso 'write' só aceita
// o WEBHOOK_SECRET (master key, via validateToken) OU o JWT de admin; NUNCA
// uma api_key de `api_keys`, mesmo com permissions='write'. 'read' (GET e
// action:'test') mantém o dual-auth de sempre (WEBHOOK_SECRET / api_keys /
// JWT admin) -- nenhum desses caminhos grava nada.
async function isAuthorized(req: Request, sb: any, requiredPermission: 'read' | 'write'): Promise<boolean> {
  // 1. Server-to-server.
  if (requiredPermission === 'write') {
    if (validateToken(req)) return true // só WEBHOOK_SECRET -- api_keys da tabela NUNCA autorizam save.
  } else {
    if (await validateAuth(req, sb, requiredPermission)) return true // WEBHOOK_SECRET ou api_keys (read).
  }

  // 2. Navegador: JWT do usuário logado, com role admin.
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
    console.error('resend-config isAuthorized (user JWT path) error:', err)
    return false
  }
}

// Try/catch obrigatório em volta do fetch E do .json() -- uma exceção de rede
// ou um corpo não-JSON nunca pode derrubar a invocação (mesma lição do fix
// de resend-config-check).
async function testResendKey(apiKey: string): Promise<TestResult> {
  let res: Response
  try {
    res = await fetch(RESEND_DOMAINS_URL, { headers: { Authorization: `Bearer ${apiKey}` } })
  } catch (err) {
    console.error('resend-config testResendKey network error')
    return { valid: false, reason: 'network' }
  }

  if (res.status === 200) {
    try {
      const body = await res.json()
      const domains: ResendDomain[] = Array.isArray(body?.data)
        ? body.data.map((d: any) => ({ id: d?.id, name: d?.name, status: d?.status, capabilities: d?.capabilities ?? null }))
        : []
      return { valid: true, scope: 'full', domains }
    } catch (err) {
      console.error('resend-config testResendKey: falha ao parsear resposta 200')
      return { valid: false, reason: 'network' }
    }
  }

  if (res.status === 401) {
    // 401 restricted_api_key = chave VÁLIDA, só não pode listar domínios.
    // Qualquer outro 401 (corpo diferente, ou não-JSON) é tratado como chave
    // inválida -- não arriscamos classificar como válida por omissão.
    try {
      const body = await res.json()
      if (body?.name === 'restricted_api_key' || JSON.stringify(body).includes('restricted_api_key')) {
        return { valid: true, scope: 'sending_only', domains: [] }
      }
    } catch (err) {
      console.error('resend-config testResendKey: falha ao parsear resposta 401')
    }
    return { valid: false, reason: 'invalid_api_key', status: 401 }
  }

  if (res.status === 403) {
    return { valid: false, reason: 'invalid_api_key', status: 403 }
  }

  console.error('resend-config testResendKey: Resend respondeu', res.status)
  return { valid: false, reason: 'unknown', status: res.status }
}

// GET /domains/{id} -- fonte da verdade do estado do tracking. Ao contrário da
// LISTAGEM (GET /domains), que não garante trazer open_tracking/click_tracking
// por item, o GET de domínio único SEMPRE devolve open_tracking,
// click_tracking, tracking_subdomain e o array `records`. É por isso que o card
// consulta este endpoint em vez de confiar na listagem: sem ele o estado do
// tracking seria "desconhecido" e o usuário não teria como saber que precisa
// ativar (ou que ativou e esqueceu o CNAME).
//
// Os records são filtrados para os de `record === 'Tracking'` -- os demais
// (SPF/DKIM/MX) já foram resolvidos na verificação original do domínio e não
// têm nada a ver com abertura/clique.
type DomainInfoResult =
  | {
      ok: true
      open_tracking: boolean
      click_tracking: boolean
      tracking_subdomain: string | null
      status: string | null
      records: unknown[]
    }
  | { ok: false; reason: 'restricted_api_key' | 'network' | 'not_found' | 'unknown'; status?: number; message?: string }

async function fetchDomainInfo(apiKey: string, domainId: string): Promise<DomainInfoResult> {
  let res: Response
  try {
    res = await fetch(`${RESEND_DOMAINS_URL}/${domainId}`, { headers: { Authorization: `Bearer ${apiKey}` } })
  } catch (err) {
    console.error('resend-config fetchDomainInfo network error:', err)
    return { ok: false, reason: 'network' }
  }

  let domainBody: any = null
  try {
    domainBody = await res.json()
  } catch (err) {
    console.error('resend-config fetchDomainInfo: falha ao parsear resposta', err)
    if (res.ok) return { ok: false, reason: 'unknown', status: res.status }
    domainBody = null
  }

  if (res.status === 401) {
    // Mesma classificação de testResendKey: chave sending-only é VÁLIDA, só
    // não consegue ler/alterar domínios. Não é um erro do usuário -- é um
    // estado que a UI precisa distinguir de "chave inválida".
    if (domainBody?.name === 'restricted_api_key' || JSON.stringify(domainBody ?? {}).includes('restricted_api_key')) {
      return { ok: false, reason: 'restricted_api_key', status: 401 }
    }
    return { ok: false, reason: 'unknown', status: 401, message: domainBody?.message }
  }

  if (res.status === 404) return { ok: false, reason: 'not_found', status: 404 }

  if (!res.ok) {
    console.error('resend-config fetchDomainInfo: Resend respondeu', res.status, domainBody)
    return { ok: false, reason: 'unknown', status: res.status, message: domainBody?.message }
  }

  return {
    ok: true,
    open_tracking: !!domainBody?.open_tracking,
    click_tracking: !!domainBody?.click_tracking,
    tracking_subdomain: domainBody?.tracking_subdomain ?? null,
    status: domainBody?.status ?? null,
    records: Array.isArray(domainBody?.records)
      ? domainBody.records.filter((r: any) => r?.record === 'Tracking')
      : [],
  }
}

// Leitura de segredo é SEMPRE via getIntegrationSecret (_shared/secrets.ts):
// Vault -> env, a mesma resolução usada pelo worker, pelo email-unsubscribe e
// pelo resend-webhook. Existia aqui um getStoredSecret (Vault-only) e foi ele
// que fez o card reportar "não configurado" para segredos que estavam no env —
// o que suprimia o aviso de que trocar o UNSUBSCRIBE_SECRET invalida os links
// de descadastro já enviados. Não reintroduzir uma leitura Vault-only.

async function setStoredSecret(sb: any, name: string, value: string): Promise<boolean> {
  const { error: rpcErr } = await sb.rpc('set_integration_secret', { p_name: name, p_value: value })
  if (rpcErr) {
    console.error('resend-config setStoredSecret rpc error for', name)
    return false
  }
  return true
}

function last4(value: string): string {
  return value.length > 4 ? value.slice(-4) : value
}

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  if (req.method !== 'GET' && req.method !== 'POST') return error('Method not allowed', 405)

  // Corpo é lido ANTES da checagem de autorização apenas para o POST (para
  // saber a action e assim exigir 'write' só quando for 'save'); nada nele é
  // usado antes de isAuthorized() responder true.
  let body: any = null
  if (req.method === 'POST') {
    try {
      body = await req.json()
    } catch {
      return error('Body JSON inválido')
    }
  }
  // 'enable_tracking' GRAVA no domínio Resend (PATCH /domains/:id) -- mesmo
  // caminho restrito de 'save' (só WEBHOOK_SECRET ou JWT de admin; NUNCA uma
  // api_key da tabela `api_keys`, mesmo com permissions='write').
  const requiredPermission: 'read' | 'write' =
    body?.action === 'save' || body?.action === 'enable_tracking' ? 'write' : 'read'
  if (!(await isAuthorized(req, sb, requiredPermission))) return unauthorized()

  const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/resend-webhook`

  // -------------------------------------------------------------------------
  // GET -- estado atual (nunca devolve nenhum segredo, só configured + last4
  // da API key).
  // -------------------------------------------------------------------------
  if (req.method === 'GET') {
    // C2 (achado do review): usar getIntegrationSecret (Vault -> env), a
    // MESMA resolução usada por resend-config-check e pelos consumidores
    // reais (process-email-queue, email-unsubscribe, resend-webhook). Com
    // getStoredSecret (Vault-only) o card mentia "não configurado" sempre
    // que o segredo só existia no env (estado de produção antes desta UI) --
    // isso escondia o aviso "trocar isso invalida os links de descadastro já
    // enviados" e o admin, ao clicar "Gerar", quebrava em silêncio todo link
    // de descadastro já entregue.
    const [apiKey, unsubscribeSecret, webhookSecret] = await Promise.all([
      getIntegrationSecret(sb, 'RESEND_API_KEY'),
      getIntegrationSecret(sb, 'UNSUBSCRIBE_SECRET'),
      getIntegrationSecret(sb, 'RESEND_WEBHOOK_SECRET'),
    ])

    const { data: fromRow } = await sb
      .from('dashboard_settings')
      .select('setting_value')
      .eq('setting_key', 'resend_from')
      .maybeSingle()

    let domains: ResendDomain[] = []
    let scope: 'full' | 'sending_only' | null = null
    if (apiKey) {
      const test = await testResendKey(apiKey)
      if (test.valid) {
        scope = test.scope
        domains = test.domains
      }
    }

    return ok({
      resend_api_key: { configured: !!apiKey, last4: apiKey ? last4(apiKey) : null, scope },
      unsubscribe_secret: { configured: !!unsubscribeSecret },
      webhook_secret: { configured: !!webhookSecret },
      from: fromRow?.setting_value ?? null,
      domains,
      webhook_url: webhookUrl,
    })
  }

  // req.method === 'POST' daqui em diante (validado acima); body já foi
  // parseado antes da checagem de autorização.

  // -------------------------------------------------------------------------
  // POST { action: 'test', api_key } -- nunca persiste, só classifica.
  // -------------------------------------------------------------------------
  if (body.action === 'test') {
    const apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''
    if (!apiKey) return error('api_key é obrigatório')

    const result = await testResendKey(apiKey)
    if (!result.valid) return ok({ valid: false, reason: result.reason })
    return ok({ valid: true, scope: result.scope, domains: result.domains })
  }

  // -------------------------------------------------------------------------
  // POST { action: 'save', ... }
  // -------------------------------------------------------------------------
  if (body.action === 'save') {
    const fromName = typeof body.from_name === 'string' ? body.from_name.trim() : ''
    const fromPrefix = typeof body.from_prefix === 'string' ? body.from_prefix.trim() : ''
    const fromDomain = typeof body.from_domain === 'string' ? body.from_domain.trim() : ''
    if (!fromName || !fromPrefix || !fromDomain) {
      return error('from_name, from_prefix e from_domain são obrigatórios')
    }

    const providedKey = typeof body.api_key === 'string' && body.api_key.trim().length > 0
      ? body.api_key.trim()
      : null

    // 1. Nunca salvar uma chave sem validar: se veio api_key, re-testa agora.
    //    Se NÃO veio, usa a chave já salva (se houver) só para poder validar o
    //    domínio -- uma falha aqui não bloqueia o save de from/secrets, apenas
    //    degrada a validação de domínio para "não foi possível confirmar".
    let testResult: TestResult | null = null
    if (providedKey) {
      testResult = await testResendKey(providedKey)
      if (!testResult.valid) {
        return error(`Chave do Resend inválida ou inacessível (${testResult.reason})`, 400)
      }
    } else {
      // Mesma resolução do GET e dos consumidores (Vault -> env). Com
      // getStoredSecret (Vault-only), um admin que já tem a chave no env e só
      // quer ajustar o remetente cairia aqui com existingKey nulo: a validação
      // de domínio seria pulada e ele receberia um "não foi possível confirmar
      // a verificação do domínio" sem motivo.
      const existingKey = await getIntegrationSecret(sb, 'RESEND_API_KEY')
      if (existingKey) testResult = await testResendKey(existingKey)
    }

    // 2. Domínio verificado -- só dá para exigir isso quando a chave tem
    //    escopo full (lista domínios). Sending-only: aceita com aviso.
    let domainWarning: string | null = null
    if (testResult && testResult.valid && testResult.scope === 'full') {
      const domain = testResult.domains.find((d) => d.name === fromDomain)
      if (!domain) {
        return error(`Domínio "${fromDomain}" não encontrado na conta Resend`, 400)
      }
      const sendingEnabled = domain.capabilities?.sending === 'enabled'
      const verified = domain.status === 'verified' || (domain.status?.startsWith('partially_') && sendingEnabled)
      if (!verified) {
        return error(`Domínio "${fromDomain}" não está verificado (status: ${domain.status})`, 400)
      }
    } else {
      domainWarning = 'Não foi possível confirmar a verificação do domínio (chave sending-only ou ainda não testada) -- confira manualmente em resend.com/domains.'
    }

    // 3. Monta e valida o remetente final.
    const fromEmail = `${fromPrefix}@${fromDomain}`
    if (!EMAIL_RE.test(fromEmail)) return error('Prefixo/domínio formam um endereço de remetente inválido', 400)
    const from = `${fromName} <${fromEmail}>`

    // 4. Validações dos secrets ANTES de gravar qualquer coisa.
    //
    // O UNSUBSCRIBE_SECRET é OBRIGATÓRIO: sem ele, buildUnsubscribeUrl() no
    // worker devolve null e o email sai SEM o header List-Unsubscribe e SEM o
    // link no rodapé — o que viola a exigência de one-click do Gmail/Yahoo para
    // quem envia em volume, e derruba a reputação do domínio. Não pode ser
    // possível salvar uma configuração de envio sem ele.
    //
    // Regra: exigir que exista um valor — vindo no body OU já armazenado
    // (Vault/env). Quem já tem um configurado não precisa reenviá-lo para
    // ajustar só o remetente.
    const unsubscribeSecret = typeof body.unsubscribe_secret === 'string' ? body.unsubscribe_secret : undefined
    if (unsubscribeSecret !== undefined && unsubscribeSecret.length < 32) {
      return error('O segredo de descadastro deve ter pelo menos 32 caracteres', 400)
    }
    if (unsubscribeSecret === undefined) {
      const existingUnsub = await getIntegrationSecret(sb, 'UNSUBSCRIBE_SECRET')
      if (!existingUnsub) {
        return error(
          'O segredo de descadastro é obrigatório. Sem ele os emails saem sem link de descadastro e sem o header List-Unsubscribe, violando a exigência do Gmail/Yahoo.',
          400,
        )
      }
    }
    const webhookSecret = typeof body.webhook_secret === 'string' ? body.webhook_secret : undefined
    if (webhookSecret !== undefined && !webhookSecret.startsWith('whsec_')) {
      return error('webhook_secret deve começar com "whsec_" (signing secret do Resend)', 400)
    }

    // 5. Grava no Vault -- só os que vieram no body.
    if (providedKey) {
      const okSet = await setStoredSecret(sb, 'RESEND_API_KEY', providedKey)
      if (!okSet) return error('Falha ao gravar RESEND_API_KEY no Vault', 500)
    }
    if (unsubscribeSecret !== undefined) {
      const okSet = await setStoredSecret(sb, 'UNSUBSCRIBE_SECRET', unsubscribeSecret)
      if (!okSet) return error('Falha ao gravar UNSUBSCRIBE_SECRET no Vault', 500)
    }
    if (webhookSecret !== undefined) {
      const okSet = await setStoredSecret(sb, 'RESEND_WEBHOOK_SECRET', webhookSecret)
      if (!okSet) return error('Falha ao gravar RESEND_WEBHOOK_SECRET no Vault', 500)
    }

    // 6. Remetente não é segredo -- vai para dashboard_settings.
    const { error: upsertErr } = await sb
      .from('dashboard_settings')
      .upsert(
        { setting_key: 'resend_from', setting_value: { from, name: fromName, prefix: fromPrefix, domain: fromDomain } },
        { onConflict: 'setting_key' },
      )
    if (upsertErr) {
      console.error('resend-config dashboard_settings upsert error:', upsertErr)
      return error('Falha ao gravar o remetente em dashboard_settings', 500)
    }

    return ok({ success: true, from, warning: domainWarning })
  }

  // -------------------------------------------------------------------------
  // POST { action: 'enable_tracking', domain_id, tracking_subdomain?, open_tracking?, click_tracking? }
  //
  // Resend vem com open/click tracking DESLIGADO por padrão, por domínio --
  // é por isso que o webhook recebe email.sent/email.delivered mas nunca
  // email.opened/email.clicked: o Resend simplesmente não injeta o pixel/
  // redirect se o domínio não tiver isso ligado. PATCH /domains/:id liga os
  // dois; a chave usada precisa ser full access (sending_only recebe 401
  // restricted_api_key do Resend, exatamente como em testResendKey).
  //
  // Ativar o tracking exige um CNAME novo no DNS do domínio (o subdomínio de
  // tracking, ex. links.dominio.com -> linksN.resend-dns.com). Não dá para
  // automatizar essa parte (não temos acesso ao DNS do usuário) -- devolvemos
  // os registros para a UI mostrar, e quem aplica é o usuário.
  // -------------------------------------------------------------------------
  if (body.action === 'enable_tracking') {
    const domainId = typeof body.domain_id === 'string' ? body.domain_id.trim() : ''
    if (!domainId) return error('domain_id é obrigatório', 400)

    const trackingSubdomain = typeof body.tracking_subdomain === 'string' && body.tracking_subdomain.trim()
      ? body.tracking_subdomain.trim()
      : 'links'
    const openTracking = body.open_tracking !== false // default true
    const clickTracking = body.click_tracking !== false // default true

    const apiKey = await getIntegrationSecret(sb, 'RESEND_API_KEY')
    if (!apiKey) return error('RESEND_API_KEY não configurada -- salve a API key antes de ativar o tracking.', 400)

    let patchRes: Response
    try {
      patchRes = await fetch(`${RESEND_DOMAINS_URL}/${domainId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          open_tracking: openTracking,
          click_tracking: clickTracking,
          tracking_subdomain: trackingSubdomain,
        }),
      })
    } catch (err) {
      console.error('resend-config enable_tracking PATCH network error:', err)
      return error('Não foi possível conectar à API do Resend para ativar o tracking.', 502)
    }

    if (patchRes.status === 401) {
      // Mesma checagem de testResendKey: 401 com restricted_api_key é a chave
      // sending-only tentando fazer algo que só uma chave full access pode.
      let body401: any = null
      try {
        body401 = await patchRes.json()
      } catch (err) {
        console.error('resend-config enable_tracking: falha ao parsear corpo do 401', err)
      }
      if (body401?.name === 'restricted_api_key' || JSON.stringify(body401 ?? {}).includes('restricted_api_key')) {
        return error(
          'A API key configurada é do tipo "somente envio" e o Resend não permite alterar domínios com ela. Gere uma chave de acesso completo em resend.com/api-keys, salve-a neste card e tente novamente.',
          403,
        )
      }
      return error('API key rejeitada pelo Resend ao tentar ativar o tracking.', 401)
    }

    if (!patchRes.ok) {
      let errBody: any = null
      try {
        errBody = await patchRes.json()
      } catch (err) {
        console.error('resend-config enable_tracking: falha ao parsear erro do PATCH', err)
      }
      console.error('resend-config enable_tracking PATCH falhou:', patchRes.status, errBody)
      return error(errBody?.message || `Resend recusou a alteração do domínio (status ${patchRes.status}).`, 400)
    }

    // PATCH ok -- confirma pelo GET /domains/:id (fonte da verdade) e devolve
    // os registros DNS de tracking que o usuário precisa adicionar agora.
    const info = await fetchDomainInfo(apiKey, domainId)
    if (!info.ok) {
      console.error('resend-config enable_tracking: confirmação falhou:', info.reason)
      return error('O tracking foi ativado, mas não foi possível confirmar o estado atual. Recarregue a página.', 502)
    }

    return ok({
      success: true,
      open_tracking: info.open_tracking,
      click_tracking: info.click_tracking,
      tracking_subdomain: info.tracking_subdomain ?? trackingSubdomain,
      status: info.status,
      records: info.records,
    })
  }

  // -------------------------------------------------------------------------
  // POST { action: 'domain_info', domain_id } -- só LÊ (permissão 'read').
  //
  // Estado REAL do tracking do domínio, direto do GET /domains/:id. Existe
  // porque a LISTAGEM não garante trazer open_tracking/click_tracking: sem
  // esta consulta o card só saberia "desconhecido" e não teria como avisar o
  // caso mais traiçoeiro -- o usuário ativa o tracking, esquece de adicionar
  // o CNAME no DNS, e nada nunca funciona sem nenhum sinal de erro.
  // -------------------------------------------------------------------------
  if (body.action === 'domain_info') {
    const domainId = typeof body.domain_id === 'string' ? body.domain_id.trim() : ''
    if (!domainId) return error('domain_id é obrigatório', 400)

    const apiKey = await getIntegrationSecret(sb, 'RESEND_API_KEY')
    if (!apiKey) return error('RESEND_API_KEY não configurada.', 400)

    const info = await fetchDomainInfo(apiKey, domainId)

    if (!info.ok) {
      // Chave sending-only não é erro: é um estado que a UI mostra como
      // "não dá para consultar por aqui". Devolve 200 com available:false
      // para o card não tratar como falha.
      if (info.reason === 'restricted_api_key') {
        return ok({ available: false, reason: 'restricted_api_key' })
      }
      if (info.reason === 'not_found') {
        return ok({ available: false, reason: 'not_found' })
      }
      return ok({ available: false, reason: info.reason })
    }

    return ok({
      available: true,
      open_tracking: info.open_tracking,
      click_tracking: info.click_tracking,
      tracking_subdomain: info.tracking_subdomain,
      status: info.status,
      records: info.records,
    })
  }

  return error('action inválida: use "test", "save", "enable_tracking" ou "domain_info"')
})
