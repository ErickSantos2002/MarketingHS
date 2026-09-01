import { useEffect, useState } from 'react';
import { audienciaDeSegmentos } from '@/lib/segmentos';

// Contagem e amostra de nomes da audiência (união de inclusões menos exclusões).
// O servidor continua chamando count_segment_audience / resolve_segment_audience
// -- as MESMAS funções que o envio de campanha usa. É o que garante que o número
// exibido seja o número enviado.
//
// Debounce porque cada mudança de seleção dispara SQL dinâmico sobre `leads`:
// clicar em quatro segmentos seguidos não deve gerar quatro varreduras.
const DEBOUNCE_MS = 400;

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
      try {
        // Uma chamada: a contagem e a amostra de nomes vêm juntas. Antes eram
        // duas RPCs mais uma consulta em `leads` para resolver os nomes.
        const { total, amostra_nomes } = await audienciaDeSegmentos(
          JSON.parse(incKey) as string[],
          JSON.parse(excKey) as string[],
        );
        if (cancelled) return;
        setError(null);
        setCount(total);
        setPreviewNames(amostra_nomes);
      } catch (e) {
        if (cancelled) return;
        console.error('useSegmentAudience:', e);
        setError(e instanceof Error ? e.message : 'Erro ao calcular a audiência');
        setCount(0);
        setPreviewNames([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [incKey, excKey, enabled]);

  return { count, previewNames, loading, error };
}
