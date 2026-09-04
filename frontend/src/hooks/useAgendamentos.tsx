import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { parseISO, format } from 'date-fns';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';
import { ptBR } from 'date-fns/locale';
import { BRASILIA_TIMEZONE } from '@/hooks/useLeadAnalytics';
import { startVisiblePolling, POLLING_INTERVAL_MS } from '@/lib/visiblePolling';


export interface AgendamentoEvent {
  id: string;
  lead_id: string | null;
  occurred_at: string;
  event_type: string;
}

// ⚠️ `/painel/agendamentos` já devolve tudo (LIMIT 500 no backend, filtrado
// pelos dois tipos legados) numa chamada só — não pagina. A base tem hoje só
// 2 eventos deste tipo; se um dia passar de 500, a rota precisa de paginação
// de verdade, não este hook.

/**
 * Fetches all "agendamento" contact_events (meeting_scheduled / scheduling_widget_booked).
 * Polls every 60s.
 */
export function useAgendamentos() {
  const [events, setEvents] = useState<AgendamentoEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchAll = async () => {
      try {
        const data = await api.get<AgendamentoEvent[]>('/painel/agendamentos');
        const all = (data || []).filter(e => e.occurred_at);
        if (!cancelled) {
          setEvents(all);
          setIsLoading(false);
        }
      } catch (e) {
        console.error('useAgendamentos:', e);
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchAll();
    const stopPolling = startVisiblePolling(fetchAll, POLLING_INTERVAL_MS);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, []);


  return { events, isLoading };
}

/**
 * Aggregates agendamento events by day, optionally scoped to a set of lead_ids
 * and a date range.
 */
export function useAgendamentosByDay(
  events: AgendamentoEvent[],
  leadIds: Set<string> | null,
  dateFrom?: Date | null,
  dateTo?: Date | null,
) {
  return useMemo(() => {
    const counts = new Map<string, number>();
    const fromStr = dateFrom ? format(dateFrom, 'yyyy-MM-dd') : null;
    const toStr = dateTo ? format(dateTo, 'yyyy-MM-dd') : null;

    for (const ev of events) {
      if (leadIds && (!ev.lead_id || !leadIds.has(ev.lead_id))) continue;
      const day = formatInTimeZone(parseISO(ev.occurred_at), BRASILIA_TIMEZONE, 'yyyy-MM-dd');
      if (fromStr && day < fromStr) continue;
      if (toStr && day > toStr) continue;
      counts.set(day, (counts.get(day) || 0) + 1);
    }

    return Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, count]) => ({
        date,
        dateFormatted: format(parseISO(date), 'dd/MM', { locale: ptBR }),
        count,
      }));
  }, [events, leadIds, dateFrom, dateTo]);
}

/**
 * Counts DISTINCT leads that have at least one agendamento within an optional
 * date range and lead scope. Events without a lead_id are ignored.
 */
export function getAgendamentoLeadIds(
  events: AgendamentoEvent[],
  leadIds: Set<string> | null,
  dateFrom?: Date | null,
  dateTo?: Date | null,
): Set<string> {
  const fromStr = dateFrom ? format(dateFrom, 'yyyy-MM-dd') : null;
  const toStr = dateTo ? format(dateTo, 'yyyy-MM-dd') : null;
  const uniqueLeads = new Set<string>();
  for (const ev of events) {
    if (!ev.lead_id) continue;
    if (leadIds && !leadIds.has(ev.lead_id)) continue;
    const day = formatInTimeZone(parseISO(ev.occurred_at), BRASILIA_TIMEZONE, 'yyyy-MM-dd');
    if (fromStr && day < fromStr) continue;
    if (toStr && day > toStr) continue;
    uniqueLeads.add(ev.lead_id);
  }
  return uniqueLeads;
}

export function countAgendamentos(
  events: AgendamentoEvent[],
  leadIds: Set<string> | null,
  dateFrom?: Date | null,
  dateTo?: Date | null,
): number {
  return getAgendamentoLeadIds(events, leadIds, dateFrom, dateTo).size;
}

/**
 * Counts DISTINCT leads that ENTERED the status "MQL - Reunião agendada" today
 * (Brasília timezone), regardless of whether they later moved to another status.
 * Source: contact_events.event_type='contact_updated' with
 * metadata->>'status_atual' = 'MQL - Reunião agendada'.
 */
export function useMqlReuniaoAgendadaToday() {
  const [leadIds, setLeadIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchToday = async () => {
      try {
        // Agregação no banco: a rota devolve apenas os lead_ids distintos do
        // dia (fuso America/Sao_Paulo), em vez de baixar as linhas de evento.
        const data = await api.get<string[]>('/painel/agendamentos/mql-hoje');
        const ids = new Set<string>((data || []).filter((id): id is string => !!id));

        if (!cancelled) {
          setLeadIds(ids);
          setIsLoading(false);
        }
      } catch (e) {
        console.error('useMqlReuniaoAgendadaToday:', e);
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchToday();
    const stopPolling = startVisiblePolling(fetchToday, POLLING_INTERVAL_MS);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, []);


  return { leadIds, count: leadIds.size, isLoading };
}

