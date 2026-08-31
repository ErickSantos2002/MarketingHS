import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { ALL_COLUMNS } from '@/components/admin/ColumnSelector';

interface ContactsExportProps {
  leads: any[];
  visibleColumns: string[];
  columnOrder: string[];
}

export function formatCell(lead: any, key: string): string {
  const v = lead?.[key];
  switch (key) {
    case 'last_conversion_date':
    case 'created_at':
    case 'data_interesse':
      return v ? new Date(v).toLocaleString('pt-BR') : '';
    case 'interesse_ecossistema':
      return v === true ? 'Sim' : v === false ? 'Não' : '';
    case 'interesse_mtia':
    case 'interesse_formacao':
      return v ? 'Sim' : '';
    case 'ecosystem': {
      const parts: string[] = [];
      if (lead?.has_dnia) parts.push('D');
      if (lead?.has_nexus) parts.push('N');
      if (lead?.has_mentoria) parts.push('M');
      return parts.join('/');
    }
    case 'tags': {
      const tags = lead?.tags || lead?.lead_tags || [];
      if (!Array.isArray(tags)) return '';
      return tags
        .map((t: any) => (typeof t === 'string' ? t : t?.name || t?.tag?.name || ''))
        .filter(Boolean)
        .join(', ');
    }
    case 'lead_score':
      return v != null ? String(v) : '';
    case 'desafios':
      return (v || '').toString().replace(/[\n\r]/g, ' ');
    default:
      if (v == null) return '';
      if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
      return String(v);
  }
}

export function ContactsExport({ leads, visibleColumns, columnOrder }: ContactsExportProps) {
  const exportToCSV = () => {
    if (leads.length === 0) return;

    const orderedKeys = columnOrder.filter(k => visibleColumns.includes(k));
    const cols = orderedKeys
      .map(k => ALL_COLUMNS.find(c => c.key === k))
      .filter(Boolean) as { key: string; label: string }[];

    const headers = cols.map(c => c.label);
    const rows = leads.map(lead => cols.map(c => formatCell(lead, c.key)));

    const csvContent = [
      headers.join(';'),
      ...rows.map(row =>
        row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(';')
      ),
    ].join('\n');

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `contatos_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <Button
      onClick={exportToCSV}
      variant="outline"
      size="sm"
      className="h-9 shrink-0 gap-1.5"
      disabled={leads.length === 0}
    >
      <Download className="h-4 w-4" />
      <span className="hidden lg:inline">CSV ({leads.length})</span>
    </Button>
  );
}
