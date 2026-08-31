// ============================================================================
// Coletor de eventos do Teste A/B (v1). Recebe os eventos de NAVEGADOR do funil
// A/B disparados pelo script leve (ab.js) nas landing pages e pelo Nexus.
//
// Exposto (via Cloudflare Worker) em dnmkt.dnia.ai/api/ab/events. CORS liberado
// para *.dnia.ai. Público (verify_jwt=false): é chamado de páginas anônimas.
// Fire-and-forget: responde 202 na hora e grava em background (waitUntil) — o
// tracking NUNCA pode atrasar nem travar a página (RF-16/31).
//
// Idempotência (RF-18): exposições/conversões/schedule_steps têm dedupe_key
// único; reenvios são absorvidos (violação 23505 é tratada como sucesso).
// Bots que executam JS são raros; ainda assim descartamos user-agents de bots
// conhecidos para manter a exposição limpa (RF-19). Rate-limit "de verdade"
// deve ser feito na camada do Cloudflare (Rate Limiting Rules) — ver README.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const VALID_TYPES = new Set(['assignment', 'exposure', 'behavior', 'schedule_step', 'conversion']);
const MAX_EVENTS_PER_REQUEST = 50;
const BOT_UA = /bot|crawler|spider|crawling|slurp|bingpreview|facebookexternalhit|whatsapp|telegrambot|preview|headless|lighthouse|pingdom|gtmetrix|monitor/i;

const DNIA_ORIGIN = /^https?:\/\/([a-z0-9-]+\.)*dnia\.ai$/i;

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  const allow = DNIA_ORIGIN.test(origin) ? origin : '*';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    Vary: 'Origin',
  };
}

// Trunca strings p/ evitar payloads abusivos.
function s(v: unknown, max = 2000): string | null {
  if (v == null) return null;
  const str = String(v);
  return str.length > max ? str.slice(0, max) : str;
}

// UA parsing leve (fallback quando o cliente não manda device/browser/os).
function parseUA(ua: string) {
  const t = ua || '';
  let device_type = 'desktop';
  if (/\bMobile\b|Android.+Mobile|iPhone|iPod|Windows Phone/i.test(t)) device_type = 'mobile';
  else if (/\biPad\b|Tablet|Android(?!.*Mobile)/i.test(t)) device_type = 'tablet';
  let os = 'unknown';
  if (/Windows NT/i.test(t)) os = 'Windows';
  else if (/iPhone|iPad|iPod/i.test(t)) os = 'iOS';
  else if (/Mac OS X/i.test(t)) os = 'macOS';
  else if (/Android/i.test(t)) os = 'Android';
  else if (/Linux/i.test(t)) os = 'Linux';
  let browser = 'unknown';
  if (/Edg\//i.test(t)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(t)) browser = 'Opera';
  else if (/Chrome\//i.test(t)) browser = 'Chrome';
  else if (/Firefox\//i.test(t)) browser = 'Firefox';
  else if (/Safari\//i.test(t)) browser = 'Safari';
  return { device_type, os, browser };
}

// Chave de idempotência. null => permite múltiplos (behavior, assignment).
function dedupeKey(e: Record<string, unknown>): string | null {
  const vid = e.ab_vid;
  const test = e.ab_test;
  const type = e.event_type;
  const name = e.event_name;
  const step = (e.metadata as Record<string, unknown> | undefined)?.step;
  if (type === 'exposure') return `${vid}:${test}:exposure`;
  if (type === 'conversion') return `${vid}:${test}:conversion:${name || 'default'}`;
  if (type === 'schedule_step') return `${vid}:${test}:schedule_step:${name || step || ''}`;
  return null;
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  // Descarta bots conhecidos (respondendo 200 para não gerar retry).
  const ua = req.headers.get('user-agent') || '';
  if (BOT_UA.test(ua)) {
    return new Response(JSON.stringify({ accepted: 0, skipped: 'bot' }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  // Aceita: um evento único, um array, ou { events: [...] }.
  let rawEvents: unknown[];
  if (Array.isArray(body)) rawEvents = body;
  else if (body && typeof body === 'object' && Array.isArray((body as { events?: unknown[] }).events)) {
    rawEvents = (body as { events: unknown[] }).events;
  } else if (body && typeof body === 'object') rawEvents = [body];
  else rawEvents = [];

  if (rawEvents.length > MAX_EVENTS_PER_REQUEST) rawEvents = rawEvents.slice(0, MAX_EVENTS_PER_REQUEST);

  const uaParsed = parseUA(ua);
  const referer = req.headers.get('referer');
  const langHeader = (req.headers.get('accept-language') || '').split(',')[0] || null;

  // Valida e normaliza cada evento. Inválidos são descartados silenciosamente
  // (fire-and-forget: nunca falhamos o request por causa de um evento ruim).
  const rows: Record<string, unknown>[] = [];
  for (const raw of rawEvents) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>;
    const ab_test = s(e.ab_test, 200);
    const ab_vid = s(e.ab_vid, 200);
    const event_type = s(e.event_type, 40);
    if (!ab_test || !ab_vid || !event_type || !VALID_TYPES.has(event_type)) continue;

    rows.push({
      ab_test,
      ab_var: s(e.ab_var, 40),
      ab_vid,
      event_type,
      event_name: s(e.event_name, 200),
      occurred_at: s(e.occurred_at, 40) || new Date().toISOString(),
      page_slug: s(e.page_slug, 400),
      url: s(e.url, 2000),
      referrer: s(e.referrer, 2000) || referer,
      lead_id: s(e.lead_id, 100),
      dnia_id: s(e.dnia_id, 100),
      utm_source: s(e.utm_source, 400),
      utm_medium: s(e.utm_medium, 400),
      utm_campaign: s(e.utm_campaign, 400),
      utm_term: s(e.utm_term, 400),
      utm_content: s(e.utm_content, 400),
      gclid: s(e.gclid, 400),
      fbclid: s(e.fbclid, 400),
      ttclid: s(e.ttclid, 400),
      msclkid: s(e.msclkid, 400),
      raw_query: s(e.raw_query, 4000),
      device_type: s(e.device_type, 40) || uaParsed.device_type,
      browser: s(e.browser, 80) || uaParsed.browser,
      browser_version: s(e.browser_version, 40),
      os: s(e.os, 80) || uaParsed.os,
      language: s(e.language, 40) || langHeader,
      screen_resolution: s(e.screen_resolution, 40),
      metadata: e.metadata && typeof e.metadata === 'object' ? e.metadata : null,
      dedupe_key: dedupeKey(e),
    });
  }

  const accepted = rows.length;

  // Gravação em BACKGROUND — resposta volta na hora (fire-and-forget).
  const work = (async () => {
    if (rows.length === 0) return;
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    // Insere linha a linha para tolerar duplicatas (idempotência): a violação
    // do índice único parcial em dedupe_key (23505) é absorvida como sucesso.
    for (const row of rows) {
      const { error } = await sb.from('ab_events').insert(row);
      if (error && error.code !== '23505') {
        console.error('[ab-events] insert error:', error.message, row.event_type);
      }
    }
  })();

  const edgeRuntime = (globalThis as unknown as {
    EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void };
  }).EdgeRuntime;
  if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(work);
  else await work;

  return new Response(JSON.stringify({ accepted }), {
    status: 202,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
});
