import { useState, useMemo, useCallback } from 'react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Flame, RefreshCw, Sparkles } from 'lucide-react';
import type { Lead } from '@/hooks/useLeads';
import { ALL_COLUMNS, type ColumnConfig } from '@/components/admin/ColumnSelector';
import { LeadDetailSheet } from '@/components/admin/LeadDetailSheet';
import { StatusDropdown } from '@/components/admin/contacts/StatusDropdown';
import { StatusBadge } from '@/components/admin/contacts/StatusBadge';
import { EcosystemPills } from '@/components/admin/contacts/EcosystemPills';
import { TagsCell } from '@/components/admin/contacts/TagsCell';
import { BulkActionsBar } from '@/components/admin/contacts/BulkActionsBar';
import { Progress } from '@/components/ui/progress';
import type { EnrichedLead, TagInfo } from '@/hooks/useContactsEnriched';

interface LeadsTableProps {
  leads: (Lead | EnrichedLead)[];
  isLoading: boolean;
  visibleColumns: string[];
  columnOrder: string[];
  allTags?: TagInfo[];
  onRefresh?: () => void;
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

const formatDate = (dateString: string | null) => {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
};

const isReconversion = (lead: Lead) => {
  if (!lead.last_conversion_date || !lead.created_at) return false;
  const created = new Date(lead.created_at).getTime();
  const lastConversion = new Date(lead.last_conversion_date).getTime();
  return Math.abs(lastConversion - created) > 60000;
};

const getTipoBadge = (tipo: string) => {
  const variants: Record<string, { variant: 'default' | 'secondary' | 'outline'; label: string }> = {
    pago: { variant: 'default', label: 'Pago' },
    gratuito: { variant: 'secondary', label: 'Gratuito' },
    modal: { variant: 'outline', label: 'Modal' },
    convidado: { variant: 'outline', label: 'Convidado' },
  };
  const config = variants[tipo] || { variant: 'outline' as const, label: tipo };
  return <Badge variant={config.variant}>{config.label}</Badge>;
};

const getTipoParticipanteBadge = (tipoParticipante: string | null) => {
  if (!tipoParticipante) return '-';
  const isMentorado = tipoParticipante.toLowerCase().includes('mentorado');
  return (
    <Badge variant={isMentorado ? 'default' : 'secondary'}>
      {tipoParticipante}
    </Badge>
  );
};

const formatBoolean = (val: boolean | null) => {
  if (val === null || val === undefined) return '-';
  return val ? '✅ Sim' : '❌ Não';
};

function renderCellValue(lead: EnrichedLead, key: string): React.ReactNode {
  switch (key) {
    case 'last_conversion_date':
      return (
        <div className="flex items-center gap-1">
          {formatDate(lead.last_conversion_date)}
          {isReconversion(lead) && (
            <span title="Reconversão">
              <RefreshCw className="h-3 w-3 text-primary flex-shrink-0" />
            </span>
          )}
        </div>
      );
    case 'tipo':
      return getTipoBadge(lead.tipo);
    case 'status':
      return (
        <StatusDropdown
          leadId={lead.id}
          currentStatus={lead.status}
          size="sm"
          leadEmail={lead.email}
          leadWhatsapp={lead.whatsapp}
          leadDniaId={lead.dnia_id}
        />
      );
    case 'tipo_participante':
      return getTipoParticipanteBadge(lead.tipo_participante);
    case 'nome':
      return (
        <div className="flex items-center gap-1.5">
          {lead.etiqueta === 'hotlead' && (
            <Flame className="h-4 w-4 text-orange-500 flex-shrink-0" />
          )}
          {isReconversion(lead) && (
            <span title="Lead reconvertido"><RefreshCw className="h-4 w-4 text-cyan-500 flex-shrink-0" /></span>
          )}
          {lead.origem_campanha === 'aula_070226' && (
            <Sparkles className="h-4 w-4 text-purple-500 flex-shrink-0" />
          )}
          <span>{lead.nome || '-'}</span>
        </div>
      );
    case 'presenca':
      if (!lead.presenca) return '-';
      return <Badge variant="secondary" className="bg-green-100 text-green-800 border-green-200">{lead.presenca}</Badge>;
    case 'etiqueta':
      if (!lead.etiqueta) return '-';
      return <Badge variant="outline">{lead.etiqueta}</Badge>;
    case 'ecosystem':
      return (
        <EcosystemPills
          hasNexus={!!lead.ecosystem?.nexus_contact_id}
          hasMentoria={!!lead.ecosystem?.mentoria_client_id}
          hasNexusEvents={!!lead.ecosystem?.hasNexusEvents}
          hasMentoriaEvents={!!lead.ecosystem?.hasMentoriaEvents}
          size={14}
        />
      );
    case 'tags':
      return <TagsCell tags={lead.tags || []} />;
    case 'lead_score': {
      const score = (lead as any).lead_score ?? 0;
      const scoreColor = score >= 70 ? 'bg-red-500' : score >= 40 ? 'bg-yellow-500' : 'bg-muted-foreground/40';
      return (
        <div className="flex items-center gap-2 min-w-[80px]">
          <span className="text-xs font-medium w-6 text-right">{score}</span>
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div className={`h-full rounded-full ${scoreColor}`} style={{ width: `${score}%` }} />
          </div>
        </div>
      );
    }
    case 'interesse_ecossistema':
      return formatBoolean(lead.interesse_ecossistema);
    case 'interesse_mtia':
      return formatBoolean(lead.interesse_mtia);
    case 'interesse_formacao':
      return formatBoolean(lead.interesse_formacao);
    case 'created_at':
      return formatDate(lead.created_at);
    case 'data_interesse':
      return formatDate(lead.data_interesse);
    default: {
      const value = (lead as unknown as Record<string, unknown>)[key];
      if (value === null || value === undefined) return '-';
      return String(value);
    }
  }
}

const COLUMN_CLASSES: Record<string, string> = {
  lead_score: 'w-[100px]',
  last_conversion_date: 'w-[140px]',
  tipo: 'w-[80px]',
  status: 'w-[150px]',
  tipo_participante: 'w-[120px]',
  nome: 'font-medium',
  ecosystem: 'w-[70px]',
  tags: 'w-[160px]',
  utm_source: 'text-xs',
  utm_medium: 'text-xs',
  utm_campaign: 'text-xs',
  utm_term: 'text-xs',
  utm_content: 'text-xs',
  desafios: 'max-w-[200px] truncate',
};

const HEADER_CLASSES: Record<string, string> = {
  lead_score: 'w-[100px]',
  last_conversion_date: 'w-[140px]',
  tipo: 'w-[80px]',
  status: 'w-[150px]',
  tipo_participante: 'w-[120px]',
  ecosystem: 'w-[70px]',
  tags: 'w-[160px]',
  utm_source: 'text-xs',
  utm_medium: 'text-xs',
  utm_campaign: 'text-xs',
  utm_term: 'text-xs',
  utm_content: 'text-xs',
};

export function LeadsTable({ leads: rawLeads, isLoading, visibleColumns, columnOrder, allTags = [], onRefresh }: LeadsTableProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedLead, setSelectedLead] = useState<EnrichedLead | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const handleSort = useCallback((key: string) => {
    if (sortKey === key) {
      if (sortDir === 'desc') setSortDir('asc');
      else { setSortKey(null); setSortDir('desc'); }
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
    setCurrentPage(1);
  }, [sortKey, sortDir]);

  // Normalize all leads to EnrichedLead
  const enrichedLeads = useMemo(() => rawLeads.map(asEnriched), [rawLeads]);

  const leads = useMemo(() => {
    if (!sortKey) return enrichedLeads;
    return [...enrichedLeads].sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortKey];
      const bv = (b as unknown as Record<string, unknown>)[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const aStr = String(av);
      const bStr = String(bv);
      // Try date comparison for date-like fields
      if (sortKey.includes('date') || sortKey === 'created_at' || sortKey === 'updated_at' || sortKey === 'data_interesse' || sortKey === 'last_conversion_date') {
        const aTime = new Date(aStr).getTime();
        const bTime = new Date(bStr).getTime();
        if (!isNaN(aTime) && !isNaN(bTime)) return sortDir === 'asc' ? aTime - bTime : bTime - aTime;
      }
      const cmp = aStr.localeCompare(bStr, 'pt-BR', { sensitivity: 'base', numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [enrichedLeads, sortKey, sortDir]);

  const columns = useMemo(
    () => columnOrder
      .filter(key => visibleColumns.includes(key))
      .map(key => ALL_COLUMNS.find(c => c.key === key)!)
      .filter(Boolean),
    [visibleColumns, columnOrder]
  );

  const totalPages = Math.ceil(leads.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedLeads = leads.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    const pageIds = paginatedLeads.map(l => l.id);
    const allSelected = pageIds.every(id => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        pageIds.forEach(id => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        pageIds.forEach(id => next.add(id));
        return next;
      });
    }
  }, [paginatedLeads, selectedIds]);

  const selectedLeads = useMemo(
    () => leads.filter(l => selectedIds.has(l.id)),
    [leads, selectedIds]
  );

  const handleBulkComplete = () => {
    setSelectedIds(new Set());
    onRefresh?.();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-muted-foreground">Carregando leads...</p>
      </div>
    );
  }

  if (leads.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-muted-foreground">Nenhum lead encontrado</p>
      </div>
    );
  }

