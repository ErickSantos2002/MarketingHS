import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, SlidersHorizontal, Settings2, RefreshCw, Download } from 'lucide-react';
import { ColumnSelector } from '@/components/admin/ColumnSelector';
import { ContactsExport } from '@/components/admin/contacts/ContactsExport';
import type { Lead } from '@/hooks/useLeads';

interface ContactsToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  activeFilterCount: number;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  visibleColumns: string[];
  onColumnsChange: (columns: string[]) => void;
  columnOrder: string[];
  onOrderChange: (order: string[]) => void;
  onResetOrder: () => void;
  isLoading: boolean;
  onRefresh: () => void;
  leads: Lead[];
}

export function ContactsToolbar({
  search,
  onSearchChange,
  activeFilterCount,
  filtersOpen,
  onToggleFilters,
  visibleColumns,
  onColumnsChange,
  columnOrder,
  onOrderChange,
  onResetOrder,
  isLoading,
  onRefresh,
  leads,
}: ContactsToolbarProps) {
  return (
    // No celular a busca ocupa a linha inteira e os botões descem para a de
    // baixo; sem o `flex-wrap` a barra empurrava a página para 542 px em
    // 390 e o CSV saía da tela. A partir de `sm` fica tudo numa linha só,
    // como sempre foi.
    <div className="flex flex-wrap items-center gap-2">
      {/* Search */}
      <div className="relative w-full sm:w-auto sm:flex-1 sm:min-w-[200px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Buscar por nome, email, telefone..."
          className="pl-9"
        />
      </div>

      {/* Filters toggle */}
      <Button
        variant={filtersOpen ? 'default' : 'outline'}
        size="sm"
        className="h-9 gap-1.5 shrink-0"
        onClick={onToggleFilters}
        style={filtersOpen ? { backgroundColor: 'var(--color-primary-600)' } : undefined}
      >
        <SlidersHorizontal className="h-4 w-4" />
        Filtros
        {activeFilterCount > 0 && (
          <span
            className="inline-flex items-center justify-center min-w-[20px] rounded-full text-xs font-bold px-1.5 py-0.5"
            style={{ backgroundColor: 'var(--color-primary-600)', color: 'var(--text-on-primary)' }}
          >
            {activeFilterCount}
          </span>
        )}
      </Button>

      {/* Columns */}
      <ColumnSelector
        visibleColumns={visibleColumns}
        onColumnsChange={onColumnsChange}
        columnOrder={columnOrder}
        onOrderChange={onOrderChange}
        onResetOrder={onResetOrder}
      />

      {/* Refresh */}
      <Button variant="outline" size="sm" className="h-9 shrink-0" onClick={onRefresh} disabled={isLoading}>
        <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
      </Button>

      {/* Export */}
      <ContactsExport leads={leads} visibleColumns={visibleColumns} columnOrder={columnOrder} />
    </div>
  );
}
