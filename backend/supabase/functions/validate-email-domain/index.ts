import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

// Cache em memória por instância de função (TTL 1h)
const mxCache = new Map<string, { valid: boolean; reason?: string; expiresAt: number }>();
const TTL_MS = 60 * 60 * 1000;

const DISPOSABLE = new Set<string>([
  "mailinator.com", "tempmail.com", "10minutemail.com", "guerrillamail.com",
  "yopmail.com", "trashmail.com", "throwawaymail.com", "sharklasers.com",
  "getnada.com", "dispostable.com", "maildrop.cc", "fakeinbox.com",
  "tempail.com", "temp-mail.org", "temp-mail.io", "discard.email",
]);

function emailFormatOk(email: string): boolean {
  // Regex prática: local@domínio.tld (TLD com pelo menos 2 chars)
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

async function hasMxRecord(domain: string): Promise<boolean> {
  try {
    const url = `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(url, {
      headers: { Accept: "application/dns-json" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return true; // fail-open
    const data = await res.json();
    // Status 0 = NOERROR. Answer com type=15 (MX) presente.
    if (data.Status !== 0) {
      // NXDOMAIN ou outro erro -> sem MX. Fallback: tentar A record.
      return await hasARecord(domain);
    }
    const mxAnswers = (data.Answer || []).filter((a: any) => a.type === 15);
    if (mxAnswers.length > 0) return true;
    // Sem MX: alguns domínios usam fallback A record para email
    return await hasARecord(domain);
  } catch (_err) {
    return true; // fail-open em caso de erro de rede
  }
}

async function hasARecord(domain: string): Promise<boolean> {
  try {
    const url = `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=A`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(url, {
      headers: { Accept: "application/dns-json" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return false;
    const data = await res.json();
    if (data.Status !== 0) return false;
    return (data.Answer || []).some((a: any) => a.type === 1);
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

    if (!email || !emailFormatOk(email)) {
      return new Response(
        JSON.stringify({ valid: false, reason: "Formato de email inválido." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const domain = email.split("@")[1];

    if (DISPOSABLE.has(domain)) {
      return new Response(
        JSON.stringify({ valid: false, reason: "Use um email corporativo ou pessoal real." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const cached = mxCache.get(domain);
    if (cached && cached.expiresAt > Date.now()) {
      return new Response(
        JSON.stringify({ valid: cached.valid, reason: cached.reason }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const ok = await hasMxRecord(domain);
    const result = ok
      ? { valid: true }
      : { valid: false, reason: "Este domínio não recebe emails. Verifique o endereço." };

    mxCache.set(domain, { ...result, expiresAt: Date.now() + TTL_MS });

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[validate-email-domain] error:", err);
    // Fail-open: não bloqueia conversão
    return new Response(JSON.stringify({ valid: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
