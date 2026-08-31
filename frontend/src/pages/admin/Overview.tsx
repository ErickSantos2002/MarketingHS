import { useAdminData } from '@/hooks/useAdminData';
import { OverviewTab } from '@/components/admin/dashboard/overview';

export default function Overview() {
  const { filteredLeads, allLeads, showHotMetrics, setShowHotMetrics, dashboardFilters } = useAdminData();

  return (
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
  );
}
