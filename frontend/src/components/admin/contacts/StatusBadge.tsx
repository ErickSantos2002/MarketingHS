import { Badge } from '@/components/ui/badge';
import { useLeadStatuses } from '@/hooks/useLeadStatuses';

// Legacy fallback constants — kept for non-reactive references (e.g. plain strings in filters)
export const STATUS_OPTIONS = [
  'Lead',
  'Lead Qualificado',
  'MQL - Reunião agendada',
  'SQL - Em negociação',
  'Venda realizada',
  'Em contrato',
  'Iniciado',
] as const;

export const STATUS_COLORS: Record<string, string> = {
  'Lead': '#888780',
  'Lead Qualificado': '#185FA5',
  'MQL - Reunião agendada': '#534AB7',
  'SQL - Em negociação': '#B7861F',
  'Venda realizada': '#3B6D11',
  'Em contrato': '#0E7C66',
  'Iniciado': '#5A2E91',
};

export function StatusBadge({ status }: { status: string | null }) {
  const s = status || 'Lead';
  const { getColor } = useLeadStatuses();
  const color = getColor(s) || STATUS_COLORS[s] || '#888780';

  return (
    <Badge
      variant="outline"
      className="text-xs font-medium whitespace-nowrap"
      style={{
        borderColor: color,
        color: color,
        backgroundColor: `${color}15`,
      }}
    >
      {s}
    </Badge>
  );
}
