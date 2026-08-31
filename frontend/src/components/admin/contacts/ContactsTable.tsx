import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import {
  ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight,
  Eye, MoreHorizontal, Flame, RefreshCw, Trash2, CalendarCheck,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { Lead } from '@/hooks/useLeads';
import { ALL_COLUMNS } from '@/components/admin/ColumnSelector';
import { LeadDetailSheet } from '@/components/admin/LeadDetailSheet';
import type { EnrichedLead, TagInfo } from '@/hooks/useContactsEnriched';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

interface ContactsTableProps {
  leads: (Lead | EnrichedLead)[];
  isLoading: boolean;
  visibleColumns: string[];
  columnOrder: string[];
  allTags?: TagInfo[];
  onRefresh?: () => void;
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  selectAll?: boolean;
  onSelectAllChange?: (v: boolean) => void;
  totalFiltered?: number;
  sortKey: string | null;
  sortDir: 'asc' | 'desc';
  onSort: (key: string) => void;
}

const ITEMS_PER_PAGE = 15;

function asEnriched(lead: Lead | EnrichedLead): EnrichedLead {
  return {
    ...lead,
    dnia_id: (lead as any).dnia_id ?? null,
    phone_normalized: (lead as any).phone_normalized ?? null,
    status: (lead as any).status ?? 'Lead',
    ecosystem: (lead as any).ecosystem,
    tags: (lead as any).tags ?? [],
  };
}

const STATUS_DOT_COLORS: Record<string, string> = {
  'Lead': '#888780',
  'Lead Qualificado': '#185FA5',
  'MQL - Reunião agendada': '#534AB7',
  'SQL - Em negociação': '#B7861F',
  'Venda realizada': '#3B6D11',
  'Em contrato': '#0E7C66',
  'Iniciado': '#5A2E91',
};

const ETIQUETA_STYLES: Record<string, { bg: string; color: string }> = {
  hotlead: { bg: '#FCEBEB', color: '#A32D2D' },
  warm: { bg: '#FAEEDA', color: '#854F0B' },
};

const isReconversion = (lead: Lead) => {
  if (!lead.last_conversion_date || !lead.created_at) return false;
  const created = new Date(lead.created_at).getTime();
  const lastConversion = new Date(lead.last_conversion_date).getTime();
  return Math.abs(lastConversion - created) > 60000;
};

const formatRelativeDate = (dateString: string | null) => {
  if (!dateString) return '-';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) return `${diffMins}min atrás`;
  if (diffHours < 24) return `${diffHours}h atrás`;
  if (diffDays < 7) return `${diffDays}d atrás`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}sem atrás`;
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

const formatDate = (dateString: string | null) => {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
};

// Columns that are NOT sortable
const NON_SORTABLE = new Set(['ecosystem', 'tags']);

// Get label from ALL_COLUMNS
const colLabel = (key: string) => ALL_COLUMNS.find(c => c.key === key)?.label || key;

export function ContactsTable({
  leads: rawLeads,
  isLoading,
  visibleColumns,
  columnOrder,
  allTags = [],
  onRefresh,
  selectedIds,
  onSelectionChange,
  selectAll = false,
  onSelectAllChange,
  totalFiltered,
  sortKey,
  sortDir,
  onSort,
}: ContactsTableProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedLead, setSelectedLead] = useState<EnrichedLead | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EnrichedLead | null>(null);
  const [deleting, setDeleting] = useState(false);

  const enrichedLeads = useMemo(() => rawLeads.map(asEnriched), [rawLeads]);

  // Ordered visible columns
  const orderedVisibleCols = useMemo(() => {
    return columnOrder.filter(k => visibleColumns.includes(k));
  }, [visibleColumns, columnOrder]);

  const leads = useMemo(() => {
    if (!sortKey) return enrichedLeads;
    return [...enrichedLeads].sort((a, b) => {
      let av = (a as unknown as Record<string, unknown>)[sortKey];
      let bv = (b as unknown as Record<string, unknown>)[sortKey];
      // For last_conversion_date, fall back to created_at when null so leads
      // without conversion history still sort by their creation date.
      if (sortKey === 'last_conversion_date') {
        if (av == null) av = (a as unknown as Record<string, unknown>).created_at;
        if (bv == null) bv = (b as unknown as Record<string, unknown>).created_at;
      }
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const aStr = String(av);
      const bStr = String(bv);
      if (sortKey.includes('date') || sortKey === 'created_at' || sortKey === 'updated_at' || sortKey === 'data_interesse' || sortKey === 'last_conversion_date') {
        const aTime = new Date(aStr).getTime();
        const bTime = new Date(bStr).getTime();
        if (!isNaN(aTime) && !isNaN(bTime)) return sortDir === 'asc' ? aTime - bTime : bTime - aTime;
      }
      const cmp = aStr.localeCompare(bStr, 'pt-BR', { sensitivity: 'base', numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [enrichedLeads, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(leads.length / ITEMS_PER_PAGE));
  // Clamp current page when the result set shrinks (e.g. after applying a filter)
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(1);
  }, [totalPages, currentPage]);
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * ITEMS_PER_PAGE;
  const paginatedLeads = leads.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const toggleSelect = useCallback((id: string) => {
    if (selectAll) {
      // exiting selectAll: keep only this one toggled off → start with all ids except this
      const next = new Set(leads.map(l => l.id));
      next.delete(id);
      onSelectAllChange?.(false);
      onSelectionChange(next);
      return;
    }
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  }, [selectedIds, onSelectionChange, selectAll, onSelectAllChange, leads]);

  const toggleSelectAll = useCallback(() => {
    if (selectAll) {
      onSelectAllChange?.(false);
      onSelectionChange(new Set());
      return;
    }
    const pageIds = paginatedLeads.map(l => l.id);
    const allSelected = pageIds.every(id => selectedIds.has(id));
    const next = new Set(selectedIds);
    if (allSelected) {
      pageIds.forEach(id => next.delete(id));
    } else {
      pageIds.forEach(id => next.add(id));
    }
    onSelectionChange(next);
  }, [paginatedLeads, selectedIds, onSelectionChange]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-muted-foreground">Carregando contatos...</p>
      </div>
    );
  }

  if (leads.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-muted-foreground">Nenhum contato encontrado</p>
      </div>
    );
  }

  const allPageSelected = selectAll || (paginatedLeads.length > 0 && paginatedLeads.every(l => selectedIds.has(l.id)));
  const somePageSelected = selectAll || paginatedLeads.some(l => selectedIds.has(l.id));
  const total = totalFiltered ?? leads.length;
  const showSelectAllPrompt = !selectAll && allPageSelected && total > paginatedLeads.length;

  const handleCopyEmail = (email: string | null) => {
    if (!email) return;
    navigator.clipboard.writeText(email);
    toast.success('Email copiado!');
  };

  const getPageNumbers = () => {
    const pages: (number | '...')[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push('...');
      for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
        pages.push(i);
      }
      if (currentPage < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }
    return pages;
  };

  return (
    <TooltipProvider>
      <div className="space-y-0">
        {(showSelectAllPrompt || selectAll) && (
          <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 mb-2 text-xs flex items-center justify-center gap-2">
            {selectAll ? (
              <>
                <span>Todos os <strong>{total}</strong> contatos filtrados estão selecionados.</span>
                <button
                  type="button"
                  className="text-primary font-medium hover:underline"
                  onClick={() => { onSelectAllChange?.(false); onSelectionChange(new Set()); }}
                >
                  Limpar seleção
                </button>
              </>
            ) : (
              <>
                <span>Os <strong>{paginatedLeads.length}</strong> contatos desta página estão selecionados.</span>
                <button
                  type="button"
                  className="text-primary font-medium hover:underline"
                  onClick={() => onSelectAllChange?.(true)}
                >
                  Selecionar todos os {total} contatos filtrados
                </button>
              </>
            )}
          </div>
        )}
        <div className="rounded-lg border bg-card overflow-hidden">

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[36px] min-w-[36px] px-3">
                    <Checkbox
                      checked={allPageSelected}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Selecionar todos"
                      className={`h-4 w-4 bg-muted border-foreground/50 ${somePageSelected && !allPageSelected ? 'opacity-50' : ''}`}
                    />
                  </TableHead>
                  {orderedVisibleCols.map(colKey => (
                    NON_SORTABLE.has(colKey) ? (
                      <TableHead key={colKey} className="whitespace-nowrap">
                        {colLabel(colKey)}
                      </TableHead>
                    ) : (
                      <SortableHead
                        key={colKey}
                        sortKey={sortKey}
                        sortDir={sortDir}
                        onSort={onSort}
                        colKey={colKey}
                        label={colLabel(colKey)}
                      />
                    )
                  ))}
                  <TableHead className="w-[70px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedLeads.map(lead => {
                  const isSelected = selectAll || selectedIds.has(lead.id);
                  const isHovered = hoveredRow === lead.id;

                  return (
                    <TableRow
                      key={lead.id}
                      className="cursor-pointer transition-colors group"
                      style={{ backgroundColor: isSelected ? 'hsl(243 40% 30% / 0.3)' : undefined }}
                      onMouseEnter={() => setHoveredRow(lead.id)}
                      onMouseLeave={() => setHoveredRow(null)}
                      onClick={() => { setSelectedLead(lead); setModalOpen(true); }}
                    >
                      <TableCell
                        className="px-3"
                        onClick={(e) => { e.stopPropagation(); toggleSelect(lead.id); }}
                      >
                        <Checkbox
                          checked={isSelected}
                          tabIndex={-1}
                          className="h-4 w-4 bg-muted border-foreground/50"
                        />
                      </TableCell>

                      {orderedVisibleCols.map(colKey => (
                        <TableCell key={colKey}>
                          <CellRenderer colKey={colKey} lead={lead} />
                        </TableCell>
                      ))}

                      {/* Actions */}
                      <TableCell>
                        <div className={`flex items-center gap-1 transition-opacity ${isHovered ? 'opacity-100' : 'opacity-0'}`}>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-[26px] w-[26px] p-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedLead(lead);
                              setModalOpen(true);
                            }}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-[26px] w-[26px] p-0"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => { setSelectedLead(lead); setModalOpen(true); }}>
                                Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleCopyEmail(lead.email)}>
                                Copiar email
                              </DropdownMenuItem>
                              {lead.ecosystem?.nexus_contact_id && (
                                <DropdownMenuItem onClick={() => window.open(`https://nexus.dnia.ai/crm/contacts/${lead.ecosystem?.nexus_contact_id}`, '_blank')}>
                                  Ver no Nexus
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={(e) => { e.stopPropagation(); setDeleteTarget(lead); }}
                              >
                                <Trash2 className="h-3.5 w-3.5 mr-2" />
                                Apagar contato
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <p className="text-xs text-muted-foreground">
                Página {currentPage} de {totalPages}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost" size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                {getPageNumbers().map((page, i) =>
                  page === '...' ? (
                    <span key={`dots-${i}`} className="px-1 text-xs text-muted-foreground">…</span>
                  ) : (
                    <Button
                      key={page}
                      variant={page === currentPage ? 'default' : 'ghost'}
                      size="sm"
                      className="h-7 w-7 p-0 text-xs"
                      style={page === currentPage ? { backgroundColor: '#534AB7' } : undefined}
                      onClick={() => setCurrentPage(page as number)}
                    >
                      {page}
                    </Button>
                  )
                )}
                <Button
                  variant="ghost" size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>

        <LeadDetailSheet
          lead={selectedLead}
          open={modalOpen}
          onOpenChange={setModalOpen}
          allTags={allTags}
          onDataChanged={onRefresh}
        />

        {/* Delete confirmation dialog */}
        <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Apagar contato</AlertDialogTitle>
              <AlertDialogDescription>
                {deleteTarget?.ecosystem?.nexus_contact_id
                  ? `Este contato (${deleteTarget?.nome || deleteTarget?.email || 'sem nome'}) também será removido do Nexus. Esta ação não pode ser desfeita.`
                  : `Tem certeza que deseja apagar "${deleteTarget?.nome || deleteTarget?.email || 'este contato'}"? Esta ação não pode ser desfeita.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                disabled={deleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={async (e) => {
                  e.preventDefault();
                  if (!deleteTarget) return;
                  setDeleting(true);
                  try {
                    const { data, error } = await supabase.functions.invoke('delete-contact', {
                      body: { lead_id: deleteTarget.id },
                    });
                    if (error) throw new Error(error.message);
                    if (data?.error) throw new Error(data.error);
                    toast.success(
                      data?.nexus_deleted
                        ? 'Contato apagado do sistema e do Nexus'
                        : 'Contato apagado com sucesso'
                    );
                    setDeleteTarget(null);
                    onRefresh?.();
                  } catch (err: any) {
                    toast.error(`Erro ao apagar: ${err.message || 'Erro desconhecido'}`);
                  }
                  setDeleting(false);
                }}
              >
                {deleting ? 'Apagando...' : 'Apagar'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}

/* ── Cell renderer ── */
function CellRenderer({ colKey, lead }: { colKey: string; lead: EnrichedLead }) {
  const val = (lead as unknown as Record<string, any>)[colKey];
  const score = (lead as any).lead_score ?? 0;

  switch (colKey) {
    case 'nome':
      return (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              {lead.etiqueta === 'hotlead' && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Flame className="h-3.5 w-3.5 text-orange-500 flex-shrink-0" />
                  </TooltipTrigger>
                  <TooltipContent>Hot Lead (ICP + Decisor)</TooltipContent>
                </Tooltip>
              )}
              {lead.dnia_id && lead.ecosystem?.hasScheduledMeeting && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <CalendarCheck className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                  </TooltipTrigger>
                  <TooltipContent>Reunião/Demo agendada (em aberto)</TooltipContent>
                </Tooltip>
              )}

              {isReconversion(lead) && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <RefreshCw className="h-3.5 w-3.5 text-cyan-500 flex-shrink-0" />
                  </TooltipTrigger>
                  <TooltipContent>Lead Reconvertido</TooltipContent>
                </Tooltip>
              )}
              <span className="font-medium text-sm truncate">{lead.nome || '-'}</span>
            </div>
            <div className="text-[11px] text-muted-foreground truncate mt-0.5">
              {[lead.cargo, lead.email].filter(Boolean).join(' · ') || '-'}
            </div>
          </div>
        </div>
      );

    case 'etiqueta':
      return lead.etiqueta ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
              style={{
                backgroundColor: ETIQUETA_STYLES[lead.etiqueta]?.bg || 'hsl(var(--secondary))',
                color: ETIQUETA_STYLES[lead.etiqueta]?.color || 'hsl(var(--secondary-foreground))',
              }}
            >
              {lead.etiqueta}
            </span>
          </TooltipTrigger>
          <TooltipContent>Score: {score}</TooltipContent>
        </Tooltip>
      ) : (
        <span className="text-muted-foreground text-xs">-</span>
      );

    case 'tipo':
      if (!val) return <span className="text-xs text-muted-foreground">-</span>;
      {
        const words = String(val).split(' ');
        if (words.length > 1) {
          return (
            <div className="text-xs leading-tight max-w-[90px]">
              <div>{words[0]}</div>
              <div className="text-muted-foreground">{words.slice(1).join(' ')}</div>
            </div>
          );
        }
        return <span className="text-xs">{val}</span>;
      }

    case 'status':
      return (
        <div className="flex items-center gap-2">
          <div
            className="w-[7px] h-[7px] rounded-full flex-shrink-0"
            style={{ backgroundColor: STATUS_DOT_COLORS[lead.status || 'Lead'] || '#888780' }}
          />
          <span className="text-xs">{lead.status || 'Lead'}</span>
        </div>
      );

    case 'lead_score':
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2 min-w-[80px]">
              <span
                className="text-xs font-semibold w-6 text-right"
                style={{
                  color: score >= 70 ? '#A32D2D' : score >= 40 ? '#854F0B' : '#888780',
                }}
              >
                {score}
              </span>
              <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(score, 100)}%`,
                    backgroundColor: score >= 70 ? '#A32D2D' : score >= 40 ? '#854F0B' : '#888780',
                  }}
                />
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-xs">
            Score: {score}pts → {score >= 70 ? 'Hotlead' : score >= 40 ? 'Warm' : 'Raw'}
          </TooltipContent>
        </Tooltip>
      );

    case 'ecosystem':
      return <EcosystemBadges lead={lead} />;

    case 'tags':
      return (
        <div className="flex flex-wrap gap-1">
          {(lead.tags || []).length > 0
            ? lead.tags!.map(t => (
                <Badge key={t.id} variant="secondary" className="text-[10px] px-1.5 py-0">
                  {t.name}
                </Badge>
              ))
            : <span className="text-muted-foreground text-xs">-</span>
          }
        </div>
      );

    case 'last_conversion_date': {
      const dateVal = lead.last_conversion_date;
      if (!dateVal) return <span className="text-xs text-muted-foreground">-</span>;
      const d = new Date(dateVal);
      return (
        <div className="leading-tight">
          <div className="text-xs">{d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })}</div>
          <div className="text-[10px] text-muted-foreground">{d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
      );
    }

    case 'created_at':
    case 'data_interesse': {
      if (!val) return <span className="text-xs text-muted-foreground">-</span>;
      const d = new Date(val);
      return (
        <div className="leading-tight">
          <div className="text-xs">{d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })}</div>
          <div className="text-[10px] text-muted-foreground">{d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
      );
    }

    case 'interesse_ecossistema':
    case 'interesse_mtia':
    case 'interesse_formacao':
      return <span className="text-xs">{val ? 'Sim' : 'Não'}</span>;

    default:
      return <span className="text-xs truncate max-w-[200px] block">{val != null ? String(val) : '-'}</span>;
  }
}

