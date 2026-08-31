import type { LeadsFilters as FiltersType } from '@/hooks/useLeads';

interface LeadsFiltersProps {
  filters: FiltersType;
  onFiltersChange: (filters: FiltersType) => void;
}

export function LeadsFilters({ filters, onFiltersChange }: LeadsFiltersProps) {
  // Filters are now handled by GlobalFilters
  // This component is kept for backwards compatibility
  return null;
}
