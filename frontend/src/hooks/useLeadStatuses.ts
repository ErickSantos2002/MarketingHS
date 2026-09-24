import { useQuery } from '@tanstack/react-query';
import { listarStatusDeLead, type StatusDeLead } from '@/lib/contatos';
import { COR_DE_DADO_PADRAO } from '@/lib/corDeDado';

export type LeadStatus = StatusDeLead;

const FALLBACK_COLOR = COR_DE_DADO_PADRAO;

export function useLeadStatuses() {
  const query = useQuery({
    queryKey: ['lead-statuses'],
    // A ordenação é do servidor (sort_order, depois name), como era aqui.
    queryFn: listarStatusDeLead,
    staleTime: 5 * 60 * 1000,
  });

  const statuses = query.data ?? [];
  const options = statuses.map((s) => s.name);
  const colors: Record<string, string> = statuses.reduce((acc, s) => {
    acc[s.name] = s.color || FALLBACK_COLOR;
    return acc;
  }, {} as Record<string, string>);

  const getColor = (name: string | null | undefined) => {
    if (!name) return FALLBACK_COLOR;
    return colors[name] || FALLBACK_COLOR;
  };

  return { statuses, options, colors, getColor, isLoading: query.isLoading };
}
