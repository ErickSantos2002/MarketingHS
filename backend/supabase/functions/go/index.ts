// ============================================================================
// Redirecionador do Teste A/B (v1 Split-URL). O CORAÇÃO do v1.
//
// Fluxo: clique no Link de Distribuição dnmkt.dnia.ai/go/{public_slug}
//   -> (Cloudflare Worker faz proxy p/ esta function, preservando host, cookies
//      e query — ver docs/ab-testing/cloudflare-worker.js)
//   -> lê cookie sticky .dnia.ai  ->  já tem variante? usa a mesma
//                                     não tem? sorteia por peso
//   -> loga `assignment` (dono canônico da origem: UTMs + click ids + query bruta)
//   -> 302 p/ a URL de destino com ?ab_test&ab_var&ab_vid (UTMs preservadas)
//
// Por que responde por dnmkt.dnia.ai (via Worker) e não pela URL crua do
// supabase.co: só assim o Set-Cookie Domain=.dnia.ai é aceito/reenviado pelo
// navegador (same-site), garantindo stickiness real e imune às mitigações de
// bounce-tracking de Safari/Chrome. A URL crua *.supabase.co é SÓ p/ QA interno.
//
// Público (verify_jwt=false em config.toml): é uma navegação top-level, sem auth.
// Nunca deixa o visitante numa página de erro: qualquer falha cai no fallback.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const COOKIE_DOMAIN = '.dnia.ai';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 90; // 90 dias
const FALLBACK_URL = Deno.env.get('AB_FALLBACK_URL') || 'https://dnia.ai';

// Parâmetros que NÃO devem ser repassados ao destino (uso interno do redirecionador).
const INTERNAL_PARAMS = new Set(['t']);
const CLICK_ID_KEYS = ['gclid', 'fbclid', 'ttclid', 'msclkid'];

