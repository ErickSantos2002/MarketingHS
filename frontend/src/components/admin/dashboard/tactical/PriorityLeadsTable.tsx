import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Target, Copy, Check, ChevronLeft, ChevronRight, ArrowUpDown, Flame, RefreshCw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { EnrichedLead } from '@/hooks/useLeadQualification';
import { getPriorityColor, getQualificationColor } from '@/hooks/useLeadQualification';
import { LeadDetailModal } from '../LeadDetailModal';

interface PriorityLeadsTableProps {
  leads: EnrichedLead[];
}

type SortKey = 'priorityScore' | 'nome' | 'empresa' | 'created_at';
type SortDirection = 'asc' | 'desc';

export function PriorityLeadsTable({ leads }: PriorityLeadsTableProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>('priorityScore');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [selectedLead, setSelectedLead] = useState<EnrichedLead | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  
  const itemsPerPage = 10;

  const sortedLeads = useMemo(() => {
    const sorted = [...leads].sort((a, b) => {
      let comparison = 0;
      
      switch (sortKey) {
        case 'priorityScore':
          comparison = a.priorityScore - b.priorityScore;
          break;
        case 'nome':
          comparison = (a.nome || '').localeCompare(b.nome || '');
          break;
        case 'empresa':
          comparison = (a.empresa || '').localeCompare(b.empresa || '');
          break;
        case 'created_at':
          comparison = new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
          break;
      }
      
      return sortDirection === 'desc' ? -comparison : comparison;
    });
    
    return sorted;
  }, [leads, sortKey, sortDirection]);

  const paginatedLeads = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return sortedLeads.slice(startIndex, startIndex + itemsPerPage);
  }, [sortedLeads, currentPage]);

  const totalPages = Math.ceil(sortedLeads.length / itemsPerPage);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('desc');
    }
  };

  const handleCopyWhatsApp = async (e: React.MouseEvent, lead: EnrichedLead) => {
    e.stopPropagation(); // Prevent row click
    if (!lead.whatsapp) return;
    
    try {
      await navigator.clipboard.writeText(lead.whatsapp);
      setCopiedId(lead.id);
      toast.success('WhatsApp copiado!');
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error('Erro ao copiar');
    }
  };

  const handleRowClick = (lead: EnrichedLead) => {
    setSelectedLead(lead);
    setModalOpen(true);
  };

  return (
    <Card className="bg-gradient-to-br from-card via-card to-emerald-950/10 border-border/50 shadow-lg overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-lg">
            <div className="p-2 rounded-lg bg-emerald-500/20">
              <Target className="h-5 w-5 text-emerald-400" />
            </div>
            Leads Prioritários
          </div>
          <div className="text-sm font-normal text-muted-foreground">
            {sortedLeads.length} leads
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border border-border/50 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-16">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs font-medium"
                    onClick={() => handleSort('priorityScore')}
                  >
                    Prio
                    <ArrowUpDown className="ml-1 h-3 w-3" />
                  </Button>
                </TableHead>
                <TableHead>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs font-medium"
                    onClick={() => handleSort('nome')}
                  >
                    Nome
                    <ArrowUpDown className="ml-1 h-3 w-3" />
                  </Button>
                </TableHead>
                <TableHead>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs font-medium"
                    onClick={() => handleSort('empresa')}
                  >
                    Empresa
                    <ArrowUpDown className="ml-1 h-3 w-3" />
                  </Button>
                </TableHead>
                <TableHead>Cargo</TableHead>
                <TableHead>Qualif.</TableHead>
                <TableHead className="w-28">WhatsApp</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedLeads.map((lead) => (
                <TableRow 
                  key={lead.id} 
                  className="group hover:bg-muted/30 cursor-pointer transition-colors"
                  onClick={() => handleRowClick(lead)}
                >
                  <TableCell>
                    <Badge 
                      variant="outline" 
                      className={`${getPriorityColor(lead.priorityLevel)} text-xs font-bold`}
                    >
                      {lead.priorityLevel}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-1.5 max-w-[150px]">
                      {lead.etiqueta === 'hotlead' && (
                        <Flame className="h-4 w-4 text-orange-500 flex-shrink-0" />
                      )}
                      {lead.origem_campanha === 'reconversao_070226' && (
                        <RefreshCw className="h-4 w-4 text-cyan-500 flex-shrink-0" />
                      )}
                      {lead.origem_campanha === 'aula_070226' && (
                        <Sparkles className="h-4 w-4 text-purple-500 flex-shrink-0" />
                      )}
                      <span className="truncate" title={lead.nome || '-'}>
                        {lead.nome || '-'}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-[150px] truncate text-muted-foreground" title={lead.empresa || '-'}>
                      {lead.empresa || '-'}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-[120px] truncate text-muted-foreground text-sm" title={lead.cargo || '-'}>
                      {lead.cargo || '-'}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge 
                      variant="outline" 
                      className={`${getQualificationColor(lead.qualification)} text-xs capitalize`}
                    >
                      {lead.qualification}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {lead.whatsapp ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={(e) => handleCopyWhatsApp(e, lead)}
                      >
                        {copiedId === lead.id ? (
                          <>
                            <Check className="h-3 w-3 mr-1 text-emerald-400" />
                            Copiado
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3 mr-1" />
                            Copiar
                          </>
                        )}
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <div className="text-sm text-muted-foreground">
              Página {currentPage} de {totalPages}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      {/* Lead Detail Modal */}
      <LeadDetailModal
        lead={selectedLead}
        open={modalOpen}
        onOpenChange={setModalOpen}
      />
    </Card>
  );
}
