import { useState, useEffect, useCallback } from 'react';
import { execucoesDaJornada, type ExecucaoDeJornada } from '@/lib/jornadas';

// Um run = um contato dentro de um fluxo. A leitura passou a ser da API própria
// (`GET /jornadas/{id}/execucoes`), que faz o JOIN com `leads` no servidor.
//
// ⚠️ A paginação some de propósito. A origem lia de 1000 em 1000 até 20 mil
// linhas para desenhar uma lista de execuções recentes; o servidor devolve as
// 200 mais recentes e o teto passa a ser dele. Fluxo grande não trafega mais
// inteiro para o navegador.
export type JourneyRun = ExecucaoDeJornada;

export function useJourneyRuns(journeyId: string | null) {
  const [runs, setRuns] = useState<JourneyRun[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchRuns = useCallback(async () => {
    if (!journeyId) { setRuns([]); return; }
    setLoading(true);
    try {
      setRuns(await execucoesDaJornada(journeyId));
    } catch (err) {
      console.error('useJourneyRuns:', err);
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, [journeyId]);

  useEffect(() => { fetchRuns(); }, [fetchRuns]);

  return { runs, loading, refetch: fetchRuns };
}
