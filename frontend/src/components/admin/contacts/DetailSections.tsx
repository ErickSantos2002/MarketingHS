import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  X, Plus, Trash2, StickyNote, Tag as TagIcon,
  Copy, ExternalLink, Clock,
  FileText, Mail, MailOpen, MessageCircle, Calendar,
  TrendingUp, FileCheck, Rocket, Heart, Circle,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { StatusDropdown } from './StatusDropdown';
import { StatusBadge } from './StatusBadge';
import { EcosystemPills } from './EcosystemPills';
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

// ─── Event Icons ───
const EVENT_ICONS: Record<string, React.ElementType> = {
  form_submitted: FileText,
  email_sent: Mail,
  email_opened: MailOpen,
  email_clicked: ExternalLink,
  whatsapp_sent: MessageCircle,
  meeting_scheduled: Calendar,
  deal_moved: TrendingUp,
  proposal_sent: FileCheck,
  onboarding_started: Rocket,
  health_updated: Heart,
  note_added: StickyNote,
};

const APP_COLORS: Record<string, { label: string; color: string }> = {
  dnmarketing: { label: 'D', color: '#534AB7' },
  nexus: { label: 'N', color: '#185FA5' },
  mentoria: { label: 'M', color: '#0F6E56' },
};

interface Note {
  id: string;
  content: string;
  created_at: string;
}

