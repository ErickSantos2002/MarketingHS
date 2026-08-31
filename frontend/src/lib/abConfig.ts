// Configuração do módulo A/B ajustável pelo admin (persistida no navegador).
// O "domínio do redirecionador" é o Custom Domain do Cloudflare Worker
// (default https://go.dnia.ai). Ele monta o Link de Distribuição e o endpoint
// do coletor. Trocar aqui reflete nos links e no snippet mostrados na UI — se
// mudar o subdomínio de fato, atualize também o Custom Domain no Cloudflare e o
// `data-endpoint` do snippet nas landing pages.

const KEY = "ab-redirector-base";
export const AB_BASE_DEFAULT = "https://go.dnia.ai";

export function getAbBaseUrl(): string {
  if (typeof localStorage === "undefined") return AB_BASE_DEFAULT;
  try {
    const v = localStorage.getItem(KEY);
    return v && /^https?:\/\//i.test(v) ? v.replace(/\/+$/, "") : AB_BASE_DEFAULT;
  } catch {
    return AB_BASE_DEFAULT;
  }
}

export function setAbBaseUrl(url: string): void {
  try {
    localStorage.setItem(KEY, url.trim().replace(/\/+$/, ""));
  } catch {
    /* ignore */
  }
}

// Link de Distribuição de um teste: https://go.dnia.ai/{slug}
export function abDistributionLink(slug: string): string {
  return `${getAbBaseUrl()}/${slug}`;
}

// Endpoint do coletor de eventos: https://go.dnia.ai/e
export function abCollectorUrl(): string {
  return `${getAbBaseUrl()}/e`;
}

// Rótulo sem protocolo (ex.: go.dnia.ai) para exibição compacta.
export function abBaseHost(): string {
  return getAbBaseUrl().replace(/^https?:\/\//i, "");
}

// --- Domínio de produção (validação das URLs de variante) --------------------
// Domínio oficial das landing pages. Toda variante de um teste deve apontar para
// ele (ou para um subdomínio dele). Impede cross-domain redirect no anúncio — a
// principal causa de reprovação por "Destination mismatch" no Google/Meta.
// Persistido na tabela Supabase `ab_config` (compartilhado pelo time) — ver
// useAbConfig. O default abaixo é só o fallback de UI antes do carregamento.
export const AB_PROD_DOMAIN_DEFAULT = "dnia.ai";

// Reduz um domínio digitado a um host "raiz" comparável: sem protocolo, sem
// www., sem path/porta/query, minúsculo.
export function normalizeProductionDomain(input: string): string {
  return (input || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/:?#].*$/, "")
    .replace(/\.+$/, "");
}

// Host de uma URL (minúsculo), ou null se a URL for inválida/sem protocolo.
export function domainOf(url: string): string | null {
  try {
    return new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
}

// `host` pertence a `domain` — é o próprio domínio ou um subdomínio dele?
// Ex.: isHostInDomain("promo.dnia.ai", "dnia.ai") === true;
//      isHostInDomain("dnia.ai.evil.com", "dnia.ai") === false.
export function isHostInDomain(host: string, domain: string): boolean {
  const h = (host || "").toLowerCase();
  const d = normalizeProductionDomain(domain);
  if (!d || !h) return false;
  return h === d || h.endsWith("." + d);
}
