import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  X, Plus, Trash2, StickyNote, Tag as TagIcon,
  Copy, ExternalLink,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { lerFicha, criarNota, removerNota, removerTagDoContato } from '@/lib/leitura';
import { criarTag } from '@/lib/leitura';
import { aplicarTag } from '@/lib/contatos';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { StatusDropdown } from './StatusDropdown';
import { StatusBadge } from './StatusBadge';
import { getTagColor } from './TagsCell';
import type { EnrichedLead, TagInfo } from '@/hooks/useContactsEnriched';

// ─── Tag Colors ───
const TAG_COLOR_OPTIONS = [
  { name: 'purple', hex: '#534AB7' },
  { name: 'blue', hex: '#185FA5' },
  { name: 'green', hex: '#3B6D11' },
  { name: 'amber', hex: '#BA7517' },
  { name: 'red', hex: '#A32D2D' },
  { name: 'teal', hex: '#0F6E56' },
];

interface Note {
  id: string;
  content: string;
  created_at: string;
}

// ─── DN.IA ID Chip ───
export function DniaIdChip({ dniaId }: { dniaId: string | null }) {
  if (!dniaId) return null;
  const short = dniaId.slice(0, 8);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(dniaId);
    toast.success('ID copiado');
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="secondary"
            className="text-[10px] cursor-pointer gap-1 h-5 px-1.5"
            onClick={handleCopy}
          >
            <Copy className="h-2.5 w-2.5" />
            ID do contato · {short}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs font-mono">
          {dniaId}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ─── GrowthHS Link ───
// Era "Ver no Nexus" (CRM antigo da dn.ia, endereço cravado no componente). O
// CRM agora é o GrowthHS — o link já vem pronto do backend
// (`growthhs_card_url`), que é quem lê `growthhs_config` (tela de admin).
export function GrowthHSLink({ growthhsCardUrl }: { growthhsCardUrl: string | null }) {
  if (!growthhsCardUrl) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-6 text-[10px] gap-1 px-2"
      style={{ color: '#15803D', borderColor: '#15803D30' }}
      onClick={(e) => {
        e.stopPropagation();
        window.open(growthhsCardUrl, '_blank');
      }}
    >
      <ExternalLink className="h-3 w-3" />
      Ver no GrowthHS
    </Button>
  );
}

