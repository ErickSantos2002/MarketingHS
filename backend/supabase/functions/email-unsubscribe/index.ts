import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getIntegrationSecret } from '../_shared/secrets.ts'
import { corsHeaders, handleCors } from '../_shared/auth.ts'

// Endpoint publico de descadastro de emails (RFC 8058 one-click unsubscribe),
// chamado pelo botao "Unsubscribe" do Gmail/Yahoo/Outlook (POST direto,
// servidor-a-servidor) e pelo fetch() da pagina de confirmacao do app
// (src/pages/Descadastrar.tsx, rota /descadastrar). Autenticacao por token
// HMAC assinado nos query params -- por isso este arquivo NAO usa
// validateAuth de ../_shared/auth.ts (so reaproveita corsHeaders/handleCors,
// que nao exigem Authorization). Contrato do token (fixo -- a pagina do app
// reproduz este mesmo esquema):
//   token = base64url( HMAC-SHA256( `${lead_id}:${email_lowercase_trimmed}` , UNSUBSCRIBE_SECRET ) )
// Ver supabase/migrations/20260713190000_email_tracking.sql para o schema de
// email_suppressions/campaign_sends, e 20260330003249_*.sql para contact_events
// (coluna dnia_id e NULLABLE -- confirmado, sem NOT NULL em nenhuma migration
// posterior -- entao o evento da timeline pode ser inserido mesmo quando o
// lead nao tem dnia_id).
//
// IMPORTANTE (motivo da migracao da pagina HTML para o app): o Supabase
// reescreve respostas GET com Content-Type text/html para text/plain e injeta
// um Content-Security-Policy "default-src 'none'; sandbox" em Edge Functions.
// Isso quebra qualquer pagina servida daqui -- por isso o GET abaixo devolve
// APENAS JSON (para a pagina do app validar o token e mostrar o email antes
// de confirmar); a pagina de confirmacao em si vive em src/pages/Descadastrar.tsx.

// Comparacao byte a byte em tempo constante para nao vazar, via timing,
// quantos caracteres do token estao corretos (copiado de resend-webhook/index.ts).
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const ab = enc.encode(a)
  const bb = enc.encode(b)
  if (ab.length !== bb.length) return false
  let diff = 0
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i]
  return diff === 0
}

