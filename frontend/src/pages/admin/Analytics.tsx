import { useSearchParams } from 'react-router-dom';
import { useAdminData } from '@/hooks/useAdminData';
import { ProfileTab } from '@/components/admin/dashboard/profile';
import { ChallengesTab } from '@/components/admin/dashboard/challenges';
import { TacticalTab } from '@/components/admin/dashboard/tactical';
import { OperationalTab } from '@/components/admin/dashboard/operational';
import { InsightsTab } from '@/components/admin/dashboard/insights';
import { cn } from '@/lib/utils';

const TABS = [
  { key: 'profile', label: 'Perfil' },
  { key: 'challenges', label: 'Desafios' },
  { key: 'tactical', label: 'Tático' },
  { key: 'operational', label: 'Operacional' },
  { key: 'insights', label: 'Insights' },
] as const;

type TabKey = typeof TABS[number]['key'];

export default function Analytics() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('tab') as TabKey) || 'profile';
  const { filteredLeads } = useAdminData();

  return (
    <div className="space-y-6">
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
        {activeTab === 'challenges' && <ChallengesTab leads={filteredLeads} />}
        {activeTab === 'tactical' && <TacticalTab leads={filteredLeads} />}
        {activeTab === 'operational' && <OperationalTab leads={filteredLeads} />}
        {activeTab === 'insights' && <InsightsTab leads={filteredLeads} />}
      </div>
    </div>
  );
}
