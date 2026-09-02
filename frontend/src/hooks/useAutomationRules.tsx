import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import {
  listarRegras, criarRegra, editarRegra, excluirRegra, type AutomationRule,
} from '@/lib/automacoes';
import { ErroApi } from '@/lib/api';

// A mensagem do trigger `validate_automation_rule_fields` nomeia o campo
// inválido. A API a repassa em `detail` — mostrar, não mascarar.
const motivo = (erro: unknown, padrao: string) =>
  erro instanceof ErroApi ? erro.message : padrao;

export function useAutomationRules() {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      setRules(await listarRegras());
    } catch (erro) {
      toast.error(motivo(erro, 'Erro ao carregar regras'));
      setRules([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  const toggleRule = async (id: string, isActive: boolean) => {
    try {
      await editarRegra(id, { is_active: isActive });
      setRules(prev => prev.map(r => r.id === id ? { ...r, is_active: isActive } : r));
      toast.success(isActive ? 'Regra ativada' : 'Regra desativada');
    } catch (erro) {
      toast.error(motivo(erro, 'Erro ao atualizar regra'));
    }
  };

  const deleteRule = async (id: string) => {
    try {
      await excluirRegra(id);
      setRules(prev => prev.filter(r => r.id !== id));
      toast.success('Regra excluída');
    } catch (erro) {
      toast.error(motivo(erro, 'Erro ao excluir regra'));
    }
  };

  const saveRule = async (rule: Partial<AutomationRule> & { id?: string }) => {
    const payload = {
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

    try {
      if (rule.id) {
        await editarRegra(rule.id, payload);
      } else {
        await criarRegra({ ...payload, is_active: rule.is_active ?? true });
      }
    } catch (erro) {
      toast.error(motivo(erro, rule.id ? 'Erro ao salvar regra' : 'Erro ao criar regra'));
      return false;
    }

    toast.success('Regra salva!');
    await fetchRules();
    return true;
  };

  return { rules, loading, fetchRules, toggleRule, deleteRule, saveRule };
}
