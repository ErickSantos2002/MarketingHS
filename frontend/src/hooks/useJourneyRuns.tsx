import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

// Um run = um contato dentro de um fluxo. Lê journey_runs DIRETO do client
// (admin JWT + RLS admin_read_journey_runs / "Admins can read all leads"), com o
// nome do lead embutido pela FK journey_runs.lead_id -> leads(id) -- mesmo padrão
// de useSegments. Nada passa por Edge Function: é só leitura coberta por RLS.
export interface JourneyRun {
  id: string;
  current_node_id: string | null;
  state: 'active' | 'waiting' | 'done' | 'failed' | 'exited';
  waiting_event: string | null;
  wakeup_at: string | null;
  entered_at: string;
  updated_at: string;
  leads: { nome: string | null; email: string | null } | null;
}

const PAGE = 1000;
const MAX_ROWS = 20000; // teto de segurança: fluxo grande pode ter muitos runs

export function useJourneyRuns(journeyId: string | null) {
  const [runs, setRuns] = useState<JourneyRun[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchRuns = useCallback(async () => {
    if (!journeyId) { setRuns([]); return; }
    setLoading(true);
    try {
      const all: JourneyRun[] = [];
      // Paginação em páginas de 1000 (padrão useContactsEnriched/useAgendamentos):
      // o .select do supabase-js corta em 1000 por padrão.
      for (let from = 0; from < MAX_ROWS; from += PAGE) {
        const { data, error } = await supabase
          .from('journey_runs')
          .select('id, current_node_id, state, waiting_event, wakeup_at, entered_at, updated_at, leads(nome, email)')
          .eq('journey_id', journeyId)
          .order('updated_at', { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const rows = (data ?? []) as unknown as JourneyRun[];
        all.push(...rows);
        if (rows.length < PAGE) break; // última página
      }
      setRuns(all);
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
