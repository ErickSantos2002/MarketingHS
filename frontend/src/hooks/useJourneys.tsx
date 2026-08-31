import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { Journey, JourneyNodeMetrics } from '@/lib/journeys';

export function useJourneys() {
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchJourneys = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke('journeys-api', { method: 'GET' });
    if (error) {
      toast.error('Erro ao carregar fluxos');
      setJourneys([]);
    } else {
      setJourneys((data?.data ?? []) as Journey[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchJourneys(); }, [fetchJourneys]);

  const createJourney = async (payload: Partial<Journey>): Promise<Journey | null> => {
    const { data, error } = await supabase.functions.invoke('journeys-api', {
      method: 'POST', body: payload,
    });
    if (error || data?.error) {
      toast.error(data?.error || 'Erro ao criar fluxo');
      return null;
    }
    toast.success('Fluxo criado');
    await fetchJourneys();
    return data.journey as Journey;
  };

  const updateJourney = async (id: string, payload: Partial<Journey>): Promise<boolean> => {
    const { data, error } = await supabase.functions.invoke(`journeys-api?id=${id}`, {
      method: 'PATCH', body: payload,
    });
    if (error || data?.error) {
      // A mensagem do banco (grafo cíclico, nó sem config, fluxo sem nós) é a
      // mensagem útil para o usuário -- mostrar, não mascarar.
      toast.error(data?.error || 'Erro ao salvar fluxo');
      return false;
    }
    await fetchJourneys();
    return true;
  };

  const deleteJourney = async (id: string): Promise<boolean> => {
    const { data, error } = await supabase.functions.invoke(`journeys-api?id=${id}`, { method: 'DELETE' });
    if (error || data?.error) {
      toast.error(data?.error || 'Erro ao excluir fluxo');
      return false;
    }
    toast.success('Fluxo excluído');
    await fetchJourneys();
    return true;
  };

  return { journeys, loading, fetchJourneys, createJourney, updateJourney, deleteJourney };
}

export function useJourney(id: string | undefined) {
  const [journey, setJourney] = useState<Journey | null>(null);
  const [metrics, setMetrics] = useState<Record<string, JourneyNodeMetrics>>({});
  const [runs, setRuns] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const fetchJourney = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const { data, error } = await supabase.functions.invoke(`journeys-api?id=${id}`, { method: 'GET' });
    if (error || data?.error) {
      toast.error(data?.error || 'Erro ao carregar fluxo');
      setJourney(null);
    } else {
      setJourney(data.data as Journey);
      setMetrics((data.metrics ?? {}) as Record<string, JourneyNodeMetrics>);
      setRuns((data.runs ?? {}) as Record<string, number>);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { fetchJourney(); }, [fetchJourney]);

  return { journey, metrics, runs, loading, refetch: fetchJourney };
}
