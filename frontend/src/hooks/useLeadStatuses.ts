import { useQuery } from '@tanstack/react-query';
import { listarStatusDeLead, type StatusDeLead } from '@/lib/contatos';

export type LeadStatus = StatusDeLead;

export function useLeadStatuses() {
  const query = useQuery({
    queryKey: ['lead-statuses'],
    // A ordenação é do servidor (sort_order, depois name), como era aqui.
    queryFn: listarStatusDeLead,
    staleTime: 5 * 60 * 1000,
  });

  const statuses = query.data ?? [];
  const options = statuses.map((s) => s.name);

  // A cor não sai daqui: `color` do banco é ignorada desde 01/10/2026 — a
  // cor do status é o mapa fixo `corDoStatus` (contacts/StatusBadge.tsx).
  return { statuses, options, isLoading: query.isLoading };
}
