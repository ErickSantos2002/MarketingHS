import { Badge } from '@/components/ui/badge';
import { useLeadStatuses } from '@/hooks/useLeadStatuses';
import { estiloDeCorDeDado, COR_DE_DADO_PADRAO } from '@/lib/corDeDado';

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

// Cor de reserva por lugar no funil, usada quando o banco não responde —
// valores em token do DS (a cor real do status é dado, ver corDeDado.ts).
export const STATUS_COLORS: Record<string, string> = {
  'Lead': 'var(--color-slate-400)',
  'Lead Qualificado': 'var(--color-info-600)',
  'MQL - Reunião agendada': 'var(--color-primary-600)',
  'SQL - Em negociação': 'var(--color-warning-600)',
  'Venda realizada': 'var(--color-success-600)',
  'Em contrato': 'var(--color-success-700)',
  'Iniciado': 'var(--color-primary-800)',
};

export function StatusBadge({ status }: { status: string | null }) {
  const s = status || 'Lead';
  const { getColor } = useLeadStatuses();
  const color = getColor(s) || STATUS_COLORS[s] || COR_DE_DADO_PADRAO;

  return (
    <Badge
      variant="outline"
      className="text-xs font-medium whitespace-nowrap text-conteudo-heading"
      style={estiloDeCorDeDado(color)}
    >
      {s}
    </Badge>
  );
}