// Correcao C3 (achado do review final, par de process-email-queue/index.ts::b64urlEncodeString):
// o encoder passou a codificar os BYTES utf-8 do email (nao mais os code points via btoa()
// puro), para nao lancar em enderecos com caracteres fora da faixa Latin-1. atob() sozinho
// devolve uma string "binaria" (cada char = 1 byte 0-255) -- correta para ASCII, mas errada
// (mojibake) para qualquer sequencia utf-8 multi-byte. Decodificamos os bytes com
// TextDecoder para reconstituir a string original. Para email 100% ASCII (unico caso
// existente hoje em producao) o resultado e IDENTICO ao atob() antigo: cada byte utf-8
// de um caractere ASCII e o proprio code point, entao TextDecoder devolve a mesma string.
function b64urlDecode(s: string): string {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

// secret agora chega JA RESOLVIDO (Vault->env, mesma ordem de
// process-email-queue::buildUnsubscribeUrl via getIntegrationSecret) em vez
// de ler Deno.env.get aqui dentro -- essencial: e a MESMA fonte que assina o
// token no worker. Se as duas pontas lessem valores diferentes, todo
// descadastro passaria a dar 401.
async function computeToken(leadId: string, email: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${leadId}:${email}`))
  return btoa(String.fromCharCode(...new Uint8Array(mac)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const url = new URL(req.url)
  const lid = url.searchParams.get('lid') ?? ''
  const e = url.searchParams.get('e') ?? ''
  const t = url.searchParams.get('t') ?? ''
  if (!lid || !e || !t) return jsonResponse({ error: 'Bad request' }, 400)

  let email: string
  try {
    email = b64urlDecode(e).toLowerCase().trim()
  } catch {
    return jsonResponse({ error: 'Bad request' }, 400)
  }
  if (!email) return jsonResponse({ error: 'Bad request' }, 400)

  // Client criado cedo (antes era so no ramo POST) porque a resolucao do
  // secret via Vault precisa da RPC service-role. Vault->env, MESMA ordem de
  // process-email-queue::buildUnsubscribeUrl (getIntegrationSecret) -- as
  // duas pontas do HMAC tem que ler o mesmo valor.
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const unsubscribeSecret = await getIntegrationSecret(sb, 'UNSUBSCRIBE_SECRET')
  if (!unsubscribeSecret) {
    console.error('email-unsubscribe: UNSUBSCRIBE_SECRET ausente')
    return jsonResponse({ error: 'Server misconfigured' }, 500)
  }

  const expected = await computeToken(lid, email, unsubscribeSecret)
  if (!timingSafeEqual(t, expected)) return jsonResponse({ error: 'Invalid token' }, 401)

  // GET: SO valida o token e devolve o email em JSON, para a pagina do app
  // (src/pages/Descadastrar.tsx) montar a tela de confirmacao. Nenhuma
  // escrita acontece aqui -- RFC 8058 exige que o link clicavel do corpo do
  // email (para humanos, pre-carregado por muitos clientes de email) nunca
  // tenha efeito colateral; so o POST (botao "Unsubscribe" do provedor, ou o
  // botao "Confirmar descadastro" da pagina do app) descadastra de fato.
  if (req.method === 'GET') {
    return jsonResponse({ ok: true, email }, 200)
  }

  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  // sb ja foi criado acima para resolver o UNSUBSCRIBE_SECRET.

  // 1. Supressao (idempotente; trigger do DB normaliza o email). Isso e o unico
  //    efeito que precisa necessariamente ter sucesso -- se falhar, respondemos
  //    500 para que o provedor (Gmail/Yahoo) re-tente o POST one-click.
  const { error: supErr } = await sb.from('email_suppressions').upsert(
    { email, reason: 'unsubscribe', source: 'email-unsubscribe', lead_id: lid },
    { onConflict: 'email', ignoreDuplicates: true },
  )
  if (supErr) {
    console.error('email-unsubscribe suppression error:', supErr)
    return jsonResponse({ error: 'db error' }, 500)
  }

  // 2. Marca o ultimo envio de email do lead como unsubscribed (best-effort;
  //    nunca falha o fluxo -- a supressao acima ja e a fonte da verdade para
  //    impedir futuros envios).
  try {
    const { data: lastSend } = await sb.from('campaign_sends').select('id,status')
      .eq('lead_id', lid).eq('channel', 'email')
      .neq('status', 'pending')
      // nullsFirst:false e obrigatorio: a partir da Fase 3 existem linhas 'pending'
      // com sent_at NULL, e em Postgres NULLS vem PRIMEIRO num ORDER BY DESC --
      // sem isso o descadastro marcaria uma campanha ainda na fila.
      .order('sent_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle()
    // 'suppressed' incluído: um envio pulado por supressão nunca chegou a sair --
    // sobrescrevê-lo para 'unsubscribed' apagaria o motivo real (bounce/complaint/
    // supressão anterior) por um rótulo que implica falsamente que o email foi
    // enviado antes do descadastro.
    const TERMINAL = new Set(['bounced', 'complained', 'failed', 'unsubscribed', 'suppressed'])
    if (lastSend && !TERMINAL.has(lastSend.status)) {
      const { error: updErr } = await sb.from('campaign_sends')
        .update({ status: 'unsubscribed' }).eq('id', lastSend.id).eq('status', lastSend.status)
      if (updErr) console.error('email-unsubscribe campaign_sends update error:', updErr)
    }
  } catch (err) {
    console.error('email-unsubscribe campaign_sends best-effort step failed:', err)
  }

  // 3. Evento na timeline (best-effort; erro aqui so loga, nunca falha a resposta).
  //    contact_events.dnia_id e NULLABLE (Passo 0 confirmou: nenhuma migration
  //    adiciona NOT NULL), entao o insert acontece mesmo se o lead nao tiver
  //    dnia_id -- nesse caso a coluna simplesmente fica null.
  try {
    const { data: lead } = await sb.from('leads').select('dnia_id').eq('id', lid).maybeSingle()
    const { error: evtErr } = await sb.from('contact_events').insert({
      dnia_id: lead?.dnia_id ?? null,
      lead_id: lid,
      source_app: 'dnmarketing',
      event_type: 'email_unsubscribed',
      title: 'Descadastrou-se de emails',
      metadata: { email },
      occurred_at: new Date().toISOString(),
    })
    if (evtErr) console.error('email-unsubscribe contact_events insert error:', evtErr)
  } catch (err) {
    console.error('email-unsubscribe contact_events best-effort step failed:', err)
  }

  return jsonResponse({ ok: true, email }, 200)
})
