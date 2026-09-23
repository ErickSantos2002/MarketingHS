import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Menu, LogOut } from 'lucide-react';
import { AdminSidebar } from './AdminSidebar';
import { AIDataChat } from './AIDataChat';
import { ChaveDeTema } from './ChaveDeTema';
import { Button } from '@/components/ui/button';
import { AdminDataProvider, useAdminData } from '@/hooks/useAdminData';
import { GlobalFilters } from '@/components/admin/dashboard/GlobalFilters';
import { useAuth } from '@/hooks/useAuth';
import { LimiteDeErro } from './LimiteDeErro';

// Rota → título da topbar. Reúne os rótulos que a sidebar já usa e acrescenta
// as telas sem item de menu próprio (edição, configuração, detalhe). A tela
// duplica o próprio título no corpo nesta fase — sai tela a tela na Fase 2.
const TITULOS_ROTA: { padrao: RegExp; titulo: string }[] = [
  { padrao: /^\/$/, titulo: 'Visão Geral' },
  { padrao: /^\/analytics(\/.*)?$/, titulo: 'Analytics' },
  { padrao: /^\/contacts(\/.*)?$/, titulo: 'Contatos' },
  { padrao: /^\/pages\/[^/]+\/edit$/, titulo: 'Editar página' },
  { padrao: /^\/pages(\/.*)?$/, titulo: 'Páginas' },
  { padrao: /^\/import(\/.*)?$/, titulo: 'Importar' },
  { padrao: /^\/settings(\/.*)?$/, titulo: 'Configurações' },
  { padrao: /^\/segments(\/.*)?$/, titulo: 'Segmentos' },
  { padrao: /^\/campaigns(\/.*)?$/, titulo: 'Campanhas' },
  { padrao: /^\/automations\/fluxos\/[^/]+$/, titulo: 'Fluxo' },
  { padrao: /^\/automations(\/.*)?$/, titulo: 'Automações' },
  { padrao: /^\/templates\/new$/, titulo: 'Novo template' },
  { padrao: /^\/templates\/[^/]+\/edit$/, titulo: 'Editar template' },
  { padrao: /^\/templates(\/.*)?$/, titulo: 'Templates' },
  { padrao: /^\/experiments\/setup$/, titulo: 'Configurar teste A/B' },
  { padrao: /^\/experiments\/[^/]+$/, titulo: 'Teste A/B' },
  { padrao: /^\/experiments(\/.*)?$/, titulo: 'Testes A/B' },
];

function tituloDaRota(pathname: string): string {
  return TITULOS_ROTA.find(({ padrao }) => padrao.test(pathname))?.titulo ?? '';
}

function AdminLayoutInner() {
  const { allLeads, filteredLeads, dashboardFilters } = useAdminData();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Fecha o menu do celular ao navegar — comportamento herdado da sidebar,
  // que perdeu o botão que abria o menu (foi para a topbar) mas não o estado.
  useEffect(() => { setMobileOpen(false); }, [location.pathname, location.search]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  // Rotas que não filtram leads: Contatos tem o próprio painel unificado;
  // Templates edita conteúdo de email; Segmentos e Campanhas definem a
  // própria audiência (regras do segmento), não a do dashboard.
  const HIDE_GLOBAL_FILTERS = ['/contacts', '/templates', '/segments', '/campaigns', '/settings', '/automations', '/experiments'];
  const hideGlobalFilters = HIDE_GLOBAL_FILTERS.some((p) => location.pathname.startsWith(p));

  const titulo = tituloDaRota(location.pathname);

  return (
    <div className="flex min-h-screen bg-background">
      <AdminSidebar mobileOpen={mobileOpen} onMobileOpenChange={setMobileOpen} />
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar — sticky: sem isso, Sair e o menu do celular rolam para
            fora da tela em listas longas (antes, os dois eram sempre
            visíveis: o rodapé da sidebar era sticky e o hambúrguer, fixed). */}
        <div className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-surface px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden"
              aria-label="Abrir menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <h1 className="truncate text-base font-semibold text-conteudo-heading">{titulo}</h1>
          </div>
          <div className="flex items-center gap-4">
            <ChaveDeTema />
            <span className="hidden text-sm text-conteudo sm:inline">{user?.email}</span>
            <Button variant="ghost" size="icon" onClick={handleSignOut} aria-label="Sair">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Global Filters — escondidos nas rotas de HIDE_GLOBAL_FILTERS */}
        {!hideGlobalFilters && (
          <div className="border-b border-border bg-surface px-6 py-3">
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
