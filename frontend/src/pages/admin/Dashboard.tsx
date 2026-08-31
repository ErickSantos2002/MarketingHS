import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useLeads, type LeadsFilters } from '@/hooks/useLeads';
import { LeadsFilters as FiltersComponent } from '@/components/admin/LeadsFilters';
import { LeadsTable } from '@/components/admin/LeadsTable';
import { ColumnSelector, useColumnSettings } from '@/components/admin/ColumnSelector';
import { LeadsExport } from '@/components/admin/LeadsExport';
import { AIAnalysis } from '@/components/admin/AIAnalysis';
import { PagesManagement } from '@/components/admin/pages/PagesManagement';
import { LeadsImport } from '@/components/admin/LeadsImport';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LogOut, RefreshCw, FileText, Upload, BarChart3, Users, Lightbulb, Target, Database, Megaphone, Sparkles } from 'lucide-react';
import { DniaLogo } from '@/components/admin/DniaLogo';
import { AIDataChat } from '@/components/admin/AIDataChat';

// Dashboard components
import { GlobalFilters } from '@/components/admin/dashboard/GlobalFilters';
import { OverviewTab } from '@/components/admin/dashboard/overview';
import { ProfileTab } from '@/components/admin/dashboard/profile';
import { ChallengesTab } from '@/components/admin/dashboard/challenges';
import { TacticalTab } from '@/components/admin/dashboard/tactical';
import { OperationalTab } from '@/components/admin/dashboard/operational';
import { InsightsTab } from '@/components/admin/dashboard/insights';
import { useDashboardFilters, applyFilters } from '@/hooks/useDashboardFilters';
import { useLeadQualification } from '@/hooks/useLeadQualification';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [legacyFilters, setLegacyFilters] = useState<LeadsFilters>({});
  const [showHotMetrics, setShowHotMetrics] = useState(false);
  const { visibleColumns, updateColumns, columnOrder, updateOrder, resetOrder } = useColumnSettings();
  const { leads, allLeads, isLoading, refetch } = useLeads(legacyFilters);
  
  // Dashboard filters
  const dashboardFilters = useDashboardFilters();
  
  // IMPORTANT: First enrich ALL leads with qualification data, then apply filters
  // This ensures the qualification filter (Hot/Warm/Raw) works correctly
  // Date filter now checks BOTH created_at and last_conversion_date for reconversion visibility
  const { enrichedLeads: allEnrichedLeads } = useLeadQualification(allLeads);
  const filteredLeads = applyFilters(allEnrichedLeads, dashboardFilters.filters);

  const handleSignOut = async () => {
    await signOut();
    navigate('/adnia/login');
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card/80 backdrop-blur-lg sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <DniaLogo className="h-[20.5px]" />
            <span className="text-lg font-semibold text-gradient-dnia">
              Analytics Dashboard
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground hidden sm:inline">
              {user?.email}
            </span>
            <Button variant="outline" size="sm" onClick={handleSignOut}>
              <LogOut className="h-4 w-4 mr-2" />
              Sair
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 space-y-6">
        {/* Main Tabs */}
        <Tabs defaultValue="overview" className="space-y-6">
          <div className="flex flex-col gap-4">
            <TabsList className="w-full justify-start flex-wrap h-auto gap-1 p-1 bg-muted/30">
              <TabsTrigger value="overview" className="gap-2 data-[state=active]:bg-gradient-to-r data-[state=active]:from-accent data-[state=active]:to-primary data-[state=active]:text-white">
                <BarChart3 className="h-4 w-4" />
                <span className="hidden sm:inline">Visão Geral</span>
              </TabsTrigger>
              <TabsTrigger value="profile" className="gap-2 data-[state=active]:bg-gradient-to-r data-[state=active]:from-accent data-[state=active]:to-primary data-[state=active]:text-white">
                <Users className="h-4 w-4" />
                <span className="hidden sm:inline">Perfil</span>
              </TabsTrigger>
              <TabsTrigger value="challenges" className="gap-2 data-[state=active]:bg-gradient-to-r data-[state=active]:from-accent data-[state=active]:to-primary data-[state=active]:text-white">
                <Lightbulb className="h-4 w-4" />
                <span className="hidden sm:inline">Desafios</span>
              </TabsTrigger>
              <TabsTrigger value="tactical" className="gap-2 data-[state=active]:bg-gradient-to-r data-[state=active]:from-accent data-[state=active]:to-primary data-[state=active]:text-white">
                <Target className="h-4 w-4" />
                <span className="hidden sm:inline">Tático</span>
              </TabsTrigger>
              <TabsTrigger value="operational" className="gap-2 data-[state=active]:bg-gradient-to-r data-[state=active]:from-accent data-[state=active]:to-primary data-[state=active]:text-white">
                <Megaphone className="h-4 w-4" />
                <span className="hidden sm:inline">Operacional</span>
              </TabsTrigger>
              <TabsTrigger value="insights" className="gap-2 data-[state=active]:bg-gradient-to-r data-[state=active]:from-accent data-[state=active]:to-primary data-[state=active]:text-white">
                <Sparkles className="h-4 w-4" />
                <span className="hidden sm:inline">Insights</span>
              </TabsTrigger>
              <TabsTrigger value="leads" className="gap-2 data-[state=active]:bg-gradient-to-r data-[state=active]:from-accent data-[state=active]:to-primary data-[state=active]:text-white">
                <Database className="h-4 w-4" />
                <span className="hidden sm:inline">Leads</span>
              </TabsTrigger>
              <TabsTrigger value="import" className="gap-2 data-[state=active]:bg-gradient-to-r data-[state=active]:from-accent data-[state=active]:to-primary data-[state=active]:text-white">
                <Upload className="h-4 w-4" />
                <span className="hidden sm:inline">Importar</span>
              </TabsTrigger>
              <TabsTrigger value="pages" className="gap-2 data-[state=active]:bg-gradient-to-r data-[state=active]:from-accent data-[state=active]:to-primary data-[state=active]:text-white">
                <FileText className="h-4 w-4" />
                <span className="hidden sm:inline">Páginas</span>
              </TabsTrigger>
            </TabsList>

            {/* Global Filters */}
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

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
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
          </TabsContent>

          {/* Profile Tab */}
          <TabsContent value="profile" className="space-y-6">
            <ProfileTab leads={filteredLeads} />
          </TabsContent>

          {/* Challenges Tab */}
          <TabsContent value="challenges" className="space-y-6">
            <ChallengesTab leads={filteredLeads} />
          </TabsContent>

          {/* Tactical Tab */}
          <TabsContent value="tactical" className="space-y-6">
            <TacticalTab leads={filteredLeads} />
          </TabsContent>

          {/* Operational Tab */}
          <TabsContent value="operational" className="space-y-6">
            <OperationalTab leads={filteredLeads} />
          </TabsContent>

          {/* Insights Tab */}
          <TabsContent value="insights" className="space-y-6">
            <InsightsTab leads={filteredLeads} />
          </TabsContent>

          {/* Legacy Leads Tab */}
          <TabsContent value="leads" className="space-y-6">
            <div className="flex flex-col lg:flex-row gap-4 justify-between">
              <FiltersComponent filters={legacyFilters} onFiltersChange={setLegacyFilters} />
              <div className="flex gap-2">
                <ColumnSelector visibleColumns={visibleColumns} onColumnsChange={updateColumns} columnOrder={columnOrder} onOrderChange={updateOrder} onResetOrder={resetOrder} />
                <Button variant="outline" onClick={refetch} disabled={isLoading}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                  Atualizar
                </Button>
                <LeadsExport leads={filteredLeads} />
              </div>
            </div>
            <LeadsTable leads={filteredLeads} isLoading={isLoading} visibleColumns={visibleColumns} columnOrder={columnOrder} />
          </TabsContent>

          {/* Import Tab */}
          <TabsContent value="import">
            <LeadsImport />
          </TabsContent>

          {/* Pages Tab */}
          <TabsContent value="pages">
            <PagesManagement />
          </TabsContent>
        </Tabs>
      </main>

      {/* AI Data Chat */}
      <AIDataChat />
    </div>
  );
}
