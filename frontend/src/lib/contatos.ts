import { api } from '@/lib/api';

export interface LinhaImportacao {
  email: string;
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

export const aplicarTag = (leadId: string, tag: string) =>
  api.post<void>(`/contatos/${leadId}/tags`, { tag });

export const listarTags = () =>
  api.get<{ id: string; nome: string }[]>('/tags');

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
