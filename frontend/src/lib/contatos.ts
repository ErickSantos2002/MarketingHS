import { api } from '@/lib/api';

export interface LinhaImportacao {
  // Opcional: o CSV pode não ter a coluna. O backend conta essas linhas em
  // `sem_email` e importa o resto.
  email?: string;
  nome?: string;
  whatsapp?: string;
  telefone_completo?: string;
  empresa?: string;
  cargo?: string;
  faturamento?: string;
  funcionarios?: string;
  desafios_ia?: string;
  source?: string;
  status?: string;
  tipo?: string;
}

export interface ResultadoImportacao {
  criados: number;
  atualizados: number;
  inalterados: number;
  sem_email: number;
  erros: string[];
  campos_enriquecidos: number;
  campos_pulados: number;
  contatos: { email: string; id: string }[];
}

export const importarContatos = (
  linhas: LinhaImportacao[],
  modo: 'enriquecer' | 'sobrescrever',
) => api.post<ResultadoImportacao>('/contatos/importar', { linhas, modo });

// ⚠️ Exclusão LÓGICA: o servidor marca `deleted_at` e `deleted_by`. O contato
// some das listas mas continua no banco, e é isso que faz as três visões
// (ativos / apagados / todos) existirem.
export const excluirContato = (leadId: string) =>
  api.delete<void>(`/contatos/${leadId}`);

export const aplicarTag = (leadId: string, tag: string) =>
  api.post<void>(`/contatos/${leadId}/tags`, { tag });

export const listarTags = () =>
  api.get<{ id: string; nome: string; cor: string | null }[]>('/tags');

export interface StatusDeLead {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  is_system: boolean;
}

// O funil, na ordem em que a tela desenha. `leads.status` é FK para
// `lead_statuses(name)` — a lista não é sugestão, é o vocabulário que o banco
// aceita.
export const listarStatusDeLead = () => api.get<StatusDeLead[]>('/lead-statuses');

// Os valores de `leads.tipo` que existem na base. ⚠️ O construtor de segmentos
// trazia esta lista fixa no código, herdada da dn.ia — envelheceu calada e já
// não incluía `csv_import` nem `datacore`.
export const listarTiposDeContato = () => api.get<string[]>('/tipos-de-contato');

export const recalcularScores = () =>
  api.post<{ atualizados: number }>('/contatos/recalcular-scores');

export interface Scoring {
  criteria: Record<string, unknown>;
  thresholds: Record<string, unknown>;
  updated_at: string | null;
}
export const lerScoring = () => api.get<Scoring>('/config/scoring');
export const gravarScoring = (s: Omit<Scoring, 'updated_at'>) =>
  api.put<Scoring>('/config/scoring', s);

// ── Lista de supressão ──────────────────────────────────────────────────────
// Quem está aqui não recebe e-mail de campanha; o worker confere esta lista
// imediatamente antes de cada envio.

export interface Supressao {
  id: string;
  email: string;
  reason: string;
  source: string | null;
  lead_id: string | null;
  created_at: string;
}

export interface PaginaSupressoes {
  data: Supressao[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

export const listarSupressoes = (busca: string, pagina: number, limite: number) =>
  api.get<PaginaSupressoes>(
    `/supressoes?page=${pagina}&limit=${limite}` +
    (busca.trim() ? `&q=${encodeURIComponent(busca.trim())}` : ''));

// Devolve `ja_existia` em vez de erro: suprimir é idempotente por natureza.
export const suprimir = (email: string) =>
  api.post<{ email: string; ja_existia: boolean }>('/supressoes', { email });

export const removerSupressao = (id: string) =>
  api.delete<void>(`/supressoes/${id}`);