// ─── Status & Tags Section ───
export function StatusTagsSection({
  lead,
  allTags,
  onTagsChanged,
}: {
  lead: EnrichedLead;
  allTags: TagInfo[];
  onTagsChanged: () => void;
}) {
  const [tagSearch, setTagSearch] = useState('');
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [showCreateTag, setShowCreateTag] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('purple');
  const [leadTags, setLeadTags] = useState<TagInfo[]>(lead.tags || []);

  useEffect(() => {
    setLeadTags(lead.tags || []);
  }, [lead.tags]);

  const filteredTags = allTags.filter(t =>
    t.name.toLowerCase().includes(tagSearch.toLowerCase()) &&
    !leadTags.some(lt => lt.id === t.id)
  );

  // `triggerRescore` foi REMOVIDA no lote 1B. Ela chamava scoreAndUpdateLead,
  // que recalculava em TypeScript e gravava lead_score e etiqueta por cima do
  // que o banco tinha. E era inútil de qualquer forma: tag NÃO é critério de
  // scoring — os sete são cargo, faturamento, funcionários, desafios, origem,
  // reconversão e WhatsApp. Recalcular depois de mexer numa tag nunca mudou
  // nada; era risco por nada.

  // ⚠️ `triggerAutomation` saiu no lote 4B, pelo mesmo motivo do StatusDropdown:
  // ela avaliava as regras no navegador e chamava `handoff-to-nexus`, do lote 5.
  // Relia o lead do servidor para nada. A avaliação volta no lote 5, no
  // servidor, junto da ação. Ver AUTOMACAO_NAO_LIGADA em lib/automacoes.

  const handleRemoveTag = async (tagId: string) => {
    await removerTagDoContato(lead.id, tagId);
    setLeadTags(prev => prev.filter(t => t.id !== tagId));
    onTagsChanged();
    toast.success('Tag removida');
  };

  const handleAddTag = async (tag: TagInfo) => {
    await aplicarTag(lead.id, tag.name);
    setLeadTags(prev => [...prev, tag]);
    setTagSearch('');
    setShowTagDropdown(false);
    onTagsChanged();
    toast.success(`Tag "${tag.name}" adicionada`);
  };

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;
    let criada;
    try {
      criada = await criarTag(newTagName.trim(), newTagColor);
    } catch {
      toast.error('Erro ao criar tag');
      return;
    }

    {
      const data = { id: criada.id, name: criada.nome, color: criada.cor ?? 'purple' };
      await aplicarTag(lead.id, data.name);
      setLeadTags(prev => [...prev, data]);
      setNewTagName('');
      setShowCreateTag(false);
      onTagsChanged();
      toast.success(`Tag "${data.name}" criada e adicionada`);
    }
  };

  return (
    <div className="space-y-4">
      {/* Status (read-only) */}
      <div>
        <label className="text-xs text-muted-foreground font-medium mb-1.5 block">Status</label>
        <StatusBadge status={lead.status} />
      </div>

      {/* Tags */}
      <div>
        <label className="text-xs text-muted-foreground font-medium mb-1.5 block">Tags</label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {leadTags.map(tag => (
            <Badge
              key={tag.id}
              variant="outline"
              className="text-xs gap-1 pr-1"
              style={{
                borderColor: getTagColor(tag.color),
                color: getTagColor(tag.color),
                backgroundColor: `${getTagColor(tag.color)}15`,
              }}
            >
              {tag.name}
              <button
                onClick={() => handleRemoveTag(tag.id)}
                className="ml-0.5 hover:opacity-70"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>

        <div className="relative">
          <Input
            placeholder="Buscar ou criar tag..."
            value={tagSearch}
            onChange={(e) => {
              setTagSearch(e.target.value);
              setShowTagDropdown(true);
            }}
            onFocus={() => setShowTagDropdown(true)}
            className="h-8 text-sm"
          />
          {showTagDropdown && tagSearch && (
            <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-md max-h-48 overflow-y-auto">
              {filteredTags.map(tag => (
                <button
                  key={tag.id}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted text-left"
                  onClick={() => handleAddTag(tag)}
                >
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getTagColor(tag.color) }} />
                  {tag.name}
                </button>
              ))}
              {filteredTags.length === 0 && (
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted text-left text-primary"
                  onClick={() => {
                    setNewTagName(tagSearch);
                    setShowCreateTag(true);
                    setShowTagDropdown(false);
                  }}
                >
                  <Plus className="h-3 w-3" />
                  Criar tag "{tagSearch}"
                </button>
              )}
            </div>
          )}
        </div>

        {/* Create tag mini-modal */}
        {showCreateTag && (
          <div className="mt-2 p-3 border rounded-lg bg-muted/30 space-y-3">
            <Input
              placeholder="Nome da tag"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              className="h-8 text-sm"
            />
            <div className="flex gap-1.5">
              {TAG_COLOR_OPTIONS.map(c => (
                <button
                  key={c.name}
                  className={`w-6 h-6 rounded-full border-2 transition-all ${
                    newTagColor === c.name ? 'ring-2 ring-offset-1 ring-primary scale-110' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: c.hex }}
                  onClick={() => setNewTagColor(c.name)}
                />
              ))}
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="h-7 text-xs" onClick={handleCreateTag}>
                Criar
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowCreateTag(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Notes Section ───
export function NotesSection({ leadId }: { leadId: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const fetchNotes = useCallback(async () => {
    setLoading(true);
    try {
      const { notas } = await lerFicha<unknown>(leadId);
      setNotes(notas.map((n) => ({ id: n.id, content: n.conteudo, created_at: n.created_at })));
    } catch {
      setNotes([]);
    }
    setLoading(false);
  }, [leadId]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const handleSave = async () => {
    if (!content.trim()) return;
    setSaving(true);
    try {
      await criarNota(leadId, content.trim());
      toast.success('Nota salva');
      setContent('');
      fetchNotes();
    } catch {
      toast.error('Erro ao salvar nota');
    }
    setSaving(false);
  };

  const handleDelete = async (noteId: string) => {
    await removerNota(noteId);
    toast.success('Nota removida');
    setConfirmDeleteId(null);
    fetchNotes();
  };

  return (
    <div className="space-y-3">
      <Textarea
        placeholder="Adicionar uma nota..."
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={3}
        className="text-sm resize-none"
      />
      <Button
        size="sm"
        onClick={handleSave}
        disabled={saving || !content.trim()}
        className="h-7 text-xs"
      >
        <StickyNote className="h-3 w-3 mr-1.5" />
        Salvar nota
      </Button>

      {loading ? (
        <div className="space-y-2">
          {[1, 2].map(i => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : notes.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-3">Nenhuma nota ainda</p>
      ) : (
        <div className="space-y-2">
          {notes.map(note => (
            <div key={note.id} className="p-3 rounded-lg bg-muted/20 border border-border/20 group">
              <div className="flex justify-between items-start gap-2">
                <p className="text-sm text-foreground whitespace-pre-wrap flex-1">{note.content}</p>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                    {formatDistanceToNow(new Date(note.created_at), { addSuffix: true, locale: ptBR })}
                  </span>
                  {confirmDeleteId === note.id ? (
                    <div className="flex items-center gap-1 text-[10px]">
                      <span className="text-muted-foreground">Tem certeza?</span>
                      <button onClick={() => handleDelete(note.id)} className="text-red-500 font-medium">Sim</button>
                      <button onClick={() => setConfirmDeleteId(null)} className="text-muted-foreground">Não</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(note.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="h-3 w-3 text-muted-foreground hover:text-red-500 transition-colors" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
