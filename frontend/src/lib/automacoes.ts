// Cliente de regras de automação. Substitui a `automations-api` e o acesso
// direto de useAutomationRules, AutomationRuleForm e Automations.
//
// ⚠️ **Nenhuma regra dispara hoje.** As três ações possíveis são o Nexus
// (`create_in_nexus`, `move_stage_nexus`, `block_nexus`) e a integração com o
// GrowthHS é o lote 5. O cadastro existe e é real — a regra fica guardada,
// pronta —, mas nada a executa. A tela diz isso; ver AUTOMACAO_NAO_LIGADA.
import { api } from '@/lib/api';

export interface AutomationCondition {
  type: string;
  operator: string;
  value: string;
}

export interface AutomationRule {
  id: string;
  name: string;
  is_active: boolean;
  priority: number;
  condition_type: string;
  condition_operator: string;
  condition_value: string;
  conditions: AutomationCondition[];
  condition_logic: 'and' | 'or';
  action_type: string;
  action_value: string | null;
  action_metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// A frase única sobre o que não roda. Mesmo papel de NODE_NAO_LIGADO em
// lib/journeys.ts: quando o lote 5 ligar o Nexus, muda-se aqui e a tela toda
// para de mentir de uma vez.
export const AUTOMACAO_NAO_LIGADA =
  'A integração com o GrowthHS ainda não está ligada neste sistema. As regras ' +
  'ficam salvas e prontas, mas nenhuma dispara: nada é criado, movido ou ' +
  'bloqueado no Nexus até o próximo lote.';

export const listarRegras = () => api.get<AutomationRule[]>('/automacoes');

export type RegraEntrada = Omit<AutomationRule, 'id' | 'created_at' | 'updated_at'>;

export const criarRegra = (dados: Partial<RegraEntrada>) =>
  api.post<{ id: string }>('/automacoes', dados);

export const editarRegra = (id: string, dados: Partial<RegraEntrada>) =>
  api.patch<{ id: string }>(`/automacoes/${id}`, dados);

export const excluirRegra = (id: string) =>
  api.delete<void>(`/automacoes/${id}`);

export interface PreviaDeRegra {
  total: number;
  amostra: { id: string; nome: string | null; email: string | null; etiqueta: string | null }[];
}

// ⚠️ Só o total e uma amostra voltam. A origem trazia a lista inteira de leads
// para o navegador só para ler `.length`.
export const previaDaRegra = (regra: {
  conditions?: AutomationCondition[];
  condition_logic?: string;
  condition_type?: string;
  condition_operator?: string;
  condition_value?: string;
}) => api.post<PreviaDeRegra>('/automacoes/previa', regra);
