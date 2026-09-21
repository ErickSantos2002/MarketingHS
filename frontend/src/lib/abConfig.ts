// Configuração do módulo A/B. O domínio de produção e o do redirecionador
// moram em `ab_config` (compartilhados pelo time) — ver useAbConfig. Até o
// lote 8C o redirecionador ficava no localStorage de cada navegador, com
// padrão https://go.dnia.ai: cada admin podia ver um link diferente.
//
// O "domínio do redirecionador" é o Custom Domain do Cloudflare Worker. Ele
// monta o Link de Distribuição e o endpoint do coletor.

// Link de Distribuição de um teste: {base}/{slug}. Vazio sem redirecionador.
export function abDistributionLink(base: string | null, slug: string): string {
  return base ? `${base}/${slug}` : "";
}

// Endpoint do coletor: {base}/e (o Worker leva para /publico/ab/eventos).
export function abCollectorUrl(base: string | null): string {
  return base ? `${base}/e` : "";
}

// Rótulo sem protocolo, para exibição compacta.
export function abBaseHost(base: string | null): string {
  return base ? base.replace(/^https?:\/\//i, "") : "(redirecionador não configurado)";
}

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
// Ex.: isHostInDomain("promo.exemplo.com.br", "exemplo.com.br") === true;
//      isHostInDomain("exemplo.com.br.evil.com", "exemplo.com.br") === false.
export function isHostInDomain(host: string, domain: string): boolean {
  const h = (host || "").toLowerCase();
  const d = normalizeProductionDomain(domain);
  if (!d || !h) return false;
  return h === d || h.endsWith("." + d);
}
