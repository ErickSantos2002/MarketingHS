import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { X, ChevronDown, Download, Tag, Users, GitMerge, Trash2 } from 'lucide-react';
import { statusEmLote, tagsEmLote, fundirContatos, excluirContato } from '@/lib/leitura';
import { toast } from 'sonner';
import { adicionarContatos, listarSegmentos } from '@/lib/segmentos';
import { STATUS_OPTIONS, STATUS_COLORS } from './StatusBadge';
import type { TagInfo, EnrichedLead } from '@/hooks/useContactsEnriched';
import { getTagColor } from './TagsCell';
import { formatCell } from './ContactsExport';
import { ALL_COLUMNS } from '@/components/admin/ColumnSelector';

// ⚠️ Aqui moravam fetchAllCampaignSends, reassignCampaignSends,
// reassignJunction e bulkReassign — cerca de 200 linhas que existiam só para
// fazer a fusão de contatos a partir do navegador, uma tabela por vez.
//
// Elas foram embora inteiras. A fusão virou POST /contatos/fundir, que faz o
// mesmo dentro de UMA transação: ou os sete passos acontecem, ou nenhum. A
// versão daqui tinha try/catch e nenhum rollback — falhar no meio deixava tags
// e segmentos já migrados, o descartado ainda existindo, e os dois contatos
// apontando para os mesmos dados.
//
// O servidor também decide qual dos três casos de fusão se aplica (mesma
// identidade, identidades diferentes, só um tem identidade). Isso é regra de
// negócio, e regra de negócio que mora na tela some quando aparece uma segunda.


interface ContactsBulkBarProps {
  selectedLeads: EnrichedLead[];
  allTags: TagInfo[];
  onClear: () => void;
  onComplete: () => void;
  selectAll?: boolean;
  visibleColumns: string[];
  columnOrder: string[];
}

