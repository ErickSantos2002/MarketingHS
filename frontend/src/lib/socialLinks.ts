// Links das redes sociais da marca, usados para pre-preencher o bloco "Social"
// do editor de email (Unlayer). Fonte unica de verdade para: a aba de
// configuracao (/settings), o hook useSocialLinks e o emailEditorConfig.
//
// O `name` de cada rede NAO e cosmetico: e ele que o Unlayer usa para resolver
// o arquivo do icone em cdn.tools.unlayer.com/social/icons/<colecao>/<name em
// minusculas>.png. Verificado via HEAD nas 7 colecoes para as 8 redes abaixo --
// todas existem. Renomear um `name` quebra o icone silenciosamente (o link
// continua, a imagem vira 404), entao trate esses valores como constantes.

export const SOCIAL_ICON_TYPES = [
  'circle',
  'circle-black',
  'circle-white',
  'rounded',
  'rounded-black',
  'squared',
  'squared-black',
] as const;

export type SocialIconType = (typeof SOCIAL_ICON_TYPES)[number];

export interface SocialNetwork {
  /** Chave usada no JSON salvo no banco. */
  key: string;
  /** Nome exato esperado pelo Unlayer (resolve o arquivo do icone). */
  name: string;
  placeholder: string;
}

export const SOCIAL_NETWORKS: SocialNetwork[] = [
  { key: 'instagram', name: 'Instagram', placeholder: 'https://instagram.com/suaempresa' },
  { key: 'linkedin', name: 'LinkedIn', placeholder: 'https://linkedin.com/company/suaempresa' },
  { key: 'youtube', name: 'YouTube', placeholder: 'https://youtube.com/@suaempresa' },
  { key: 'facebook', name: 'Facebook', placeholder: 'https://facebook.com/suaempresa' },
  { key: 'tiktok', name: 'TikTok', placeholder: 'https://tiktok.com/@suaempresa' },
  { key: 'x', name: 'X', placeholder: 'https://x.com/suaempresa' },
  { key: 'whatsapp', name: 'WhatsApp', placeholder: 'https://wa.me/5511999999999' },
  { key: 'spotify', name: 'Spotify', placeholder: 'https://open.spotify.com/show/...' },
];

export interface SocialLinksConfig {
  iconType: SocialIconType;
  /** key da rede -> URL. String vazia = rede nao entra no email. */
  links: Record<string, string>;
}

export const SOCIAL_SETTING_KEY = 'social_links';

export const DEFAULT_SOCIAL_LINKS: SocialLinksConfig = {
  iconType: 'circle-black',
  links: Object.fromEntries(SOCIAL_NETWORKS.map(n => [n.key, ''])),
};

/** Aceita vazio (rede desligada) ou uma URL http/https bem formada. */
export function isValidSocialUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Normaliza o que veio do banco: descarta chaves desconhecidas e tipos errados. */
export function parseSocialLinks(raw: unknown): SocialLinksConfig {
  const value = (raw ?? {}) as Partial<SocialLinksConfig>;
  const iconType = SOCIAL_ICON_TYPES.includes(value.iconType as SocialIconType)
    ? (value.iconType as SocialIconType)
    : DEFAULT_SOCIAL_LINKS.iconType;

  const rawLinks = (value.links ?? {}) as Record<string, unknown>;
  const links = Object.fromEntries(
    SOCIAL_NETWORKS.map(n => [n.key, typeof rawLinks[n.key] === 'string' ? (rawLinks[n.key] as string) : '']),
  );

  return { iconType, links };
}

/**
 * Converte a config no shape que o Unlayer espera em `values.icons` -- tanto no
 * bloco social em si quanto no `defaultValues` da tool. Redes sem URL ficam de
 * fora: um icone sem link e um icone morto no email.
 */
export function socialIconsFor(config: SocialLinksConfig): { name: string; url: string }[] {
  return SOCIAL_NETWORKS
    .filter(n => config.links[n.key]?.trim())
    .map(n => ({ name: n.name, url: config.links[n.key].trim() }));
}

/** URL do PNG do icone -- usada no preview da tela de configuracao. */
export function socialIconPreviewUrl(network: SocialNetwork, iconType: SocialIconType): string {
  return `https://cdn.tools.unlayer.com/social/icons/${iconType}/${network.name.toLowerCase()}.png`;
}
