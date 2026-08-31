import { Badge } from '@/components/ui/badge';

interface PageStatusBadgeProps {
  status: 'active' | 'draft' | 'inactive';
}

const statusConfig = {
  active: {
    label: 'Ativo',
    variant: 'default' as const,
    className: 'bg-green-500 hover:bg-green-600',
  },
  draft: {
    label: 'Rascunho',
    variant: 'secondary' as const,
    className: 'bg-yellow-500 hover:bg-yellow-600 text-white',
  },
  inactive: {
    label: 'Inativo',
    variant: 'destructive' as const,
    className: '',
  },
};

export function PageStatusBadge({ status }: PageStatusBadgeProps) {
  const config = statusConfig[status];

  return (
    <Badge variant={config.variant} className={config.className}>
      {config.label}
    </Badge>
  );
}
