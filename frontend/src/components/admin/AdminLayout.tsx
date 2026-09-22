import { Outlet, useLocation } from 'react-router-dom';
import { AdminSidebar } from './AdminSidebar';
import { AIDataChat } from './AIDataChat';
import { AdminDataProvider } from '@/hooks/useAdminData';
import { GlobalFilters } from '@/components/admin/dashboard/GlobalFilters';
import { useAdminData } from '@/hooks/useAdminData';
import { LimiteDeErro } from './LimiteDeErro';

function AdminLayoutInner() {
  const { allLeads, filteredLeads, dashboardFilters } = useAdminData();
  const location = useLocation();

  // Rotas que não filtram leads: Contatos tem o próprio painel unificado;
  // Templates edita conteúdo de email; Segmentos e Campanhas definem a
  // própria audiência (regras do segmento), não a do dashboard.
  const HIDE_GLOBAL_FILTERS = ['/contacts', '/templates', '/segments', '/campaigns', '/settings', '/automations', '/experiments'];
  const hideGlobalFilters = HIDE_GLOBAL_FILTERS.some((p) => location.pathname.startsWith(p));

  return (
    <div className="flex min-h-screen bg-background">
      <AdminSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        {/* Global Filters — escondidos nas rotas de HIDE_GLOBAL_FILTERS */}
        {!hideGlobalFilters && (
          <div className="border-b border-border/30 bg-card/50 backdrop-blur-sm px-4 lg:px-6 py-3">
            <GlobalFilters
              filters={dashboardFilters.filters}
              onUpdateFilters={dashboardFilters.updateFilters}
              onResetFilters={dashboardFilters.resetFilters}
              onSetDatePreset={dashboardFilters.setDatePreset}
              onSetCustomDateRange={dashboardFilters.setCustomDateRange}
              activeFiltersCount={dashboardFilters.activeFiltersCount}
              availableTipos={[...new Set(allLeads.map(l => l.tipo).filter(Boolean))]}
              availableCampaigns={[...new Set(allLeads.map(l => l.utm_campaign || 'Sem campanha').filter(Boolean))]}
              availableFaturamentos={[...new Set(allLeads.map(l => l.faturamento).filter(Boolean) as string[])]}
              availableCargos={[...new Set(allLeads.map(l => l.cargo).filter(Boolean) as string[])]}
              availableSources={[...new Set(allLeads.map(l => l.utm_source || 'Sem origem').filter(Boolean))]}
              availablePresencas={[...new Set(allLeads.map(l => l.presenca).filter(Boolean) as string[])]}
              filteredCount={filteredLeads.length}
              totalCount={allLeads.length}
            />
          </div>
        )}

        {/* Page Content */}
        <main className="flex-1 p-4 lg:p-6">
          {/* Cada tela quebra sozinha, sem levar a casca junto. */}
          <LimiteDeErro area={location.pathname}>
            <Outlet />
          </LimiteDeErro>
        </main>
      </div>
      <LimiteDeErro area="AIDataChat">
        <AIDataChat />
      </LimiteDeErro>
    </div>
  );
}

export default function AdminLayout() {
  return (
    <AdminDataProvider>
      <AdminLayoutInner />
    </AdminDataProvider>
  );
}
