import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type LeadStatus = {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  is_system: boolean;
};

const FALLBACK_COLOR = '#888780';

export function useLeadStatuses() {
  const query = useQuery({
    queryKey: ['lead-statuses'],
    queryFn: async (): Promise<LeadStatus[]> => {
      const { data, error } = await supabase
        .from('lead_statuses' as any)
        .select('id, name, color, sort_order, is_system')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      if (error) throw error;
      return (data as any) ?? [];
    },
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
