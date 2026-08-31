import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getIntegrationSecret } from '../_shared/secrets.ts'

// Webhook publico chamado pelo Resend (via Svix) a cada evento de email
// (sent/delivered/opened/clicked/bounced/complained/failed). Autenticacao por
// assinatura Svix, nao por API key -- por isso este arquivo NAO usa
// ../_shared/auth.ts. Ver supabase/migrations/20260713190000_email_tracking.sql
// para o schema de email_events / email_suppressions / campaign_sends.

const STATUS_RANK: Record<string, number> = {
  pending: 0, sent: 1, delivered: 2, opened: 3, clicked: 4,
}
// 'suppressed' incluído: um envio pulado por supressão (email_suppressions) é
// terminal como os demais -- um evento tardio do Resend (impossível na prática,
// já que este send nunca chegou a ser despachado, mas defesa em profundidade)
// nunca deve sobrescrever o status.
const TERMINAL = new Set(['bounced', 'complained', 'failed', 'unsubscribed', 'suppressed'])
const EVENT_TO_STATUS: Record<string, string> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.opened': 'opened',
  'email.clicked': 'clicked',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.failed': 'failed',
}

// Comparacao byte a byte em tempo constante para nao vazar, via timing,
// quantos caracteres da assinatura estao corretos.
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const ab = enc.encode(a)
  const bb = enc.encode(b)
  if (ab.length !== bb.length) return false
  let diff = 0
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i]
  return diff === 0
}

