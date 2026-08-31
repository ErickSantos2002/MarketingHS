import { PriorityLeadsTable } from './PriorityLeadsTable';
import { SalesReadinessFunnel } from './SalesReadinessFunnel';
import { DuplicationCard } from './DuplicationCard';
import { DataCompletenessGauges } from '../profile/DataCompletenessGauges';
import { DashboardCardSelector } from '@/components/admin/dashboard/DashboardCardSelector';
import { useDashboardCardSettings, type CardConfig } from '@/hooks/useDashboardCardSettings';
import type { Lead } from '@/hooks/useLeads';
import { useLeadQualification, type EnrichedLead } from '@/hooks/useLeadQualification';
import { useLeadAnalytics } from '@/hooks/useLeadAnalytics';

const TACTICAL_CARDS: CardConfig[] = [
  { key: 'priority_table', label: 'Tabela de Prioridade', defaultVisible: true },
  { key: 'funnel_duplication', label: 'Funnel / Duplicação / Ações', defaultVisible: true },
  { key: 'data_completeness', label: 'Completude de Dados', defaultVisible: true },
];

interface TacticalTabProps {
  leads: Lead[];
}

export function TacticalTab({ leads }: TacticalTabProps) {
  const { enrichedLeads } = useLeadQualification(leads);
  const analytics = useLeadAnalytics(leads);
  const { visibleCards, toggleCard, resetCards, isVisible } = useDashboardCardSettings('tactical', TACTICAL_CARDS);

  const sortedLeads = [...enrichedLeads].sort((a, b) => b.priorityScore - a.priorityScore);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-end">
        <DashboardCardSelector cards={TACTICAL_CARDS} visibleCards={visibleCards} onToggle={toggleCard} onReset={resetCards} />
      </div>

      {isVisible('priority_table') && (
        <PriorityLeadsTable leads={sortedLeads} />
      )}

      {isVisible('funnel_duplication') && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <SalesReadinessFunnel leads={enrichedLeads} />
          <DuplicationCard data={analytics.duplicateEmailsCount} />
          
          <div className="bg-gradient-to-br from-card via-card to-primary/5 border border-border/50 rounded-lg shadow-lg p-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <div className="p-2 rounded-lg bg-primary/20">
                <svg className="h-5 w-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              Ações Rápidas
            </h3>
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-muted-foreground">Leads P1 (Hot)</span>
                  <span className="text-lg font-bold text-emerald-400">
                    {enrichedLeads.filter(l => l.priorityLevel === 'P1').length}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Prontos para contato imediato
                </div>
              </div>
              
              <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-muted-foreground">Leads P2</span>
                  <span className="text-lg font-bold text-yellow-400">
                    {enrichedLeads.filter(l => l.priorityLevel === 'P2').length}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Alta prioridade para follow-up
                </div>
              </div>
              
              <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-muted-foreground">Com WhatsApp</span>
                  <span className="text-lg font-bold text-primary">
                    {enrichedLeads.filter(l => l.whatsapp).length}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Contato direto disponível
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {isVisible('data_completeness') && (
        <DataCompletenessGauges data={analytics.dataCompleteness} />
      )}
    </div>
  );
}