/* ── Sortable header cell ── */
function SortableHead({
  sortKey, sortDir, onSort, colKey, label, className = '',
}: {
  sortKey: string | null;
  sortDir: 'asc' | 'desc';
  onSort: (key: string) => void;
  colKey: string;
  label: string;
  className?: string;
}) {
  const isSorted = sortKey === colKey;
  const Icon = isSorted ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead
      className={`cursor-pointer select-none hover:bg-muted/50 whitespace-nowrap ${className}`}
      onClick={() => onSort(colKey)}
    >
      <div className="flex items-center gap-1">
        {label}
        <Icon className={`h-3 w-3 flex-shrink-0 ${isSorted ? 'text-foreground' : 'text-muted-foreground/40'}`} />
      </div>
    </TableHead>
  );
}

/* ── Ecosystem badges ── */
function EcosystemBadges({ lead }: { lead: EnrichedLead }) {
  const pills = [
    { label: 'D', active: true, activeBg: '#EEEDFE', activeColor: '#3C3489', tooltip: 'Presente no dnMarketing' },
    { label: 'N', active: !!lead.ecosystem?.nexus_contact_id || !!lead.ecosystem?.hasNexusEvents, activeBg: '#E6F1FB', activeColor: '#0C447C', tooltip: lead.ecosystem?.nexus_contact_id ? 'Presente no Nexus' : 'Não está no Nexus' },
    { label: 'M', active: !!lead.ecosystem?.mentoria_client_id || !!lead.ecosystem?.hasMentoriaEvents, activeBg: '#E1F5EE', activeColor: '#085041', tooltip: lead.ecosystem?.mentoria_client_id ? 'Presente no mentor.ia' : 'Não está no mentor.ia' },
  ];

  return (
    <div className="flex items-center gap-0.5">
      {pills.map(pill => (
        <Tooltip key={pill.label}>
          <TooltipTrigger asChild>
            <span
              className="inline-flex items-center justify-center rounded-sm font-bold select-none"
              style={{
                width: 18, height: 18, fontSize: 10, lineHeight: 1,
                backgroundColor: pill.active ? pill.activeBg : 'hsl(var(--secondary))',
                color: pill.active ? pill.activeColor : 'hsl(var(--muted-foreground))',
                opacity: pill.active ? 1 : 0.4,
              }}
            >
              {pill.label}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">{pill.tooltip}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
