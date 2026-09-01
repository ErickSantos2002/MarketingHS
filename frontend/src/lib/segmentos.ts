// Cliente de segmentos. Substitui o acesso direto ao banco de useSegments,
// useSegmentAudience e SegmentFormModal.
//
// A API fala português e o restante do frontend fala a forma antiga (name,
// type, rules...). A tradução mora aqui, num lugar só, para que a troca não
// vaze para as 5 telas que consomem o hook.
import { api } from '@/lib/api';

export interface SegmentRule {
  field: string;
  operator: string;
  value: string;
}

export interface Segment {
  id: string;
  name: string;
  description: string | null;
  type: 'static' | 'dynamic';
  rules: SegmentRule[];
  logic: 'and' | 'or';
  created_at: string;
  updated_at: string;
  contactCount?: number;
}

interface SegmentoApi {
  id: string;
  nome: string;
  descricao: string | null;
  tipo: 'static' | 'dynamic';
  regras: SegmentRule[] | null;
  logica: 'and' | 'or';
  created_at: string;
  updated_at: string;
  total_contatos: number;
}

// A contagem vem junto da lista — o servidor resolve os dois tipos numa
// consulta só. Não há mais uma ida ao banco por segmento.
const daApi = (s: SegmentoApi): Segment & { contactCount: number } => ({
  id: s.id,
  name: s.nome,
  description: s.descricao,
  type: s.tipo,
  rules: Array.isArray(s.regras) ? s.regras : [],
  logic: s.logica === 'or' ? 'or' : 'and',
  created_at: s.created_at,
  updated_at: s.updated_at,
  contactCount: s.total_contatos ?? 0,
});

export const listarSegmentos = () =>
  api.get<SegmentoApi[]>('/segmentos').then(l => l.map(daApi));

export interface SegmentoEntrada {
  nome: string;
  descricao?: string | null;
  tipo: 'static' | 'dynamic';
  regras: SegmentRule[];
  logica: 'and' | 'or';
  lead_ids?: string[] | null;
}

export const criarSegmento = (dados: SegmentoEntrada) =>
  api.post<{ id: string }>('/segmentos', dados);

export const editarSegmento = (id: string, dados: SegmentoEntrada) =>
  api.put<{ id: string }>(`/segmentos/${id}`, dados);

export const duplicarSegmento = (id: string) =>
  api.post<{ id: string }>(`/segmentos/${id}/duplicar`);

export const excluirSegmento = (id: string) =>
  api.delete<void>(`/segmentos/${id}`);

export const contatosDoSegmento = (id: string) =>
  api.get<Record<string, unknown>[]>(`/segmentos/${id}/contatos`);

export const adicionarContatos = (id: string, leadIds: string[]) =>
  api.post<void>(`/segmentos/${id}/contatos`, { lead_ids: leadIds });

export interface Previa {
  total: number;
  amostra: { id: string; nome: string | null; etiqueta: string | null }[];
}

// Total e amostra numa chamada. A lista completa de leads continua sem
// trafegar, mesmo em segmento grande.
export const previaDeRegras = (regras: SegmentRule[], logica: 'and' | 'or') =>
  api.post<Previa>('/segmentos/previa', { regras, logica });

export interface Audiencia {
  total: number;
  amostra_nomes: string[];
}

export const audienciaDeSegmentos = (incluir: string[], excluir: string[]) =>
  api.post<Audiencia>('/segmentos/audiencia', { incluir, excluir });

export const buscarContatos = (q: string) =>
  api.get<{
    id: string; nome: string | null; email: string | null;
    whatsapp: string | null; cargo: string | null; etiqueta: string | null;
  }[]>(`/contatos/busca?q=${encodeURIComponent(q)}`);
