import { useState, useEffect, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Clock, FileText, Mail, MailOpen, ExternalLink, MessageCircle,
  Calendar, TrendingUp, FileCheck, Rocket, Heart, StickyNote, Circle,
  ChevronDown, ChevronUp, Send, ArrowRight, Plus, Trophy, Search, Filter, X,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { format, isToday, isYesterday } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { formatDistanceToNow } from 'date-fns';

interface ContactEvent {
  id: string;
  source_app: string;
  event_type: string;
  title: string;
  description: string | null;
  metadata: any;
  occurred_at: string;
}

const EVENT_ICONS: Record<string, React.ElementType> = {
  form_submitted: FileText,
  lead_qualified: TrendingUp,
  email_sent: Mail,
  email_opened: MailOpen,
  email_clicked: ExternalLink,
  whatsapp_sent: MessageCircle,
  campaign_sent: Send,
  meeting_scheduled: Calendar,
  deal_moved: ArrowRight,
  opportunity_created: Plus,
  proposal_sent: FileCheck,
  deal_won: Trophy,
  onboarding_started: Rocket,
  health_updated: Heart,
  note_added: StickyNote,
};

const APP_COLORS: Record<string, { label: string; color: string; name: string }> = {
  dnmarketing: { label: 'D', color: '#534AB7', name: 'dnMarketing' },
  nexus: { label: 'N', color: '#185FA5', name: 'Nexus' },
  mentoria: { label: 'M', color: '#0F6E56', name: 'mentor.ia' },
  website: { label: 'W', color: '#A8557C', name: 'Website' },
};

const FILTER_OPTIONS = [
  { key: 'all', label: 'Todos' },
  { key: 'dnmarketing', label: 'dnMarketing' },
  { key: 'nexus', label: 'Nexus' },
  { key: 'mentoria', label: 'mentor.ia' },
  { key: 'website', label: 'Website' },
] as const;

function getDateGroupLabel(dateStr: string): string {
  const date = new Date(dateStr);
  if (isToday(date)) return 'Hoje';
  if (isYesterday(date)) return 'Ontem';
  return format(date, "d 'de' MMMM", { locale: ptBR });
}

function groupEventsByDate(events: ContactEvent[]): Record<string, ContactEvent[]> {
  const groups: Record<string, ContactEvent[]> = {};
  for (const evt of events) {
    const key = getDateGroupLabel(evt.occurred_at);
    if (!groups[key]) groups[key] = [];
    groups[key].push(evt);
  }
  return groups;
}

function MetadataExpander({ metadata }: { metadata: any }) {
  const [open, setOpen] = useState(false);
  if (!metadata || Object.keys(metadata).length === 0) return null;

  // Filter out null/undefined values
  const entries = Object.entries(metadata).filter(([, v]) => v != null && v !== '');
  if (entries.length === 0) return null;

  return (
    <div className="mt-1">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5"
      >
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {open ? 'ocultar' : 'ver detalhes'}
      </button>
      {open && (
        <div className="mt-1.5 p-2 rounded bg-muted/30 border border-border/20 text-[11px] space-y-0.5">
          {entries.map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <span className="text-muted-foreground font-medium">{k}:</span>
              <span className="text-foreground">{String(v)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function EventsTimeline({ leadId, dniaId }: { leadId: string; dniaId: string | null }) {
  const [events, setEvents] = useState<ContactEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
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

  const availableTypes = useMemo(
    () => Array.from(new Set(events.map(e => e.event_type))).sort(),
    [events]
  );

  const filteredEvents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter(e => {
      if (filter !== 'all' && e.source_app !== filter) return false;
      if (selectedTypes.length > 0 && !selectedTypes.includes(e.event_type)) return false;
      if (q) {
        const hay = `${e.title || ''} ${e.description || ''} ${e.event_type}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [events, filter, selectedTypes, search]);

  const uniquePlatforms = useMemo(() =>
    new Set(events.map(e => e.source_app)).size,
    [events]
  );

  const grouped = useMemo(() => groupEventsByDate(filteredEvents), [filteredEvents]);

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
      {/* Counter */}
      <p className="text-xs text-muted-foreground">
        {events.length} interaç{events.length === 1 ? 'ão' : 'ões'} · {uniquePlatforms} plataforma{uniquePlatforms !== 1 ? 's' : ''}
        {(filter !== 'all' || selectedTypes.length > 0 || search.trim()) && (
          <> · <span className="text-foreground">{filteredEvents.length} exibidas</span></>
        )}
      </p>

      {/* Search + Event type filter */}
      <div className="flex gap-2 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar no histórico..."
            className="h-8 pl-7 text-xs"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
              <Filter className="h-3.5 w-3.5" />
              Tipo{selectedTypes.length > 0 && <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{selectedTypes.length}</Badge>}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-2">
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-xs font-medium">Tipos de evento</span>
              {selectedTypes.length > 0 && (
                <button onClick={() => setSelectedTypes([])} className="text-[10px] text-muted-foreground hover:text-foreground">Limpar</button>
              )}
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {availableTypes.length === 0 && (
                <p className="text-xs text-muted-foreground px-1">Nenhum tipo disponível</p>
              )}
              {availableTypes.map(t => (
                <label key={t} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-muted/50 cursor-pointer text-xs">
                  <Checkbox
                    checked={selectedTypes.includes(t)}
                    onCheckedChange={(v) => {
                      setSelectedTypes(prev => v ? [...prev, t] : prev.filter(x => x !== t));
                    }}
                  />
                  <span className="flex-1 truncate">{t}</span>
                </label>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Platform pills */}
      <div className="flex gap-1.5 flex-wrap">
        {FILTER_OPTIONS.map(opt => (
          <button
            key={opt.key}
            onClick={() => setFilter(opt.key)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors border ${
              filter === opt.key
                ? 'bg-primary/10 border-primary/30 text-primary'
                : 'bg-muted/30 border-border/30 text-muted-foreground hover:bg-muted/50'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>


      {/* Grouped timeline */}
      <div className="space-y-4">
        {Object.entries(grouped).map(([dateLabel, dateEvents]) => (
          <div key={dateLabel}>
            {/* Date separator */}
            <div className="flex items-center gap-2 mb-2">
              <div className="h-px flex-1 bg-border/40" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                {dateLabel}
              </span>
              <div className="h-px flex-1 bg-border/40" />
            </div>

            {/* Events */}
            <div className="relative">
              {dateEvents.map((evt, idx) => {
                const Icon = EVENT_ICONS[evt.event_type] || Circle;
                const app = APP_COLORS[evt.source_app] || APP_COLORS.dnmarketing;
                const isLast = idx === dateEvents.length - 1;

                return (
                  <div key={evt.id} className="flex gap-3 pb-3 last:pb-0">
                    {/* Platform avatar + line */}
                    <div className="flex flex-col items-center">
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-white font-bold"
                        style={{ backgroundColor: app.color, fontSize: 10 }}
                      >
                        {app.label}
                      </div>
                      {!isLast && (
                        <div className="w-px flex-1 border-l border-dashed border-border mt-1" />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 pb-1">
                      <div className="flex items-center gap-1.5">
                        <Icon className="h-3.5 w-3.5 flex-shrink-0" style={{ color: app.color }} />
                        <span className="text-sm font-medium text-foreground">{evt.title}</span>
                      </div>
                      {evt.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">{evt.description}</p>
                      )}
                      <span className="text-[10px] text-muted-foreground">
                        {formatDistanceToNow(new Date(evt.occurred_at), { addSuffix: true, locale: ptBR })}
                      </span>
                      <MetadataExpander metadata={evt.metadata} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
