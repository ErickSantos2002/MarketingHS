import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { startVisiblePolling, POLLING_INTERVAL_MS } from '@/lib/visiblePolling';

const PAGE_SIZE = 1000;
const MAX_LEADS = 10000;

// Colunas realmente consumidas pelo painel. Evita `select('*')` (que traz
// tambem campos de A/B e auditoria nunca lidos aqui).
const LEAD_COLUMNS = [
  'id', 'created_at', 'updated_at', 'tipo', 'tipo_participante', 'session_id',
  'nome', 'email', 'whatsapp', 'cargo', 'empresa', 'faturamento', 'funcionarios',
  'desafios', 'source', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term',
  'utm_content', 'etiqueta', 'origem_campanha', 'presenca', 'interesse_ecossistema',
  'interesse_mtia', 'interesse_formacao', 'data_interesse', 'last_conversion_date',
  'indicacao', 'dnia_id', 'status', 'lead_score', 'deleted_at',
].join(', ');


export interface Lead {
  id: string;
  created_at: string;
  tipo: string;
  tipo_participante: string | null;
  session_id: string | null;
  nome: string | null;
  email: string | null;
  whatsapp: string | null;
  cargo: string | null;
  empresa: string | null;
  faturamento: string | null;
  funcionarios: string | null;
  desafios: string | null;
  source: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  etiqueta: string | null;
  origem_campanha: string | null;
  presenca: string | null;
  interesse_ecossistema: boolean | null;
  interesse_mtia: boolean | null;
  interesse_formacao: boolean | null;
  data_interesse: string | null;
  last_conversion_date: string | null;
  indicacao: string | null;
  updated_at: string;
}

export type DeletedView = 'active' | 'deleted' | 'all';

export interface LeadsFilters {
  tipo?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  deletedView?: DeletedView;
}

const applyDeletedFilter = <T extends { is: any; not: any }>(query: T, view: DeletedView = 'active'): T => {
  if (view === 'deleted') return query.not('deleted_at', 'is', null);
  if (view === 'all') return query;
  return query.is('deleted_at', null);
};

const isLeadInDateRange = (lead: Lead, dateFrom?: string, dateTo?: string) => {
  if (!dateFrom && !dateTo) return true;

  const rangeStart = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null;
  const rangeEnd = dateTo ? new Date(`${dateTo}T23:59:59`) : null;
  const timestamps = [lead.created_at, lead.last_conversion_date]
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value));

  return timestamps.some((timestamp) => {
    if (Number.isNaN(timestamp.getTime())) return false;
    if (rangeStart && timestamp < rangeStart) return false;
    if (rangeEnd && timestamp > rangeEnd) return false;
    return true;
  });
};

export function useLeads(filters: LeadsFilters = {}) {
  const [allLeads, setAllLeads] = useState<Lead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const filtersRef = useRef(filters);

  // Keep filters ref updated
  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  // Uma unica varredura da tabela (escopo apenas por deletedView, que e o
  // recorte servidor). tipo/search/data sao aplicados no cliente sobre o mesmo
  // conjunto, evitando uma segunda consulta redundante ao banco.
  const fetchAllLeads = useCallback(async (silent: boolean): Promise<void> => {
    if (!silent) {
      setIsLoading(true);
      setError(null);
    }

    try {
      const collected: Lead[] = [];
      let page = 0;
      let hasMore = true;

      while (hasMore && collected.length < MAX_LEADS) {
        const from = page * PAGE_SIZE;
        const to = Math.min(from + PAGE_SIZE - 1, MAX_LEADS - 1);

        const { data, error: queryError } = await applyDeletedFilter(
          supabase.from('leads').select(LEAD_COLUMNS),
          filtersRef.current.deletedView,
        )
          .order('updated_at', { ascending: false })
          .range(from, to);

        if (queryError) throw queryError;

        if (data && data.length > 0) {
          collected.push(...(data as unknown as Lead[]));
          hasMore = data.length === PAGE_SIZE && collected.length < MAX_LEADS;
          page++;
        } else {
          hasMore = false;
        }
      }

      setAllLeads(collected);
    } catch (err) {
      console.error('Error fetching leads:', err);
      if (!silent) setError(err instanceof Error ? err.message : 'Erro ao carregar leads');
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, []);

  // Filtragem no cliente (mesma semantica que antes era feita no servidor)
  const leads = useMemo(() => {
    const search = filters.search?.trim().toLowerCase();
    const tipo = filters.tipo && filters.tipo !== 'all' ? filters.tipo : null;

    return allLeads.filter((lead) => {
      if (tipo && lead.tipo !== tipo) return false;

      if (search) {
        const matches =
          (lead.nome && lead.nome.toLowerCase().includes(search)) ||
          (lead.email && lead.email.toLowerCase().includes(search)) ||
          (lead.empresa && lead.empresa.toLowerCase().includes(search));
        if (!matches) return false;
      }

      return isLeadInDateRange(lead, filters.dateFrom, filters.dateTo);
    });
  }, [allLeads, filters.tipo, filters.search, filters.dateFrom, filters.dateTo]);

  // Busca inicial / quando muda o recorte servidor
  useEffect(() => {
    fetchAllLeads(false);
  }, [fetchAllLeads, filters.deletedView]);

  // Polling silencioso, pausado quando a aba esta em segundo plano
  useEffect(() => {
    return startVisiblePolling(() => {
      fetchAllLeads(true);
    }, POLLING_INTERVAL_MS);
  }, [fetchAllLeads]);

  const refetch = useCallback(() => {
    fetchAllLeads(false);
  }, [fetchAllLeads]);

  return { leads, allLeads, isLoading, error, refetch };
}

