import { useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { RefreshCw, Users } from 'lucide-react';
import { formatInTimeZone } from 'date-fns-tz';
import { BRASILIA_TIMEZONE } from '@/hooks/useLeadAnalytics';
import { NODE_LABELS, type Journey } from '@/lib/journeys';
import { useJourneyRuns, type JourneyRun } from '@/hooks/useJourneyRuns';

interface Props {
  journey: Journey | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

type StateKey = JourneyRun['state'];

// Rótulos e cores por estado. Mesmo vocabulário visual do STATUS_VARIANT do
// JourneysTab, mas para o estado do RUN (não do fluxo).
const STATE_META: Record<StateKey, { label: string; badge: string }> = {
  active: { label: 'Ativo', badge: 'bg-blue-500/15 text-blue-600 dark:text-blue-400' },
  waiting: { label: 'Aguardando', badge: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  done: { label: 'Concluído', badge: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  failed: { label: 'Falhou', badge: 'bg-destructive/15 text-destructive' },
  exited: { label: 'Saiu', badge: 'bg-muted text-muted-foreground' },
};

const FILTERS: { key: StateKey | 'all'; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'active', label: 'Ativos' },
  { key: 'waiting', label: 'Aguardando' },
  { key: 'done', label: 'Concluídos' },
  { key: 'failed', label: 'Falhou' },
  { key: 'exited', label: 'Saíram' },
];

function fmt(dt: string | null): string {
  if (!dt) return '—';
  try { return formatInTimeZone(new Date(dt), BRASILIA_TIMEZONE, "dd/MM 'às' HH:mm"); }
  catch { return '—'; }
}

export function JourneyContactsDrawer({ journey, open, onOpenChange }: Props) {
  const { runs, loading, refetch } = useJourneyRuns(open ? journey?.id ?? null : null);
  const [filter, setFilter] = useState<StateKey | 'all'>('all');

  // Mapa id-do-nó -> nó, para resolver a etapa de cada run em O(1).
  const nodeById = useMemo(
    () => new Map((journey?.nodes ?? []).map((n) => [n.id, n])),
    [journey],
  );

  // Etapa em que o run está. Estados terminais (done/exited/failed) não têm
  // current_node_id -> mostramos o próprio estado. Nó ausente (removido numa
  // edição do grafo depois que o run passou por ele) -> "etapa removida".
  const stepLabel = (run: JourneyRun): string => {
    if (!run.current_node_id) return STATE_META[run.state].label;
    const node = nodeById.get(run.current_node_id);
    if (!node) return 'etapa removida';
    const base = NODE_LABELS[node.type];
    if (node.type === 'send_email' && node.config?.subject) return `${base} — "${node.config.subject}"`;
    return base;
  };

  const whenLabel = (run: JourneyRun): string => {
    if (run.state === 'waiting') {
      if (run.waiting_event) return `aguardando: ${run.waiting_event}`;
      return `retoma ${fmt(run.wakeup_at)}`;
    }
    return `atualizado ${fmt(run.updated_at)}`;
  };

  const filtered = filter === 'all' ? runs : runs.filter((r) => r.state === filter);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl flex flex-col gap-0 p-0">
        <SheetHeader className="p-4 border-b border-border/40">
          <div className="flex items-center justify-between gap-2">
            <SheetTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" /> Contatos · {journey?.name}
            </SheetTitle>
            <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={refetch} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Atualizar
            </Button>
          </div>
          <p className="text-xs text-muted-foreground text-left">
            {loading ? 'Carregando…' : `${runs.length} contato(s) neste fluxo`}
          </p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {FILTERS.map((f) => {
              const count = f.key === 'all' ? runs.length : runs.filter((r) => r.state === f.key).length;
              return (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                    filter === f.key
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border/60 text-muted-foreground hover:border-border'
                  }`}
                >
                  {f.label} ({count})
                </button>
              );
            })}
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 space-y-2">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14 w-full rounded-md" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Users className="h-10 w-10 mb-2 opacity-30" />
              <p className="text-sm">{runs.length === 0 ? 'Nenhum contato neste fluxo ainda.' : 'Nenhum contato neste filtro.'}</p>
            </div>
          ) : (
            <ul className="divide-y divide-border/40">
              {filtered.map((run) => (
                <li key={run.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{run.leads?.nome || run.leads?.email || 'Contato sem nome'}</p>
                    {run.leads?.nome && run.leads?.email && (
                      <p className="text-[11px] text-muted-foreground truncate">{run.leads.email}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {stepLabel(run)} · {whenLabel(run)}
                    </p>
                  </div>
                  <Badge className={`text-[10px] shrink-0 ${STATE_META[run.state].badge}`}>
                    {STATE_META[run.state].label}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
