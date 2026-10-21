import { useState, useMemo, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LeadDetailSheet } from '@/components/admin/LeadDetailSheet';
import { lerFicha } from '@/lib/leitura';
import type { Lead } from '@/hooks/useLeads';
import { useAdminData } from '@/hooks/useAdminData';
import { useContactsEnriched } from '@/hooks/useContactsEnriched';
import { ContactsToolbar } from '@/components/admin/contacts/ContactsToolbar';
import { ContactsFilterPanel, ActiveFilterChips } from '@/components/admin/contacts/ContactsFilterPanel';
import { ContactsTable } from '@/components/admin/contacts/ContactsTable';
import { ContactsBulkBar } from '@/components/admin/contacts/ContactsBulkBar';
import { LimiteDeErro } from '@/components/admin/LimiteDeErro';
import { DuplicatesPanel } from '@/components/admin/contacts/DuplicatesPanel';
import { Button } from '@/components/ui/button';
import { GitMerge, Trash2 } from 'lucide-react';
import { getUniqueValues } from '@/hooks/useDashboardFilters';
import type { DeletedView } from '@/hooks/useLeads';

// Link direto para a ficha: `/contacts?contato=<id>` — é o link que vai no
// aviso por e-mail ao comercial (nó "Avisar por e-mail").
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function Contacts() {
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectAll, setSelectAll] = useState(false);
  const [sortKey, setSortKey] = useState<string | null>('last_conversion_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const {
    filteredLeads, allEnrichedLeads, isLoading, refetch,
    columnSettings: { visibleColumns, updateColumns, columnOrder, updateOrder, resetOrder },
    legacyFilters, setLegacyFilters,
    dashboardFilters,
  } = useAdminData();

  const {
    enrichedLeads,
    allTags,
    contactsFilters,
    setContactsFilters,
    refetchTags,
    refetchEcosystem,
  } = useContactsEnriched(filteredLeads);

  const handleRefresh = () => {
    refetch();
    refetchTags();
    refetchEcosystem();
  };

  const search = legacyFilters.search || '';
  const [searchParams, setSearchParams] = useSearchParams();
  const contatoDoLink = searchParams.get('contato');
  const contatoValido = !!contatoDoLink && UUID.test(contatoDoLink);
  // Primeiro procura na lista já carregada (traz tags e ecossistema); se não
  // estiver nela (filtro, apagado, fora da página), lê a ficha do servidor.
  const leadDaLista = useMemo(
    () => (contatoValido ? allEnrichedLeads.find(l => l.id === contatoDoLink) ?? null : null),
    [allEnrichedLeads, contatoDoLink, contatoValido],
  );
  const { data: leadDoServidor, isError: linkQuebrado } = useQuery({
    queryKey: ['contato-do-link', contatoDoLink],
    queryFn: () => lerFicha<Lead>(contatoDoLink!).then(r => r.lead),
    enabled: contatoValido && !isLoading && !leadDaLista,
    retry: false,
  });
  const leadDoLink = leadDaLista ?? leadDoServidor ?? null;
  // Link de aviso antigo (contato apagado de vez) não pode falhar calado.
  useEffect(() => {
    if (linkQuebrado) toast.error('O contato deste link não foi encontrado.');
  }, [linkQuebrado]);
  const fecharLink = () => {
    setSearchParams(prev => {
      const novo = new URLSearchParams(prev);
      novo.delete('contato');
      return novo;
    }, { replace: true });
  };

  const handleSearchChange = (value: string) => {
    setLegacyFilters(prev => ({ ...prev, search: value || undefined }));
  };

  // Extract available options from all leads for multi-select filters
  const allLeadsRaw = allEnrichedLeads;
  const availableTipos = useMemo(() => getUniqueValues(allLeadsRaw as any[], 'tipo'), [allLeadsRaw]);
  const availableCampaigns = useMemo(() => getUniqueValues(allLeadsRaw as any[], 'utm_campaign'), [allLeadsRaw]);
  const availableSources = useMemo(() => getUniqueValues(allLeadsRaw as any[], 'utm_source'), [allLeadsRaw]);
  const availableUtmContents = useMemo(() => getUniqueValues(allLeadsRaw as any[], 'utm_content'), [allLeadsRaw]);
  const availableFaturamentos = useMemo(() => getUniqueValues(allLeadsRaw as any[], 'faturamento'), [allLeadsRaw]);
  const availableCargos = useMemo(() => getUniqueValues(allLeadsRaw as any[], 'cargo'), [allLeadsRaw]);

  // Unified active filter count (local + global)
  const activeFilterCount = useMemo(() => {
    let count = 0;
    // Local
    count += contactsFilters.statuses.length;
    count += contactsFilters.tagIds.length;
    if (contactsFilters.hasScheduled) count++;
    // Global
    count += dashboardFilters.activeFiltersCount;
    return count;
  }, [contactsFilters, dashboardFilters.activeFiltersCount]);

  const handleSort = useCallback((key: string) => {
    if (sortKey === key) {
      if (sortDir === 'desc') setSortDir('asc');
      else { setSortKey(null); setSortDir('desc'); }
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }, [sortKey, sortDir]);

  const selectedLeads = useMemo(
    () => selectAll ? enrichedLeads : enrichedLeads.filter(l => selectedIds.has(l.id)),
    [enrichedLeads, selectedIds, selectAll]
  );

  const handleBulkComplete = () => {
    setSelectedIds(new Set());
    setSelectAll(false);
    handleRefresh();
  };

  const handleResetAll = () => {
    setContactsFilters({ statuses: [], tagIds: [], hasScheduled: false });
    dashboardFilters.resetFilters();
    setSelectedIds(new Set());
    setSelectAll(false);
  };

  const deletedView: DeletedView = legacyFilters.deletedView ?? 'active';
  const handleDeletedViewChange = (v: DeletedView) => {
    setLegacyFilters(prev => ({ ...prev, deletedView: v }));
  };

  return (
    <div className="space-y-4">
      {deletedView !== 'active' && (
        <div className="flex items-center justify-end gap-3">
          <span className="text-xs text-[--on-tint-danger] flex items-center gap-1">
            <Trash2 className="h-3.5 w-3.5" />
            {deletedView === 'deleted' ? 'Exibindo apenas apagados' : 'Incluindo apagados'}
          </span>
        </div>
      )}

      {/* Toolbar */}
      <ContactsToolbar
        search={search}
        onSearchChange={handleSearchChange}
        activeFilterCount={activeFilterCount}
        filtersOpen={filtersOpen}
        onToggleFilters={() => setFiltersOpen(v => !v)}
        visibleColumns={visibleColumns}
        onColumnsChange={updateColumns}
        columnOrder={columnOrder}
        onOrderChange={updateOrder}
        onResetOrder={resetOrder}
        isLoading={isLoading}
        onRefresh={handleRefresh}
        leads={filteredLeads}
      />

      {/* Unified filter panel */}
      <ContactsFilterPanel
        contactsFilters={contactsFilters}
        onContactsChange={setContactsFilters}
        allTags={allTags}
        dashboardFilters={dashboardFilters.filters}
        onDashboardUpdate={dashboardFilters.updateFilters}
        onSetDatePreset={dashboardFilters.setDatePreset}
        onSetCustomDateRange={dashboardFilters.setCustomDateRange}
        onSetCreatedDatePreset={dashboardFilters.setCreatedDatePreset}
        onSetCustomCreatedDateRange={dashboardFilters.setCustomCreatedDateRange}
        onResetAll={handleResetAll}
        availableTipos={availableTipos}
        availableCampaigns={availableCampaigns}
        availableSources={availableSources}
        availableUtmContents={availableUtmContents}
        availableFaturamentos={availableFaturamentos}
        availableCargos={availableCargos}
        deletedView={deletedView}
        onDeletedViewChange={handleDeletedViewChange}
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
      />

      {/* Active filter chips (when panel closed) */}
      {!filtersOpen && activeFilterCount > 0 && (
        <ActiveFilterChips
          filters={contactsFilters}
          allTags={allTags}
          onChange={setContactsFilters}
          dashboardFilters={dashboardFilters.filters}
          onDashboardUpdate={dashboardFilters.updateFilters}
        />
      )}

      {/* Counter row */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Exibindo {enrichedLeads.length} de {filteredLeads.length} contatos</span>
        {sortKey && (
          <span>Ordenado por: {sortKey === 'last_conversion_date' ? 'última conversão' : sortKey} {sortDir === 'asc' ? '↑' : '↓'}</span>
        )}
      </div>

      {/* Bulk actions bar (above table) */}
      {/* Isolada aqui para que a explosão da barra de ações em massa não leve
          a TABELA junto — sem isto, a tela inteira de Contatos vira um
          cartão de erro. */}
      <LimiteDeErro area="ações em massa">
        <ContactsBulkBar
          selectedLeads={selectedLeads}
          selectAll={selectAll}
          allTags={allTags}
          onClear={() => { setSelectedIds(new Set()); setSelectAll(false); }}
          onComplete={handleBulkComplete}
          visibleColumns={visibleColumns}
          columnOrder={columnOrder}
        />
      </LimiteDeErro>

      {/* Duplicates */}
      {showDuplicates && <DuplicatesPanel />}

      {/* Table */}
      <ContactsTable
        leads={enrichedLeads}
        isLoading={isLoading}
        visibleColumns={visibleColumns}
        columnOrder={columnOrder}
        allTags={allTags}
        onRefresh={handleRefresh}
        selectedIds={selectedIds}
        onSelectionChange={(ids) => { setSelectedIds(ids); setSelectAll(false); }}
        selectAll={selectAll}
        onSelectAllChange={setSelectAll}
        totalFiltered={enrichedLeads.length}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={handleSort}
      />


      {/* Ficha aberta pelo link ?contato=<id> */}
      {contatoValido && (
        <LeadDetailSheet
          lead={leadDoLink as Lead | null}
          open={!!leadDoLink}
          onOpenChange={(o) => { if (!o) fecharLink(); }}
          allTags={allTags}
          onDataChanged={handleRefresh}
        />
      )}

      {/* Duplicates button */}
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setShowDuplicates(v => !v)} className="text-xs">
          <GitMerge className="h-3.5 w-3.5 mr-1.5" />
          {showDuplicates ? 'Fechar duplicatas' : 'Ver duplicatas'}
        </Button>
      </div>
    </div>
  );
}
