import { RevenueDistribution } from './RevenueDistribution';
import { RoleDistribution } from './RoleDistribution';
import { SectorDistribution } from './SectorDistribution';
import { DataCompletenessGauges } from './DataCompletenessGauges';
import { DashboardCardSelector } from '@/components/admin/dashboard/DashboardCardSelector';
import { useDashboardCardSettings, type CardConfig } from '@/hooks/useDashboardCardSettings';
import type { Lead } from '@/hooks/useLeads';
import { useLeadAnalytics } from '@/hooks/useLeadAnalytics';

const PROFILE_CARDS: CardConfig[] = [
  { key: 'data_completeness', label: 'Completude de Dados', defaultVisible: true },
  { key: 'revenue', label: 'Faturamento', defaultVisible: true },
  { key: 'role', label: 'Cargo', defaultVisible: true },
  { key: 'sector', label: 'Setor', defaultVisible: true },
  { key: 'company_size', label: 'Tamanho Empresas', defaultVisible: true },
];

interface ProfileTabProps {
  leads: Lead[];
}

export function ProfileTab({ leads }: ProfileTabProps) {
  const analytics = useLeadAnalytics(leads);
  const { visibleCards, toggleCard, resetCards, isVisible } = useDashboardCardSettings('profile', PROFILE_CARDS);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-end">
        <DashboardCardSelector cards={PROFILE_CARDS} visibleCards={visibleCards} onToggle={toggleCard} onReset={resetCards} />
      </div>

      {isVisible('data_completeness') && (
        <DataCompletenessGauges data={analytics.dataCompleteness} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {isVisible('revenue') && (
          <RevenueDistribution data={analytics.distributionByFaturamento} />
        )}
        {isVisible('role') && (
          <RoleDistribution data={analytics.distributionByCargo} />
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {isVisible('sector') && (
          <SectorDistribution data={analytics.distributionBySector} />
        )}

        {isVisible('company_size') && (
          <div className="bg-gradient-to-br from-card via-card to-accent/10 border border-border/50 rounded-lg shadow-lg p-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <div className="p-2 rounded-lg bg-accent/20">
                <svg className="h-5 w-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              Tamanho das Empresas
            </h3>
            <div className="space-y-3">
              {analytics.distributionByFuncionarios.slice(0, 6).map((item, index) => (
                <div key={item.funcionarios} className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-muted-foreground truncate max-w-[180px]">
                        {item.funcionarios}
                      </span>
                      <span className="text-sm font-medium">{item.count}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted/30 overflow-hidden">
                      <div 
                        className="h-full rounded-full transition-all duration-700 ease-out"
                        style={{ 
                          width: `${item.percentage}%`,
                          background: `linear-gradient(90deg, hsl(var(--primary)) 0%, hsl(var(--primary) / 0.6) 100%)`,
                          animationDelay: `${index * 100}ms`
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