  const allPageSelected = paginatedLeads.length > 0 && paginatedLeads.every(l => selectedIds.has(l.id));
  const somePageSelected = paginatedLeads.some(l => selectedIds.has(l.id));

  return (
    <div className="space-y-4">
      {/* Legenda de Ícones */}
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground bg-muted/30 rounded-lg px-4 py-2">
        <span className="font-medium text-foreground">Legenda:</span>
        <div className="flex items-center gap-1.5">
          <Flame className="h-3.5 w-3.5 text-orange-500" />
          <span>Hot Lead (ICP + Decisor)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <RefreshCw className="h-3.5 w-3.5 text-cyan-500" />
          <span>Lead Reconvertido</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-purple-500" />
          <span>Novo Lead Campanha 07/02</span>
        </div>
        <div className="flex items-center gap-1.5">
          <RefreshCw className="h-3.5 w-3.5 text-primary" />
          <span>Reconversão (data)</span>
        </div>
      </div>

      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[48px] min-w-[48px] max-w-[48px] sticky left-0 z-20 bg-background border-r px-3">
                <Checkbox
                  checked={allPageSelected}
                  onCheckedChange={toggleSelectAll}
                  aria-label="Selecionar todos"
                  className={somePageSelected && !allPageSelected ? 'opacity-50' : ''}
                />
              </TableHead>
              {columns.map(col => {
                const isSorted = sortKey === col.key;
                const SortIcon = isSorted ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
                const nonsortable = ['ecosystem', 'tags'];
                return (
                  <TableHead
                    key={col.key}
                    className={`${HEADER_CLASSES[col.key] || ''} ${nonsortable.includes(col.key) ? '' : 'cursor-pointer select-none hover:bg-muted/50'}`}
                    onClick={() => !nonsortable.includes(col.key) && handleSort(col.key)}
                  >
                    <div className="flex items-center gap-1">
                      {col.label}
                      {!nonsortable.includes(col.key) && (
                        <SortIcon className={`h-3 w-3 flex-shrink-0 ${isSorted ? 'text-foreground' : 'text-muted-foreground/50'}`} />
                      )}
                    </div>
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedLeads.map(lead => {
              const isSelected = selectedIds.has(lead.id);
              const rowBg = isSelected ? 'bg-primary/[0.08]' : isReconversion(lead) ? 'bg-primary/5' : '';
              const stickyBg = isSelected ? 'bg-primary/[0.08]' : 'bg-background';
              return (
              <TableRow
                key={lead.id}
                className={`cursor-pointer hover:bg-muted/50 transition-colors ${rowBg}`}
                onClick={() => { setSelectedLead(lead); setModalOpen(true); }}
              >
                <TableCell
                  className={`w-[48px] min-w-[48px] max-w-[48px] sticky left-0 z-10 border-r px-3 ${stickyBg}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSelect(lead.id);
                  }}
                >
                  <Checkbox
                    checked={isSelected}
                    tabIndex={-1}
                    aria-label={`Selecionar ${lead.nome || 'lead'}`}
                  />
                </TableCell>
                {columns.map(col => (
                  <TableCell key={col.key} className={COLUMN_CLASSES[col.key] || ''}>
                    {renderCellValue(lead, col.key)}
                  </TableCell>
                ))}
              </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Mostrando {startIndex + 1}-{Math.min(startIndex + ITEMS_PER_PAGE, leads.length)} de {leads.length} leads
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline" size="sm"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm">Página {currentPage} de {totalPages}</span>
            <Button
              variant="outline" size="sm"
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <LeadDetailSheet
        lead={selectedLead}
        open={modalOpen}
        onOpenChange={setModalOpen}
        allTags={allTags}
        onDataChanged={onRefresh}
      />

      <BulkActionsBar
        selectedLeads={selectedLeads}
        allTags={allTags}
        onClear={() => setSelectedIds(new Set())}
        onComplete={handleBulkComplete}
      />
    </div>
  );
}
