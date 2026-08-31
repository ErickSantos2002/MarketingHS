import { supabase } from "@/integrations/supabase/client";

// Parâmetros de atribuição do Teste A/B, resolvidos no client. Espelha a lógica
// do snippet public/ab.js (query -> cookie .dnia.ai), para os fluxos de captura
// que rodam DENTRO deste app. Ver docs/ab-testing/.
export interface AbParams {
  ab_test: string | null;
  ab_var: string | null;
  ab_vid: string | null;
}

const EMPTY: AbParams = { ab_test: null, ab_var: null, ab_vid: null };
const COOKIE_MAX_AGE = 60 * 60 * 24 * 90; // 90 dias

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const escaped = name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1");
  const m = document.cookie.match(new RegExp("(?:^|; )" + escaped + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

// Só escopa Domain=.dnia.ai quando o host é *.dnia.ai (em localhost/preview grava
// sem domain para não falhar em silêncio).
function canScopeDomain(): boolean {
  return typeof location !== "undefined" && /(^|\.)dnia\.ai$/i.test(location.hostname);
}

function writeCookie(name: string, value: string): void {
  if (typeof document === "undefined") return;
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", `Max-Age=${COOKIE_MAX_AGE}`, "SameSite=Lax"];
  if (typeof location !== "undefined" && location.protocol === "https:") parts.push("Secure");
  if (canScopeDomain()) parts.push("Domain=.dnia.ai");
  document.cookie = parts.join("; ");
}

export function getAbParams(): AbParams {
  if (typeof window === "undefined") return EMPTY;
  const q = new URLSearchParams(window.location.search);
  let ab_test = q.get("ab_test");
  let ab_var = q.get("ab_var");
  let ab_vid = q.get("ab_vid") || readCookie("ab_vid");

  if (!ab_test || !ab_var) {
    const last = readCookie("ab_last"); // formato: test|var|vid
    if (last) {
      const [t, v, vid] = last.split("|");
      ab_test = ab_test || t || null;
      ab_var = ab_var || v || null;
      ab_vid = ab_vid || vid || null;
    }
  }

  // Persiste para sobreviver à navegação SPA (query some entre rotas).
  if (ab_test && ab_var && ab_vid) {
    writeCookie("ab_vid", ab_vid);
    writeCookie("ab_last", `${ab_test}|${ab_var}|${ab_vid}`);
  }
  return { ab_test, ab_var, ab_vid };
}

// Registra uma conversão nomeada no coletor A/B (fire-and-forget, idempotente
// server-side por dedupe_key). No-op quando não há atribuição resolvida.
export function recordAbConversion(name: string, extra?: Record<string, unknown>): void {
  const ab = getAbParams();
  if (!ab.ab_test || !ab.ab_vid) return;
  try {
    supabase.functions
      .invoke("ab-events", {
        body: {
          events: [
            {
              ...ab,
              event_type: "conversion",
              event_name: name,
              url: typeof window !== "undefined" ? window.location.href : null,
              page_slug: typeof window !== "undefined" ? window.location.pathname : null,
              ...extra,
            },
          ],
        },
      })
      .catch(() => {});
  } catch {
    /* nunca lança — tracking não pode custar uma conversão */
  }
}
