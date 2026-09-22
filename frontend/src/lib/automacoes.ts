// Cliente de regras de automação. Substitui a `automations-api` e o acesso
// direto de useAutomationRules, AutomationRuleForm e Automations.
//
// A partir do lote 8D as regras disparam de verdade: um gatilho no banco
// avalia toda escrita relevante em `leads` e enfileira a ação casada em
// `crm_handoffs`. As três ações possíveis são `create_in_growthhs`,
// `move_stage_growthhs` e `block_growthhs` — ver AUTOMACAO_COMO_FUNCIONA.
// `move_stage_growthhs` é a exceção: o contrato do GrowthHS ainda não tem
// rota para mover card de etapa, e desde a revisão final do 8D (I4) salvar
// uma regra dessas é recusado (400) — ver AUTOMACAO_NAO_LIGADA. Condição por
// tag também é recusada (I1): o gatilho não a avalia.
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

// O que acontece hoje, para os banners "regra dispara" da tela de
// Automações. Mesmo papel de NODE_NAO_LIGADO em lib/journeys.ts.
export const AUTOMACAO_COMO_FUNCIONA =
  'Quando um contato muda de etiqueta, status ou pontuação, a primeira regra ' +
  'ativa que casar (por prioridade) envia o contato ao GrowthHS. A entrega ' +
  'aparece na linha do tempo do contato; falhas, em Configurações → GrowthHS.';

// A única ação que ainda não roda: o GrowthHS não tem rota para mover card de
// etapa. É o mesmo texto do 400 do backend (`MSG_MOVER` em
// routers/automacoes.py); em AutomationRuleForm, é o motivo da opção
// desabilitada — as outras duas ações (criar, bloquear) já funcionam.
export const AUTOMACAO_NAO_LIGADA =
  'O GrowthHS ainda não tem rota para mover card de etapa — regra de mover ' +
  'fica disponível quando o contrato tiver a rota.';

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
