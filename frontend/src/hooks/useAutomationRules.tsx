import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { AutomationRule } from '@/lib/automationEngine';

export function useAutomationRules() {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRules = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('automation_rules')
      .select('*')
      .order('priority', { ascending: false });

    if (error) {
      toast.error('Erro ao carregar regras');
    } else {
      setRules((data || []) as unknown as AutomationRule[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  const toggleRule = async (id: string, isActive: boolean) => {
    const { error } = await supabase
      .from('automation_rules')
      .update({ is_active: isActive } as any)
      .eq('id', id);

    if (error) {
      toast.error('Erro ao atualizar regra');
    } else {
      setRules(prev => prev.map(r => r.id === id ? { ...r, is_active: isActive } : r));
      toast.success(isActive ? 'Regra ativada' : 'Regra desativada');
    }
  };

  const deleteRule = async (id: string) => {
    const { error } = await supabase
      .from('automation_rules')
      .delete()
      .eq('id', id);

    if (error) {
      toast.error('Erro ao excluir regra');
    } else {
      setRules(prev => prev.filter(r => r.id !== id));
      toast.success('Regra excluída');
    }
  };

  const saveRule = async (rule: Partial<AutomationRule> & { id?: string }) => {
    const payload: any = {
      name: rule.name,
      priority: rule.priority,
      condition_type: rule.condition_type,
      condition_operator: rule.condition_operator,
      condition_value: rule.condition_value,
      conditions: rule.conditions,
      condition_logic: rule.condition_logic || 'and',
      action_type: rule.action_type,
      action_value: rule.action_value,
      action_metadata: rule.action_metadata,
      is_active: rule.is_active,
    };

    if (rule.id) {
      const { error } = await supabase
        .from('automation_rules')
        .update(payload)
        .eq('id', rule.id);

      if (error) {
        toast.error('Erro ao salvar regra');
        return false;
      }
    } else {
      payload.is_active = rule.is_active ?? true;
      const { error } = await supabase
        .from('automation_rules')
        .insert(payload);

      if (error) {
        toast.error('Erro ao criar regra');
        return false;
      }
    }

    toast.success('Regra salva!');
    await fetchRules();
    return true;
  };

  return { rules, loading, fetchRules, toggleRule, deleteRule, saveRule };
}
