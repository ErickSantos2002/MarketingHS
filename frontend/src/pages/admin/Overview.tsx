import { useAdminData } from '@/hooks/useAdminData';
import { OverviewTab } from '@/components/admin/dashboard/overview';

export default function Overview() {
  const { filteredLeads, allLeads, showHotMetrics, setShowHotMetrics, dashboardFilters, truncado, teto } = useAdminData();

  return (
    <>
      {truncado && (
        <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          ⚠️ Os números abaixo foram calculados sobre os {teto.toLocaleString('pt-BR')} contatos
          mais recentes, não sobre a base inteira. O painel calcula no navegador e
          esse é o teto que ele aguenta.
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
