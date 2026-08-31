/**
 * Polling helper que economiza carga no banco:
 * - nao dispara enquanto a aba estiver em segundo plano (`document.hidden`);
 * - se algum tick foi perdido enquanto oculta, faz um refresh unico ao voltar o foco.
 *
 * Uso:
 *   useEffect(() => startVisiblePolling(fetchData, 120000), [fetchData]);
 */
export function startVisiblePolling(run: () => void, intervalMs: number): () => void {
  let missedTick = false;

  const tick = () => {
    if (typeof document !== 'undefined' && document.hidden) {
      missedTick = true;
      return;
    }
    run();
  };

  const intervalId = setInterval(tick, intervalMs);

  const onVisibilityChange = () => {
    if (!document.hidden && missedTick) {
      missedTick = false;
      run();
    }
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  return () => {
    clearInterval(intervalId);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  };
}

export const POLLING_INTERVAL_MS = 120000; // 2 minutos
