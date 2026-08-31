import { useState, useMemo, useCallback } from 'react';
import { useAdminData } from '@/hooks/useAdminData';
import { useContactsEnriched } from '@/hooks/useContactsEnriched';
import { ContactsToolbar } from '@/components/admin/contacts/ContactsToolbar';
import { ContactsFilterPanel, ActiveFilterChips } from '@/components/admin/contacts/ContactsFilterPanel';
import { ContactsTable } from '@/components/admin/contacts/ContactsTable';
import { ContactsBulkBar } from '@/components/admin/contacts/ContactsBulkBar';
import { DuplicatesPanel } from '@/components/admin/contacts/DuplicatesPanel';
import { Button } from '@/components/ui/button';
import { GitMerge, Trash2 } from 'lucide-react';
import { getUniqueValues } from '@/hooks/useDashboardFilters';
import type { DeletedView } from '@/hooks/useLeads';

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
    if (contactsFilters.hasNexus) count++;
    if (contactsFilters.hasMentoria) count++;
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
    setContactsFilters({ statuses: [], tagIds: [], hasNexus: false, hasMentoria: false, hasScheduled: false });
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
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Contatos</h1>
        {deletedView !== 'active' && (
          <span className="text-xs text-destructive flex items-center gap-1">
            <Trash2 className="h-3.5 w-3.5" />
            {deletedView === 'deleted' ? 'Exibindo apenas apagados' : 'Incluindo apagados'}
          </span>
        )}
      </div>

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
      <ContactsBulkBar
        selectedLeads={selectedLeads}
        selectAll={selectAll}
        allTags={allTags}
        onClear={() => { setSelectedIds(new Set()); setSelectAll(false); }}
        onComplete={handleBulkComplete}
        visibleColumns={visibleColumns}
        columnOrder={columnOrder}
      />

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
