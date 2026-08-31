// Normalização e rótulo da audiência de uma campanha.
//
// Retrocompatibilidade: campanhas anteriores à migration multi-segmento só têm
// `segment_id`. A regra é sempre a mesma, aqui e no send-campaign: arrays quando
// existirem, senão o segment_id legado, senão vazio (= todos os contatos).

export interface AudienceSource {
  segment_id?: string | null;
  segment_ids?: string[] | null;
  excluded_segment_ids?: string[] | null;
}

export function includeSegmentIds(c: AudienceSource): string[] {
  if (Array.isArray(c.segment_ids) && c.segment_ids.length > 0) return c.segment_ids;
  return c.segment_id ? [c.segment_id] : [];
}

export function excludeSegmentIds(c: AudienceSource): string[] {
  return Array.isArray(c.excluded_segment_ids) ? c.excluded_segment_ids : [];
}

// Rótulo curto para a coluna "Segmento" da lista e para o cabeçalho do detalhe.
// `names` mapeia id -> nome; um id ausente é um segmento apagado depois de a
// campanha ter sido enviada (a guarda do banco só permite apagar nesse caso).
export function describeAudience(
  include: string[],
  exclude: string[],
  names: Record<string, string>,
): string {
  const label = (ids: string[]) => ids.map(id => names[id] || 'Segmento removido').join(', ');

  const base = include.length === 0
    ? 'Todos os contatos'
    : include.length <= 2
      ? label(include)
      : `${include.length} segmentos`;

  if (exclude.length === 0) return base;

  const excluded = exclude.length === 1 ? label(exclude) : `${exclude.length} segmentos`;
  return `${base} — exceto ${excluded}`;
}
