import { useState, useEffect, useCallback } from 'react';
import { lerScoring, gravarScoring, recalcularScores } from '@/lib/contatos';
import { toast } from 'sonner';
import type { ScoringConfig, ScoringCriteria, ScoringThresholds } from '@/lib/leadScoring';

export function useScoringConfig() {
  const [config, setConfig] = useState<ScoringConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const data = await lerScoring();
      setConfig({
        // A régua é uma linha só; o id deixou de ser necessário para gravar,
        // mas o tipo da tela ainda o pede.
        id: 'unica',
        criteria: data.criteria as unknown as ScoringCriteria,
        thresholds: data.thresholds as unknown as ScoringThresholds,
        updated_at: data.updated_at,
      });
    } catch {
      toast.error('Não foi possível carregar a régua de scoring');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const save = async (criteria: ScoringCriteria, thresholds: ScoringThresholds) => {
    if (!config) return;
    setSaving(true);
    try {
      await gravarScoring({
        criteria: criteria as unknown as Record<string, unknown>,
        thresholds: thresholds as unknown as Record<string, unknown>,
      });
      // ⚠️ Salvar NÃO repontua a base: o scoring é um trigger, e mudar a régua
      // não toca em linha nenhuma de `leads`. Quem quiser aplicar a régua nova
      // ao que já existe precisa recalcular.
      toast.success('Régua salva. Para aplicá-la à base, use "Recalcular".');
      setConfig({ ...config, criteria, thresholds });
    } catch {
      toast.error('Erro ao salvar configuração');
    } finally {
      setSaving(false);
    }
  };

  const recalculateAll = async () => recalcularScores();

  return { config, loading, saving, save, recalculateAll, refetch: loadConfig };
}
