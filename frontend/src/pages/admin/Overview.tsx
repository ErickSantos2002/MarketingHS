import { AlertTriangle } from 'lucide-react';
import { useAdminData } from '@/hooks/useAdminData';
import { OverviewTab } from '@/components/admin/dashboard/overview';

export default function Overview() {
  const { filteredLeads, allLeads, showHotMetrics, setShowHotMetrics, dashboardFilters, truncado, teto } = useAdminData();

  return (
    <>
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
      <OverviewTab
        leads={filteredLeads}
        allLeads={allLeads}
        showHotMetrics={showHotMetrics}
        onShowHotMetricsChange={setShowHotMetrics}
        datePreset={dashboardFilters.filters.datePreset}
        dateFrom={dashboardFilters.filters.dateFrom}
        dateTo={dashboardFilters.filters.dateTo}
        filters={dashboardFilters.filters}
      />
    </>
  );
}
