import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import {
  listarJornadas, obterJornada, criarJornada, editarJornada, excluirJornada,
  type JornadaPatch,
} from '@/lib/jornadas';
import { ErroApi } from '@/lib/api';
import type { Journey, JourneyNodeMetrics } from '@/lib/journeys';

// A mensagem do banco (grafo cíclico, nó sem config, fluxo sem nós, fluxo com
// execuções que não se apaga) é a mensagem útil para quem monta o fluxo. A API
// a repassa em `detail`, e o ErroApi a carrega em `message` -- mostrar, não
// mascarar por um genérico.
const motivo = (erro: unknown, padrao: string) =>
  erro instanceof ErroApi ? erro.message : padrao;

export function useJourneys() {
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchJourneys = useCallback(async () => {
    setLoading(true);
    try {
      setJourneys(await listarJornadas());
    } catch (erro) {
      toast.error(motivo(erro, 'Erro ao carregar fluxos'));
      setJourneys([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchJourneys(); }, [fetchJourneys]);

  // Devolve só o `id` — é tudo que a API dá ao criar, e tudo que quem chama
  // usa (navegar para o construtor do fluxo novo).
  const createJourney = async (payload: Partial<Journey>): Promise<Journey | null> => {
    try {
      const novo = await criarJornada(payload as Parameters<typeof criarJornada>[0]);
      toast.success('Fluxo criado');
      await fetchJourneys();
      return novo as Journey;
    } catch (erro) {
      toast.error(motivo(erro, 'Erro ao criar fluxo'));
      return null;
    }
  };

  const updateJourney = async (id: string, payload: Partial<Journey>): Promise<boolean> => {
    try {
      await editarJornada(id, payload as JornadaPatch);
      await fetchJourneys();
      return true;
    } catch (erro) {
      toast.error(motivo(erro, 'Erro ao salvar fluxo'));
      return false;
    }
  };

  const deleteJourney = async (id: string): Promise<boolean> => {
    try {
      await excluirJornada(id);
      toast.success('Fluxo excluído');
      await fetchJourneys();
      return true;
    } catch (erro) {
      toast.error(motivo(erro, 'Erro ao excluir fluxo'));
      return false;
    }
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
    try {
      const r = await obterJornada(id);
      setJourney(r.data);
      setMetrics(r.metrics ?? {});
      setRuns(r.runs ?? {});
    } catch (erro) {
      toast.error(motivo(erro, 'Erro ao carregar fluxo'));
      setJourney(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchJourney(); }, [fetchJourney]);

  return { journey, metrics, runs, loading, refetch: fetchJourney };
}
