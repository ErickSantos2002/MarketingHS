import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { ScoringConfig, ScoringCriteria, ScoringThresholds } from '@/lib/leadScoring';

export function useScoringConfig() {
  const [config, setConfig] = useState<ScoringConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('scoring_config')
      .select('*')
      .limit(1)
      .single();

    if (!error && data) {
      setConfig({
        id: data.id,
        criteria: data.criteria as unknown as ScoringCriteria,
        thresholds: data.thresholds as unknown as ScoringThresholds,
        updated_at: data.updated_at,
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const save = async (criteria: ScoringCriteria, thresholds: ScoringThresholds) => {
    if (!config) return;
    setSaving(true);
    const { error } = await supabase
      .from('scoring_config')
      .update({ criteria: criteria as any, thresholds: thresholds as any, updated_at: new Date().toISOString() })
      .eq('id', config.id);

    if (error) {
      toast.error('Erro ao salvar configuração');
    } else {
      toast.success('Configuração salva!');
      setConfig({ ...config, criteria, thresholds });
    }
    setSaving(false);
  };

  const recalculateAll = async () => {
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID || '';
    const { data: session } = await supabase.auth.getSession();
    const token = session?.session?.access_token;

    const res = await globalThis.fetch(`https://${projectId}.supabase.co/functions/v1/recalculate-all-scores`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    if (!res.ok) throw new Error('Falha ao recalcular');
    return res.json();
  };

  return { config, loading, saving, save, recalculateAll, refetch: loadConfig };
}
