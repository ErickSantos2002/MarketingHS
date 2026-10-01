import { Badge } from '@/components/ui/badge';
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

// A cor do status é este mapa, por lugar no funil, em token do DS — em todo
// lugar: lista, barras, ficha (decisão do Erick, 01/10/2026, pergunta 2).
// `lead_statuses.color` continua vindo do banco e é ignorada de propósito:
// era ela que pintava a ficha de uma cor e a lista de outra.
export const STATUS_COLORS: Record<string, string> = {
  'Lead': 'var(--color-slate-400)',
  'Lead Qualificado': 'var(--color-info-600)',
  'MQL - Reunião agendada': 'var(--color-primary-600)',
  'SQL - Em negociação': 'var(--color-warning-600)',
  'Venda realizada': 'var(--color-success-600)',
  'Em contrato': 'var(--color-success-700)',
  'Iniciado': 'var(--color-primary-800)',
};

export function corDoStatus(status: string | null | undefined): string {
  return STATUS_COLORS[status || 'Lead'] ?? COR_DE_DADO_PADRAO;
}

export function StatusBadge({ status }: { status: string | null }) {
  const s = status || 'Lead';
  const color = corDoStatus(s);

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
