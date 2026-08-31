import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AdminSidebar } from './AdminSidebar';
import { AIDataChat } from './AIDataChat';
import { AdminDataProvider } from '@/hooks/useAdminData';
import { GlobalFilters } from '@/components/admin/dashboard/GlobalFilters';
import { useAdminData } from '@/hooks/useAdminData';

function AdminLayoutInner() {
  const { allLeads, filteredLeads, dashboardFilters } = useAdminData();
  const location = useLocation();

  // Radix (Dialog, Select, Sheet, Popover, DropdownMenu) renderiza em portal no
  // document.body — FORA da div abaixo. Sem a classe do tema no body, todo esse
  // conteúdo herdava o tema raiz, cuja --primary é vermelha, enquanto o admin usa
  // azul: por isso modais e selects saíam com a cor errada. As landing pages não
  // montam este layout, então continuam no tema raiz.
  useEffect(() => {
    document.body.classList.add('theme-dnmarketing');
    return () => document.body.classList.remove('theme-dnmarketing');
  }, []);
  // Rotas que não filtram leads: Contatos tem o próprio painel unificado;
  // Templates edita conteúdo de email; Segmentos e Campanhas definem a
  // própria audiência (regras do segmento), não a do dashboard.
  const HIDE_GLOBAL_FILTERS = ['/contacts', '/templates', '/segments', '/campaigns', '/settings', '/automations', '/experiments'];
  const hideGlobalFilters = HIDE_GLOBAL_FILTERS.some((p) => location.pathname.startsWith(p));

  return (
    <div className="flex min-h-screen bg-background theme-dnmarketing">
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
          <Outlet />
        </main>
      </div>
      <AIDataChat />
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
