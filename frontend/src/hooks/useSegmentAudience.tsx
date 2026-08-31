import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

// Contagem e amostra de nomes da audiência (união de inclusões menos exclusões),
// vindas das RPCs count_segment_audience / resolve_segment_audience -- as MESMAS
// que o send-campaign usa. É o que garante que o número exibido seja o número
// enviado.
//
// Debounce porque cada mudança de seleção dispara SQL dinâmico sobre `leads`:
// clicar em quatro segmentos seguidos não deve gerar quatro varreduras.
const DEBOUNCE_MS = 400;
const PREVIEW_LIMIT = 3;

export function useSegmentAudience(include: string[], exclude: string[], enabled = true) {
  const [count, setCount] = useState(0);
  const [previewNames, setPreviewNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Chaves estáveis: o efeito não pode reagir à identidade dos arrays (que muda a
  // cada render do pai) nem à ordem em que o admin clicou nos segmentos.
  const incKey = JSON.stringify([...include].sort());
  const excKey = JSON.stringify([...exclude].sort());

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    setLoading(true);

    const timer = setTimeout(async () => {
      const p_include = JSON.parse(incKey) as string[];
      const p_exclude = JSON.parse(excKey) as string[];

      const [countRes, sampleRes] = await Promise.all([
        supabase.rpc('count_segment_audience' as any, { p_include, p_exclude }),
        supabase.rpc('resolve_segment_audience' as any, { p_include, p_exclude, p_limit: PREVIEW_LIMIT }),
      ]);

      if (cancelled) return;

      const rpcErr = countRes.error || sampleRes.error;
      if (rpcErr) {
        console.error('useSegmentAudience RPC error:', rpcErr);
        setError(rpcErr.message);
        setCount(0);
        setPreviewNames([]);
        setLoading(false);
        return;
      }

      setError(null);
      setCount(typeof countRes.data === 'number' ? countRes.data : 0);

      const ids = ((sampleRes.data as unknown as Array<{ lead_id: string }>) || []).map(r => r.lead_id);
      if (ids.length === 0) {
        setPreviewNames([]);
      } else {
        const { data: leads } = await supabase.from('leads').select('nome').in('id', ids);
        if (cancelled) return;
        setPreviewNames((leads || []).map(l => l.nome || 'Sem nome'));
      }

      if (!cancelled) setLoading(false);
    }, DEBOUNCE_MS);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [incKey, excKey, enabled]);

  return { count, previewNames, loading, error };
}