interface ContactEvent {
  id: string;
  source_app: string;
  event_type: string;
  title: string;
  description: string | null;
  metadata: any;
  occurred_at: string;
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
            DN.IA ID · {short}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs font-mono">
          {dniaId}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ─── Nexus Link ───
export function NexusLink({ nexusContactId }: { nexusContactId: string | null }) {
  if (!nexusContactId) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-6 text-[10px] gap-1 px-2"
      style={{ color: '#185FA5', borderColor: '#185FA530' }}
      onClick={(e) => {
        e.stopPropagation();
        window.open(`https://nexus.dnia.ai/crm/contacts/${nexusContactId}`, '_blank');
      }}
    >
      <ExternalLink className="h-3 w-3" />
      Ver no Nexus
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

  const triggerRescore = () => {
    import('@/lib/leadScoring').then(({ scoreAndUpdateLead }) =>
      scoreAndUpdateLead(lead.id)
    ).catch(() => {});
  };

  const triggerAutomation = () => {
    import('@/lib/automationEngine').then(async ({ evaluateAndExecute }) => {
      const { data: freshLead } = await supabase.from('leads').select('id, status, etiqueta, lead_score, dnia_id').eq('id', lead.id).single();
      if (freshLead) {
        const ruleName = await evaluateAndExecute(freshLead);
        if (ruleName) toast.success(`Automação executada: ${ruleName}`);
      }
    }).catch(() => {});
  };

  const handleRemoveTag = async (tagId: string) => {
    await supabase.from('lead_tags').delete().eq('lead_id', lead.id).eq('tag_id', tagId);
    setLeadTags(prev => prev.filter(t => t.id !== tagId));
    onTagsChanged();
    triggerRescore();
    triggerAutomation();
    toast.success('Tag removida');
  };

  const handleAddTag = async (tag: TagInfo) => {
    await supabase.from('lead_tags').insert({ lead_id: lead.id, tag_id: tag.id });
    setLeadTags(prev => [...prev, tag]);
    setTagSearch('');
    setShowTagDropdown(false);
    onTagsChanged();
    triggerRescore();
    triggerAutomation();
    toast.success(`Tag "${tag.name}" adicionada`);
  };

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;
    const { data, error } = await supabase
      .from('tags')
      .insert({ name: newTagName.trim(), color: newTagColor })
      .select('id, name, color')
      .single();

    if (error) {
      toast.error('Erro ao criar tag');
      return;
    }

    if (data) {
      await supabase.from('lead_tags').insert({ lead_id: lead.id, tag_id: data.id });
      setLeadTags(prev => [...prev, data]);
      setNewTagName('');
      setShowCreateTag(false);
      onTagsChanged();
      triggerRescore();
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
    const { data } = await supabase
      .from('lead_notes')
      .select('*')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false });
    setNotes(data || []);
    setLoading(false);
  }, [leadId]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const handleSave = async () => {
    if (!content.trim()) return;
    setSaving(true);
    const { error } = await supabase
      .from('lead_notes')
      .insert({ lead_id: leadId, content: content.trim() });
    if (error) {
      toast.error('Erro ao salvar nota');
    } else {
      toast.success('Nota salva');
      setContent('');
      fetchNotes();
    }
    setSaving(false);
  };

  const handleDelete = async (noteId: string) => {
    await supabase.from('lead_notes').delete().eq('id', noteId);
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

// ─── Contact Events Timeline ───
// Rótulos amigáveis para os event_type que aparecem na timeline. Qualquer
// valor não mapeado cai num prettify genérico (snake_case -> Title Case).
const EVENT_TYPE_LABELS: Record<string, string> = {
  form_submitted: 'Formulário enviado',
  email_sent: 'Email enviado',
  email_opened: 'Email aberto',
  email_clicked: 'Link clicado',
  email_delivered: 'Email entregue',
  email_complained: 'Reclamação de spam',
  email_unsubscribed: 'Descadastrou email',
  whatsapp_sent: 'WhatsApp enviado',
  meeting_scheduled: 'Reunião agendada',
  meeting_started: 'Reunião iniciada',
  meeting_ended: 'Reunião finalizada',
  meeting_rescheduled: 'Reunião remarcada',
  deal_moved: 'Deal movido',
  deal_won: 'Deal ganho',
  deal_lost: 'Deal perdido',
  activity_created: 'Atividade criada',
  activity_completed: 'Atividade concluída',
  activity_cancelled: 'Atividade cancelada',
  activity_no_show: 'Atividade no-show',
  activity_deleted: 'Atividade excluída',
  activity_updated: 'Atividade atualizada',
  contact_updated: 'Contato atualizado',
  contact_synced: 'Contato sincronizado',
  contact_soft_deleted: 'Contato apagado',
  contact_reactivated: 'Contato reativado',
  tags_synced: 'Tags sincronizadas',
  scheduling_widget_booked: 'Agendou pelo widget',
  guest_joined_meeting: 'Convidado entrou na reunião',
  automation_executed: 'Automação executada',
  lead_qualified: 'Lead qualificado',
  conversion_updated: 'Conversão atualizada',
  conversion_unregistered: 'Conversão removida',
  direct_nexus_send: 'Enviado ao Nexus',
  manual_nexus_send: 'Envio manual ao Nexus',
  opportunity_created: 'Oportunidade criada',
  sync_manual: 'Sync manual',
  note_added: 'Nota adicionada',
};

const prettifyEventType = (t: string) =>
  EVENT_TYPE_LABELS[t] || t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const APP_LABELS: Record<string, string> = {
  dnmarketing: 'dnMarketing',
  nexus: 'Nexus',
  mentoria: 'Mentoria',
};

export function EventsTimeline({ leadId, dniaId }: { leadId: string; dniaId: string | null }) {
  const [events, setEvents] = useState<ContactEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // Filtros locais (client-side)
  const [selectedApp, setSelectedApp] = useState<string>('all');
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const fetchEvents = async () => {
      setLoading(true);
      let query = supabase
        .from('contact_events')
        .select('*')
        .order('occurred_at', { ascending: false })
        .limit(200);

      if (dniaId) {
        query = query.or(`lead_id.eq.${leadId},dnia_id.eq.${dniaId}`);
      } else {
        query = query.eq('lead_id', leadId);
      }

      const { data } = await query;
      setEvents(data || []);
      setLoading(false);
    };
    fetchEvents();
  }, [leadId, dniaId]);

  // Opções do multi-select derivam dos eventos carregados
  const availableTypes = Array.from(new Set(events.map(e => e.event_type))).sort();

  const filteredEvents = events.filter(evt => {
    if (selectedApp !== 'all' && evt.source_app !== selectedApp) return false;
    if (selectedTypes.size > 0 && !selectedTypes.has(evt.event_type)) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const hay = `${evt.title || ''} ${evt.description || ''} ${prettifyEventType(evt.event_type)}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const toggleType = (t: string) => {
    const next = new Set(selectedTypes);
    if (next.has(t)) next.delete(t); else next.add(t);
    setSelectedTypes(next);
  };

  const clearFilters = () => {
    setSelectedApp('all');
    setSelectedTypes(new Set());
    setSearch('');
  };

  const hasActiveFilters = selectedApp !== 'all' || selectedTypes.size > 0 || search.trim().length > 0;

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-6 w-6 rounded-full flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-60" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
        <Clock className="h-8 w-8 mb-2 opacity-40" />
        <p className="text-sm">Nenhuma interação registrada ainda</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Origem (source_app) */}
        <div className="flex gap-0.5 p-0.5 bg-background/60 border border-border/70 rounded-md">
          {[
            { value: 'all', label: 'Todos' },
            { value: 'dnmarketing', label: 'dnMarketing' },
            { value: 'nexus', label: 'Nexus' },
            { value: 'mentoria', label: 'Mentoria' },
          ].map(opt => (
            <button
              key={opt.value}
              onClick={() => setSelectedApp(opt.value)}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                selectedApp === opt.value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Tipo de evento — multi-select via Popover */}
        <Popover open={typeMenuOpen} onOpenChange={setTypeMenuOpen}>
          <PopoverTrigger asChild>
            <button className="px-2 py-1 text-[11px] rounded-md border border-border/70 bg-background/60 hover:bg-muted/30 transition-colors">
              Tipo{selectedTypes.size > 0 && (
                <span className="ml-1 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[9px]">
                  {selectedTypes.size}
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2 max-h-72 overflow-y-auto" align="start">
            {availableTypes.length === 0 ? (
              <p className="text-xs text-muted-foreground p-2">Sem eventos</p>
            ) : (
              availableTypes.map(t => (
                <label key={t} className="flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-muted/40 rounded-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedTypes.has(t)}
                    onChange={() => toggleType(t)}
                    className="h-3 w-3"
                  />
                  <span className="flex-1 truncate">{prettifyEventType(t)}</span>
                  <span className="text-[9px] text-muted-foreground">
                    {events.filter(e => e.event_type === t).length}
                  </span>
                </label>
              ))
            )}
          </PopoverContent>
        </Popover>

        {/* Busca livre */}
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar..."
          className="h-7 text-[11px] w-32 flex-1 min-w-[120px] max-w-[200px]"
        />

        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1"
          >
            Limpar
          </button>
        )}
      </div>

      {/* Chips de tipos selecionados */}
      {selectedTypes.size > 0 && (
        <div className="flex flex-wrap gap-1">
          {Array.from(selectedTypes).map(t => (
            <Badge key={t} variant="secondary" className="text-[9px] gap-1 pr-1">
              {prettifyEventType(t)}
              <button onClick={() => toggleType(t)} className="hover:bg-destructive/20 rounded-full p-0.5">
                <X className="h-2.5 w-2.5" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* Contador */}
      <p className="text-[10px] text-muted-foreground">
        {filteredEvents.length} de {events.length} eventos
      </p>

      {filteredEvents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
          <Clock className="h-6 w-6 mb-2 opacity-40" />
          <p className="text-xs">Nenhum evento corresponde aos filtros</p>
        </div>
      ) : (
        <div className="relative">
          {filteredEvents.map((evt, idx) => {
            const Icon = EVENT_ICONS[evt.event_type] || Circle;
            const app = APP_COLORS[evt.source_app] || APP_COLORS.dnmarketing;
            const isLast = idx === filteredEvents.length - 1;

            return (
              <div key={evt.id} className="flex gap-3 pb-4 last:pb-0">
                {/* Line + icon */}
                <div className="flex flex-col items-center">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${app.color}20`, color: app.color }}
                  >
                    <Icon className="h-3 w-3" />
                  </div>
                  {!isLast && (
                    <div className="w-px flex-1 border-l border-dashed border-border mt-1" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 pb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{evt.title}</span>
                    <span
                      className="inline-flex items-center justify-center rounded-sm text-white font-bold"
                      style={{
                        width: 14,
                        height: 14,
                        fontSize: 9,
                        backgroundColor: app.color,
                      }}
                      title={APP_LABELS[evt.source_app] || evt.source_app}
                    >
                      {app.label}
                    </span>
                  </div>
                  {evt.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">{evt.description}</p>
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    {formatDistanceToNow(new Date(evt.occurred_at), { addSuffix: true, locale: ptBR })}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

