import { AlertTriangle } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useAdminData } from '@/hooks/useAdminData';
import { ProfileTab } from '@/components/admin/dashboard/profile';
import { TacticalTab } from '@/components/admin/dashboard/tactical';
import { OperationalTab } from '@/components/admin/dashboard/operational';
import { InsightsTab } from '@/components/admin/dashboard/insights';
import { cn } from '@/lib/utils';

const TABS = [
  { key: 'profile', label: 'Perfil' },
  { key: 'tactical', label: 'Tático' },
  { key: 'operational', label: 'Operacional' },
  { key: 'insights', label: 'Insights' },
] as const;

type TabKey = typeof TABS[number]['key'];

// A aba Desafios saiu em 02/10/2026 (raio-x RD, R6): media o campo desafio do
// funil de evento da dn.ia, que a H&S não coleta. Link antigo com
// `?tab=challenges` (ou qualquer aba que não existe) cai em Perfil, em vez de
// abrir uma página em branco.
function abaValida(valor: string | null): TabKey {
  return TABS.some(t => t.key === valor) ? (valor as TabKey) : 'profile';
}

export default function Analytics() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = abaValida(searchParams.get('tab'));
  const { filteredLeads, truncado, teto } = useAdminData();

  return (
    <div className="space-y-6">
      {truncado && (
        <div className="mb-4 flex gap-2 rounded-md border border-warning/30 bg-[--tint-warning] px-3 py-2 text-xs text-[--on-tint-warning]">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-warning" />
          <span>
          Os números abaixo foram calculados sobre os {teto.toLocaleString('pt-BR')} contatos
          mais recentes, não sobre a base inteira. O painel calcula no navegador e
          esse é o teto que ele aguenta.
          </span>
        </div>
      )}
      {/* Sub-navigation tabs */}
      <div className="border-b border-border/40">
        <nav className="flex gap-1 -mb-px">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setSearchParams({ tab: tab.key })}
              className={cn(
                'px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-[1px]',
                activeTab === tab.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
              )}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      <div className="space-y-6">
        {activeTab === 'profile' && <ProfileTab leads={filteredLeads} />}
        {activeTab === 'tactical' && <TacticalTab leads={filteredLeads} />}
        {activeTab === 'operational' && <OperationalTab leads={filteredLeads} />}
        {activeTab === 'insights' && <InsightsTab leads={filteredLeads} />}
      </div>
    </div>
  );
}
