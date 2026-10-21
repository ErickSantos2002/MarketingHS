// Sites de fora que mandam visita e conversão ao MarketingHS pelo
// `rastreio.js` (prova de substituição do RD, Tarefa 4 do plano).
//
// ⚠️ O token (`pub_…`) é público por desenho: só cria/atualiza lead, conversão
// e visita, e só vale vindo de um domínio cadastrado. Não é segredo — mas
// rotacionar mata o snippet que está instalado no site, por isso a tela pede
// confirmação.
import { api } from '@/lib/api';

export type Site = {
  id: string;
  nome: string;
  dominios: string[];
  token: string;
  mapa_campos: Record<string, string>;
  tags: string[];
  ativo: boolean;
  criado_em: string;
};

export type SiteNovo = {
  nome: string;
  dominios: string[];
  mapa_campos?: Record<string, string>;
  tags?: string[];
};

export type SiteAlterado = Partial<SiteNovo & { ativo: boolean }>;

export const listarSites = () => api.get<Site[]>('/sites');

export const criarSite = (dados: SiteNovo) => api.post<Site>('/sites', dados);

export const atualizarSite = (id: string, dados: SiteAlterado) =>
  api.patch<Site>(`/sites/${encodeURIComponent(id)}`, dados);

export const rotacionarToken = (id: string) =>
  api.post<Site>(`/sites/${encodeURIComponent(id)}/token`);

/** A linha de instalação do `rastreio.js` (a mesma do cabeçalho do script). */
export function snippetDoSite(site: Site, origem: string): string {
  const base = origem.replace(/\/+$/, '');
  return `<script src="${base}/rastreio.js" async data-token="${site.token}" data-api="${base}/api"></script>`;
}

/**
 * Domínio como o servidor guarda: minúsculo, sem esquema nem caminho. A tela
 * normaliza antes de mandar para o admin ver o que vai valer; o servidor
 * normaliza de novo (é ele quem decide).
 */
export function normalizarDominio(bruto: string): string {
  return bruto
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#].*$/, '');
}

/** "a.com, b.com\nc.com" → ["a.com", "b.com", "c.com"], sem repetidos. */
export function lerLista(texto: string, normalizar: (s: string) => string = s => s.trim()): string[] {
  const saida: string[] = [];
  for (const parte of texto.split(/[\s,;]+/)) {
    const v = normalizar(parte);
    if (v && !saida.includes(v)) saida.push(v);
  }
  return saida;
}