export function ContactsBulkBar({ selectedLeads, allTags, onClear, onComplete, selectAll = false, visibleColumns, columnOrder }: ContactsBulkBarProps) {
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [addingTag, setAddingTag] = useState(false);
  const [merging, setMerging] = useState(false);
  const [staticSegments, setStaticSegments] = useState<{ id: string; name: string }[]>([]);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  useEffect(() => {
    // Só segmento estático entra aqui: no dinâmico quem entra é decidido pelas
    // regras, e o servidor recusa a inserção com 409. Oferecer o dinâmico na
    // lista seria convidar para um erro.
    listarSegmentos()
      .then(lista => setStaticSegments(
        lista.filter(s => s.type === 'static').map(s => ({ id: s.id, name: s.name })),
      ))
      .catch(() => setStaticSegments([]));
  }, []);

  if (selectedLeads.length === 0) return null;

  const handleBulkStatus = async (newStatus: string) => {
    setUpdatingStatus(true);
    try {
      const r = await statusEmLote(selectedLeads.map((l) => l.id), newStatus);
      if (newStatus === 'Lead Qualificado') {
        toast.success(`${r.atualizados} leads qualificados`);
      } else {
        toast.success(`${r.atualizados} contatos atualizados para "${r.status}"`);
      }
      onComplete();
      onClear();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao atualizar status');
    }
    setUpdatingStatus(false);
  };

  const handleBulkTag = async (tagId: string, tagName: string) => {
    setAddingTag(true);
    try {
      // O servidor cria a tag se não existir e ignora quem já a tem — o
      // ON CONFLICT DO NOTHING sobre a PK (lead_id, tag_id).
      const r = await tagsEmLote(selectedLeads.map((l) => l.id), tagName);
      toast.success(`Tag "${r.tag}" aplicada a ${r.vinculados} contato(s)`);
      onComplete();
      onClear();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao aplicar tag');
    }
    setAddingTag(false);
  };

  const handleExport = () => {
    const orderedKeys = columnOrder.filter(k => visibleColumns.includes(k));
    const cols = orderedKeys
      .map(k => ALL_COLUMNS.find(c => c.key === k))
      .filter(Boolean) as { key: string; label: string }[];

    const headers = cols.map(c => c.label);
    const rows = selectedLeads.map(lead =>
      cols.map(c => formatCell(lead, c.key))
    );

    const csvContent = [
      headers.join(';'),
      ...rows.map(row =>
        row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(';')
      ),
    ].join('\n');

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `leads_selecionados_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    toast.success(`${selectedLeads.length} contatos exportados`);
  };

  const handleMerge = async () => {
    if (selectedLeads.length !== 2) return;
    const sorted = [...selectedLeads].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    const keep = sorted[0];
    const discard = sorted[1];
    if (!window.confirm('Mesclar contatos? O mais antigo será mantido e o mais recente descartado.')) return;

    setMerging(true);
    try {
      const r = await fundirContatos(keep.id, discard.id);
      if (r.caso === 'identidades') toast.success('Identidades mescladas com sucesso');
      else if (r.caso === 'vinculo') toast.success('Contatos vinculados à mesma identidade');
      else toast.success('Contatos mesclados com sucesso');
      onComplete();
    } catch (err) {
      toast.error(`Erro ao mesclar: ${err instanceof Error ? err.message : 'desconhecido'}`);
    }
    setMerging(false);
  };

  return (
    <div
      className="rounded-lg p-2.5 px-4 flex items-center justify-between gap-3 animate-in slide-in-from-top-2 duration-200"
      style={{ backgroundColor: '#534AB7' }}
    >
      <span className="text-sm font-medium text-white whitespace-nowrap">
        {selectedLeads.length} contato{selectedLeads.length > 1 ? 's' : ''} selecionado{selectedLeads.length > 1 ? 's' : ''}
      </span>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        {/* Status */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" disabled={updatingStatus} className="text-white border border-white/30 hover:bg-white/10 hover:text-white gap-1 h-8 text-xs">
              Alterar status <ChevronDown className="h-3 w-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-1" align="end">
            {STATUS_OPTIONS.map(s => (
              <button
                key={s}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted rounded-sm text-left"
                onClick={() => handleBulkStatus(s)}
              >
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[s] }} />
                {s}
              </button>
            ))}
          </PopoverContent>
        </Popover>

        {/* Tag */}
        {allTags.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" disabled={addingTag} className="text-white border border-white/30 hover:bg-white/10 hover:text-white gap-1 h-8 text-xs">
                <Tag className="h-3 w-3" /> Adicionar tag
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-1" align="end">
              {allTags.map(tag => (
                <button
                  key={tag.id}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted rounded-sm text-left"
                  onClick={() => handleBulkTag(tag.id, tag.name)}
                >
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getTagColor(tag.color) }} />
                  {tag.name}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        )}

        {/* Segment */}
        {staticSegments.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="text-white border border-white/30 hover:bg-white/10 hover:text-white gap-1 h-8 text-xs">
                <Users className="h-3 w-3" /> Segmento
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-1" align="end">
              {staticSegments.map(seg => (
                <button
                  key={seg.id}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted rounded-sm text-left"
                  onClick={async () => {
                    try {
                      await adicionarContatos(seg.id, selectedLeads.map(l => l.id));
                      toast.success(`${selectedLeads.length} contatos adicionados ao segmento "${seg.name}"`);
                      onComplete();
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : 'Erro ao adicionar ao segmento');
                    }
                  }}
                >
                  {seg.name}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        )}

        {/* Export */}
        <Button variant="ghost" size="sm" onClick={handleExport} className="text-white border border-white/30 hover:bg-white/10 hover:text-white gap-1 h-8 text-xs">
          <Download className="h-3 w-3" /> Exportar
        </Button>

        {/* Delete */}
        <Button
          variant="ghost" size="sm"
          onClick={() => setShowDeleteDialog(true)}
          disabled={bulkDeleting}
          className="text-red-300 border border-red-400/40 hover:bg-red-500/20 hover:text-red-200 gap-1 h-8 text-xs"
        >
          <Trash2 className="h-3 w-3" /> Apagar
        </Button>

        {/* Merge */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  variant="ghost" size="sm"
                  disabled={selectAll || selectedLeads.length !== 2 || merging}
                  onClick={handleMerge}
                  className="text-white border border-white/30 hover:bg-white/10 hover:text-white gap-1 h-8 text-xs disabled:opacity-40"
                >
                  <GitMerge className="h-3 w-3" /> Mesclar
                </Button>
              </span>
            </TooltipTrigger>
            {selectedLeads.length !== 2 && (
              <TooltipContent>Selecione exatamente 2 contatos</TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>

        {/* Close */}
        <Button variant="ghost" size="sm" onClick={onClear} className="text-white hover:bg-white/10 hover:text-white h-8 w-8 p-0">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Bulk delete dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar {selectedLeads.length} contato{selectedLeads.length > 1 ? 's' : ''}</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. Todos os dados associados (tags, notas, eventos) serão removidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async (e) => {
                e.preventDefault();
                setBulkDeleting(true);
                let successCount = 0;
                let errorCount = 0;
                for (const lead of selectedLeads) {
                  try {
                    // Exclusão lógica no servidor, uma por contato — o servidor
                    // marca deleted_at e deleted_by. A function de origem também
                    // avisava o Nexus antes de apagar; isso é do lote 5.
                    await excluirContato(lead.id);
                    successCount++;
                  } catch {
                    errorCount++;
                  }
                }
                if (errorCount > 0) {
                  toast.error(`${successCount} apagados, ${errorCount} falharam`);
                } else {
                  toast.success(`${successCount} contato${successCount > 1 ? 's' : ''} apagado${successCount > 1 ? 's' : ''}`);
                }
                setBulkDeleting(false);
                setShowDeleteDialog(false);
                onComplete();
              }}
            >
              {bulkDeleting ? 'Apagando...' : 'Apagar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
