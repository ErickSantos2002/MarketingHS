import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import type { Lead } from '@/hooks/useLeads';

interface LeadsExportProps {
  leads: Lead[];
}

export function LeadsExport({ leads }: LeadsExportProps) {
  const exportToCSV = () => {
    if (leads.length === 0) return;

    const headers = [
      'Data',
      'Tipo',
      'Etiqueta',
      'Origem Campanha',
      'Tipo Participante',
      'Nome',
      'Email',
      'WhatsApp',
      'Cargo',
      'Empresa',
      'Faturamento',
      'Funcionários',
      'Desafios',
      'Source',
      'UTM Source',
      'UTM Medium',
      'UTM Campaign',
      'UTM Term',
      'UTM Content',
      'Interesse Ecossistema',
      'Interesse MTIA',
      'Interesse Formação',
      'Data Interesse',
      'Presença',
      'Última Conversão',
      'Indicação'
    ];

    const rows = leads.map(lead => [
      new Date(lead.created_at).toLocaleString('pt-BR'),
      lead.tipo,
      lead.etiqueta || '',
      lead.origem_campanha || '',
      lead.tipo_participante || '',
      lead.nome || '',
      lead.email || '',
      lead.whatsapp || '',
      lead.cargo || '',
      lead.empresa || '',
      lead.faturamento || '',
      lead.funcionarios || '',
      (lead.desafios || '').replace(/[\n\r]/g, ' '),
      lead.source || '',
      lead.utm_source || '',
      lead.utm_medium || '',
      lead.utm_campaign || '',
      lead.utm_term || '',
      lead.utm_content || '',
      lead.interesse_ecossistema ? 'Sim' : (lead.interesse_ecossistema === false ? 'Não' : ''),
      lead.interesse_mtia ? 'Sim' : '',
      lead.interesse_formacao ? 'Sim' : '',
      lead.data_interesse ? new Date(lead.data_interesse).toLocaleString('pt-BR') : '',
      lead.presenca || '',
      lead.last_conversion_date ? new Date(lead.last_conversion_date).toLocaleString('pt-BR') : '',
      lead.indicacao || ''
    ]);

    const csvContent = [
      headers.join(';'),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(';'))
    ].join('\n');

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `leads_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <Button onClick={exportToCSV} variant="outline" size="sm" className="h-9 shrink-0 gap-1.5" disabled={leads.length === 0}>
      <Download className="h-4 w-4" />
      <span className="hidden lg:inline">CSV ({leads.length})</span>
    </Button>
  );
}