// Normaliza um domínio p/ comparação: sem protocolo, www., path/porta, minúsculo.
// (Espelha src/lib/abConfig.ts — Edge Functions não importam de src/.)
function normalizeDomain(input: string): string {
  return (input || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/:?#].*$/, '')
    .replace(/\.+$/, '');
}

// `host` é o próprio `domain` ou um subdomínio dele?
function hostInDomain(host: string, domain: string): boolean {
  const h = (host || '').toLowerCase();
  const d = normalizeDomain(domain);
  if (!d || !h) return false;
  return h === d || h.endsWith('.' + d);
}

interface Variant {
  key: string;
  url: string;
  weight?: number;
  label?: string;
}

// Linha de ab_tests como o redirecionador precisa dela. `slug` é a chave
// interna (única, imutável); `public_slug` é a da URL, reutilizável.
interface AbTestRow {
  slug: string;
  public_slug: string;
  status: string;
  variants: unknown;
  control_variant: string | null;
  winner_variant: string | null;
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function cookieString(name: string, value: string): string {
  return `${name}=${encodeURIComponent(value)}; Domain=${COOKIE_DOMAIN}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax; Secure`;
}

// Sorteio por peso. Pesos ausentes/invalidos => 1. Retorna a variante escolhida.
function pickWeighted(variants: Variant[]): Variant {
  const weights = variants.map((v) => (typeof v.weight === 'number' && v.weight > 0 ? v.weight : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < variants.length; i++) {
    r -= weights[i];
    if (r < 0) return variants[i];
  }
  return variants[variants.length - 1];
}

// UA parsing leve, server-side. Resolução de tela chega depois via ab-events.
function parseUserAgent(ua: string) {
  const s = ua || '';
  let device_type = 'desktop';
  if (/\bMobile\b|Android.+Mobile|iPhone|iPod|Windows Phone/i.test(s)) device_type = 'mobile';
  else if (/\biPad\b|Tablet|Android(?!.*Mobile)/i.test(s)) device_type = 'tablet';

  let os = 'unknown';
  if (/Windows NT/i.test(s)) os = 'Windows';
  else if (/iPhone|iPad|iPod/i.test(s)) os = 'iOS';
  else if (/Mac OS X/i.test(s)) os = 'macOS';
  else if (/Android/i.test(s)) os = 'Android';
  else if (/Linux/i.test(s)) os = 'Linux';

  let browser = 'unknown';
  let browser_version = '';
  const m = (re: RegExp) => {
    const r = s.match(re);
    return r ? r[1] : '';
  };
  if (/Edg\//i.test(s)) { browser = 'Edge'; browser_version = m(/Edg\/([\d.]+)/i); }
  else if (/OPR\/|Opera/i.test(s)) { browser = 'Opera'; browser_version = m(/(?:OPR|Opera)\/([\d.]+)/i); }
  else if (/Chrome\//i.test(s)) { browser = 'Chrome'; browser_version = m(/Chrome\/([\d.]+)/i); }
  else if (/Firefox\//i.test(s)) { browser = 'Firefox'; browser_version = m(/Firefox\/([\d.]+)/i); }
  else if (/Safari\//i.test(s)) { browser = 'Safari'; browser_version = m(/Version\/([\d.]+)/i); }

  return { device_type, os, browser, browser_version };
}

// Extrai o slug PÚBLICO (o da URL, reutilizável entre testes): do path
// (/go/{public_slug}) ou da query (?t={public_slug}).
function extractSlug(url: URL): string | null {
  const q = url.searchParams.get('t');
  if (q) return q.trim();
  const segments = url.pathname.split('/').filter(Boolean);
  const goIdx = segments.lastIndexOf('go');
  if (goIdx !== -1 && segments[goIdx + 1]) return decodeURIComponent(segments[goIdx + 1]);
  // fallback: último segmento se não for 'go'
  const last = segments[segments.length - 1];
  return last && last !== 'go' ? decodeURIComponent(last) : null;
}

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({
    Location: location,
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'X-Robots-Tag': 'noindex, nofollow',
    'Referrer-Policy': 'no-referrer-when-downgrade',
  });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  try {
    const url = new URL(req.url);
    const publicSlug = extractSlug(url);
    if (!publicSlug) return redirect(FALLBACK_URL);

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Busca os testes da slug e a config de domínio EM PARALELO (sem latência
    // serial extra). A mesma public_slug pode ter vários testes ao longo do
    // tempo (só um `running` por vez), por isso lista em vez de maybeSingle().
    const [{ data: rows }, { data: cfg }] = await Promise.all([
      sb.from('ab_tests')
        .select('slug, public_slug, status, variants, control_variant, winner_variant')
        .eq('public_slug', publicSlug)
        .order('updated_at', { ascending: false })
        .limit(20),
      sb.from('ab_config').select('production_domain').limit(1).maybeSingle(),
    ]);

    // Resolução do teste que responde por esta slug:
    //  1. o que está `running` (no máximo um — garantido por índice único parcial);
    //  2. sem running, o mais recente que JÁ RODOU: serve a vencedora (ou o
    //     controle) a 100%, para o link do anúncio nunca quebrar entre testes;
    //  3. por último, um rascunho (comportamento de sempre: 100% controle).
    const candidates = (rows || []) as AbTestRow[];
    const test =
      candidates.find((t) => t.status === 'running') ??
      candidates.find((t) => t.status === 'completed' || t.status === 'paused' || t.status === 'archived') ??
      candidates[0];

    // Slug inexistente -> fallback seguro (nunca página de erro).
    if (!test) return redirect(FALLBACK_URL);

    // Chave INTERNA do teste: é ela que circula em cookies, params ab_test,
    // assignments, eventos e relatórios. Nunca se repete entre testes, então
    // reusar a public_slug não contamina stickiness nem dedupe.
    const slug = test.slug;

    const variants: Variant[] = Array.isArray(test.variants) ? test.variants : [];
    if (variants.length === 0) return redirect(FALLBACK_URL);

    const controlVariant =
      variants.find((v) => v.key === test.control_variant) || variants[0];

    const cookies = parseCookies(req.headers.get('cookie'));

    // Visitor id compartilhado entre testes (ajuda a costura de identidade).
    let vid = cookies['ab_vid'];
    const vidIsNew = !vid;
    if (!vid) vid = `v_${crypto.randomUUID().replace(/-/g, '')}`;

    // Decisão da variante:
    //  - running  -> sticky (cookie do teste) ou sorteio por peso
    //  - qualquer outro status -> 100% numa variante só (ignora sticky): a
    //    vencedora, se o teste foi concluído com uma escolhida; senão o
    //    controle (é o kill switch de `paused` e o padrão de `draft`).
    let chosen: Variant | undefined;
    let sticky = false;
    if (test.status === 'running') {
      const perTest = cookies[`ab_${slug}`]; // formato: "{var}|{vid}"
      if (perTest) {
        const varKey = perTest.split('|')[0];
        chosen = variants.find((v) => v.key === varKey);
        if (chosen) sticky = true;
      }
      if (!chosen) chosen = pickWeighted(variants);
    } else {
      chosen = variants.find((v) => v.key === test.winner_variant) || controlVariant;
    }
    if (!chosen) chosen = controlVariant;

    // Monta a URL de destino: preserva a query do clique + adiciona ab_*.
    let dest: URL;
    try {
      dest = new URL(chosen.url);
    } catch {
      return redirect(FALLBACK_URL);
    }

    // Guardrail server-side (defesa em profundidade — a validação primária é no
    // cadastro do teste): se o destino não estiver no domínio de produção
    // configurado, NÃO manda o clique do anúncio p/ fora do domínio — cai no
    // fallback. Evita cross-domain redirect (reprovação "Destination mismatch"
    // no Google/Meta) mesmo se uma variante ruim escapar para o banco.
    // Fail-open: sem config legível (ab_config vazia/erro), segue normalmente.
    const prodDomain = normalizeDomain(cfg?.production_domain || '');
    if (prodDomain && !hostInDomain(dest.hostname, prodDomain)) {
      console.warn(
        `[go] destino fora do dominio de producao: ${dest.hostname} nao pertence a ${prodDomain} ` +
        `(test=${slug}, var=${chosen.key}) -> fallback`,
      );
      return redirect(FALLBACK_URL);
    }

    for (const [k, v] of url.searchParams.entries()) {
      if (!INTERNAL_PARAMS.has(k)) dest.searchParams.set(k, v);
    }
    dest.searchParams.set('ab_test', slug);
    dest.searchParams.set('ab_var', chosen.key);
    dest.searchParams.set('ab_vid', vid);

    // Cookies: visitor id (compartilhado) + atribuição sticky do teste.
    const setCookies = [cookieString(`ab_${slug}`, `${chosen.key}|${vid}`)];
    if (vidIsNew) setCookies.push(cookieString('ab_vid', vid));

    // Logging em background — NUNCA bloqueia/atrapalha o redirect (RF-09/31).
    const ua = req.headers.get('user-agent') || '';
    const uaParsed = parseUserAgent(ua);
    const rawQuery = url.search.startsWith('?') ? url.search.slice(1) : url.search;
    const referrer = req.headers.get('referer') || null;
    const language = (req.headers.get('accept-language') || '').split(',')[0] || null;
    const sp = url.searchParams;
    const origin = {
      utm_source: sp.get('utm_source'),
      utm_medium: sp.get('utm_medium'),
      utm_campaign: sp.get('utm_campaign'),
      utm_term: sp.get('utm_term'),
      utm_content: sp.get('utm_content'),
      gclid: sp.get('gclid'),
      fbclid: sp.get('fbclid'),
      ttclid: sp.get('ttclid'),
      msclkid: sp.get('msclkid'),
    };

    const logWork = (async () => {
      try {
        // ab_assignments: só na PRIMEIRA atribuição (preserva origem de first-touch).
        if (!sticky) {
          await sb.from('ab_assignments').upsert(
            {
              ab_test: slug,
              ab_var: chosen!.key,
              ab_vid: vid,
              landing_url: dest.toString(),
              referrer,
              ...origin,
              raw_query: rawQuery || null,
              user_agent: ua || null,
              device_type: uaParsed.device_type,
              browser: uaParsed.browser,
              browser_version: uaParsed.browser_version || null,
              os: uaParsed.os,
              language,
            },
            { onConflict: 'ab_vid,ab_test', ignoreDuplicates: true },
          );
        }
        // ab_events: um evento 'assignment' por clique (volume de cliques no redirect).
        await sb.from('ab_events').insert({
          ab_test: slug,
          ab_var: chosen!.key,
          ab_vid: vid,
          event_type: 'assignment',
          event_name: sticky ? 'sticky' : 'new',
          url: dest.toString(),
          referrer,
          ...origin,
          raw_query: rawQuery || null,
          device_type: uaParsed.device_type,
          browser: uaParsed.browser,
          browser_version: uaParsed.browser_version || null,
          os: uaParsed.os,
          language,
        });
      } catch (err) {
        console.error('[go] logging error:', err);
      }
    })();

    // EdgeRuntime existe no runtime do Supabase; roda o log DEPOIS de responder
    // (redirect volta na hora; o insert termina em background). Fora do Supabase
    // (ex.: teste local), cai no await.
    const edgeRuntime = (globalThis as unknown as {
      EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void };
    }).EdgeRuntime;
    if (edgeRuntime?.waitUntil) {
      edgeRuntime.waitUntil(logWork);
    } else {
      await logWork;
    }

    return redirect(dest.toString(), setCookies);
  } catch (err) {
    console.error('[go] fatal:', err);
    return redirect(FALLBACK_URL);
  }
});