// Verificacao de assinatura Svix: HMAC-SHA256 sobre "${svix-id}.${svix-timestamp}.${body}"
// com a chave = base64-decode do RESEND_WEBHOOK_SECRET sem o prefixo "whsec_".
// O header svix-signature traz uma ou mais assinaturas "v1,<base64>" separadas por
// espaco (rotacao de secret) -- aceitar se QUALQUER uma casar. Janela anti-replay: 5 min.
// secret agora chega JA RESOLVIDO (Vault->env via getIntegrationSecret, que
// NUNCA lanca -- se o RPC falhar cai no Deno.env.get). Isto e obrigatorio:
// se a leitura do segredo falhasse sem fallback, a verificacao de assinatura
// falharia e TODOS os eventos do Resend seriam rejeitados em silencio (401).
async function verifySvix(req: Request, body: string, secret: string): Promise<boolean> {
  const id = req.headers.get('svix-id') ?? ''
  const ts = req.headers.get('svix-timestamp') ?? ''
  const sigHeader = req.headers.get('svix-signature') ?? ''
  if (!secret || !id || !ts || !sigHeader) return false
  if (!Number.isFinite(Number(ts)) || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false
  try {
    const raw = Uint8Array.from(atob(secret.replace(/^whsec_/, '')), (c) => c.charCodeAt(0))
    const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${body}`))
    const expected = btoa(String.fromCharCode(...new Uint8Array(mac)))
    return sigHeader.split(' ').some((part) => {
      const sig = part.split(',')[1]
      return typeof sig === 'string' && sig.length > 0 && timingSafeEqual(sig, expected)
    })
  } catch {
    return false
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  // sb criado cedo (antes so existia depois do parse do corpo) para poder
  // resolver o RESEND_WEBHOOK_SECRET via Vault antes de verificar a
  // assinatura. getIntegrationSecret nunca lanca -- erro de RPC cai no
  // Deno.env.get, exatamente como o `?? ''` fazia antes.
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const webhookSecret = (await getIntegrationSecret(sb, 'RESEND_WEBHOOK_SECRET')) ?? ''

  const body = await req.text()
  if (!(await verifySvix(req, body, webhookSecret))) return new Response('Invalid signature', { status: 401 })

  const svixId = req.headers.get('svix-id')!
  let evt: any
  try {
    evt = JSON.parse(body)
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const tags = Object.fromEntries(
    (Array.isArray(evt.data?.tags) ? evt.data.tags : []).map((t: any) => [t.name, t.value])
  )

  // 1. Dedupe: Resend/Svix entrega at-least-once, sem garantia de ordem.
  //    svix_id UNIQUE em email_events e a barreira de idempotencia.
  //
  //    DEGRADACAO DE VINCULOS EM EVENTO TARDIO (FK 23503):
  //    campaign_id e lead_id vem das tags do proprio Resend (ids capturados no
  //    momento do ENVIO) e AMBOS sao FK em email_events -- campaign_id -> campaigns
  //    e lead_id -> leads, os dois ON DELETE SET NULL (migration 20260713190000).
  //    SET NULL so protege linhas que JA existiam no instante do DELETE. Um evento
  //    que chega DEPOIS do registro ter sido excluido ainda tenta INSERIR um id que
  //    nao existe mais -- e isso viola a FK (codigo 23503), nao 23505. Sem tratar,
  //    a function devolve 500 e o Svix reentrega o MESMO evento por ate 10h
  //    (5s, 5min, 30min, 2h, 5h, 10h) sem nunca conseguir: o registro excluido
  //    nao volta.
  //
  //    Duas portas para o mesmo loop, e as duas precisam estar fechadas:
  //      - campanha excluida (admin exclui pela lista de Campanhas) -> 23503 no campaign_id;
  //      - contato excluido (delete-contact, ou o lead descartado num merge em
  //        ContactsBulkBar/BulkActionsBar) -> 23503 no lead_id.
  //    Tratar so o campaign_id deixaria o segundo caso entrando em loop pela outra
  //    porta: a reinsercao zeraria o campaign_id e AINDA violaria a FK do lead.
  //
  //    Escada de 3 degraus, cada um removendo o vinculo que pode nao existir mais.
  //    O evento em si nunca e descartado: o payload bruto guarda tudo (inclusive as
  //    tags originais com os ids), so os vinculos relacionais sao perdidos -- que e
  //    exatamente o que o ON DELETE SET NULL teria feito se o evento tivesse chegado
  //    antes da exclusao. Qualquer erro que NAO seja 23503 sai da escada na hora e
  //    cai no tratamento de sempre, abaixo (23505 -> 200 duplicate; resto -> 500).
  const baseRow = {
    svix_id: svixId,
    event_type: evt.type ?? 'unknown',
    resend_email_id: evt.data?.email_id ?? null,
    payload: evt,
    occurred_at: evt.created_at ?? new Date().toISOString(),
  }
  // Cada degrau precisa remover ALGO em relacao ao anterior -- um degrau que
  // reinsere exatamente a mesma linha so repetiria o mesmo 23503 (ruido no log e
  // uma ida ao banco a toa). Por isso os degraus de degradacao so entram na escada
  // se o vinculo que eles zeram estava de fato presente nas tags: com apenas
  // lead_id tagueado (email de fluxo, sem campanha), a escada vira 1) completo ->
  // 2) sem lead, sem passar por um "sem campanha" que ja era nulo.
  const attempts: { campaign_id: string | null; lead_id: string | null; note: string }[] = [
    // 1) vinculos completos, como vieram nas tags
    { campaign_id: tags.campaign_id ?? null, lead_id: tags.lead_id ?? null, note: '' },
  ]
  if (tags.campaign_id) {
    // 2) sem campanha (campanha excluida) -- so se havia campanha para remover
    attempts.push({
      campaign_id: null,
      lead_id: tags.lead_id ?? null,
      note: 'campaign_id da tag nao existe mais (campanha excluida); reinserindo com campaign_id=null',
    })
  }
  if (tags.lead_id) {
    // 3) sem campanha e sem lead (contato excluido) -- so se havia lead para remover
    attempts.push({
      campaign_id: null,
      lead_id: null,
      note: 'lead_id da tag nao existe mais (contato excluido); reinserindo com campaign_id=null e lead_id=null',
    })
  }

  // Só o `code` interessa aqui (23503 = FK, 23505 = duplicata); tipar estruturalmente
  // em vez de `any` mantém o lint limpo e o PostgrestError encaixa por estrutura.
  let insErr: { code?: string; message?: string } | null = null
  for (const attempt of attempts) {
    if (attempt.note) console.error(`resend-webhook: ${attempt.note}:`, insErr)

    insErr = (await sb.from('email_events').insert({
      ...baseRow,
      campaign_id: attempt.campaign_id,
      lead_id: attempt.lead_id,
    })).error

    // Sucesso, ou um erro que a escada nao resolve (23505 duplicate, ou qualquer
    // outra falha real de banco): para aqui e deixa o tratamento abaixo decidir.
    if (!insErr || insErr.code !== '23503') break
  }
  if (insErr) {
    if (insErr.code === '23505') return new Response('ok (duplicate)', { status: 200 })
    console.error('resend-webhook insert error:', insErr)
    return new Response('db error', { status: 500 })
  }

  // 2. Resolver o send. ORDEM IMPORTA:
  //    a) tags.send_id  -- EXATO (Fase 6: vai em todo email, campanha e fluxo);
  //    b) tags campaign_id+lead_id -- compatibilidade com emails em voo enviados
  //       antes deste deploy (e só existe para campanha);
  //    c) resend_email_id -- último fallback.
  //    Emails de FLUXO só têm o caminho (a) e o (c): não há campaign_id para casar.
  let send: { id: string; status: string } | null = null
  if (tags.send_id) {
    const { data } = await sb.from('campaign_sends').select('id,status')
      .eq('id', tags.send_id).maybeSingle()
    send = data
  }
  if (!send && tags.campaign_id && tags.lead_id) {
    const { data } = await sb.from('campaign_sends').select('id,status')
      .eq('campaign_id', tags.campaign_id).eq('lead_id', tags.lead_id)
      // nullsFirst:false: linhas 'pending' (Fase 3) tem sent_at NULL e viriam
      // primeiro num ORDER BY DESC padrao do Postgres.
      .order('sent_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle()
    send = data
  }
  if (!send && evt.data?.email_id) {
    const { data } = await sb.from('campaign_sends').select('id,status')
      .eq('resend_email_id', evt.data.email_id).maybeSingle()
    send = data
  }

  // 3. Avanco monotonico de status: sem garantia de ordem de entrega, entao nunca
  //    rebaixar (ex.: "opened" nao pode voltar para "delivered") e terminais
  //    (bounced/complained/failed/unsubscribed) nunca sao sobrescritos.
  //    Concorrencia: duas entregas simultaneas do webhook podem ler o mesmo status
  //    "stale" e a mais lenta rebaixaria o valor da mais rapida. Por isso o UPDATE
  //    e condicionado ao status lido (CAS otimista via .eq('status', current));
  //    se outra invocacao mudou o status no meio, re-le e reavalia (ate 3 tentativas).
  const newStatus = EVENT_TO_STATUS[evt.type]
  if (send) {
    // vincula o evento ao send para facilitar consultas futuras (independe de
    // haver ou nao avanco de status)
    await sb.from('email_events').update({ campaign_send_id: send.id }).eq('svix_id', svixId)

    if (newStatus) {
      let attempts = 0
      let current = send.status
      while (attempts < 3) {
        const advance = TERMINAL.has(newStatus)
          ? !TERMINAL.has(current)
          : (STATUS_RANK[newStatus] ?? -1) > (STATUS_RANK[current] ?? 99)
        if (!advance) break
        const patch: Record<string, unknown> = { status: newStatus }
        if (newStatus === 'opened') patch.opened_at = evt.created_at
        if (newStatus === 'clicked') patch.clicked_at = evt.created_at
        // fn_campaign_send_event (trigger em campaign_sends) propaga esta mudanca
        // de status para contact_events -- nao duplicar esse insert aqui.
        const { data: updated, error: updErr } = await sb.from('campaign_sends')
          .update(patch).eq('id', send.id).eq('status', current).select('id')
        if (updErr) {
          console.error('resend-webhook status update error:', updErr)
          break
        }
        if (updated && updated.length > 0) break // venceu o CAS
        // outra invocacao mudou o status entre o read e o update: re-ler e reavaliar
        attempts++
        const { data: fresh } = await sb.from('campaign_sends')
          .select('status').eq('id', send.id).maybeSingle()
        if (!fresh) break
        current = fresh.status
      }
    }
  }

  // 4. Supressao automatica: hard bounce (bounce.type != 'Transient') e complaint.
  //    email_suppressions.email tem trigger de normalizacao (lower+trim) no banco;
  //    normalizamos aqui tambem para o onConflict bater com o valor que sera persistido.
  const to = Array.isArray(evt.data?.to) ? evt.data.to[0] : evt.data?.to
  const isHardBounce = evt.type === 'email.bounced' && evt.data?.bounce?.type !== 'Transient'
  if (to && (isHardBounce || evt.type === 'email.complained')) {
    const { error: supErr } = await sb.from('email_suppressions').upsert({
      email: String(to).toLowerCase().trim(),
      reason: evt.type === 'email.complained' ? 'complaint' : 'bounce',
      source: 'resend-webhook',
      lead_id: tags.lead_id ?? null,
      // ignoreDuplicates intencional: a primeira razao de supressao prevalece
    }, { onConflict: 'email', ignoreDuplicates: true })
    if (supErr) console.error('resend-webhook suppression error:', supErr)
  }

  return new Response('ok', { status: 200 })
})
