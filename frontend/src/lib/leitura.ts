import { api } from '@/lib/api';

export { listarTags } from '@/lib/contatos';

export interface PaginaContatos<T> { itens: T[]; tem_mais: boolean }

// As três visões do original: só ativos, só apagados, ou tudo.
export type VisaoContatos = 'ativos' | 'apagados' | 'todos';

export const listarContatos = <T>(pagina: number, tamanho: number, visao: VisaoContatos) =>
  api.get<PaginaContatos<T>>(`/contatos?pagina=${pagina}&tamanho=${tamanho}&visao=${visao}`);

export interface SinaisEcossistema {
  nexus_contact_id: string | null;
  mentoria_client_id: string | null;
  growthhs_card_id: number | null;
  growthhs_card_url: string | null;
  tem_eventos_nexus: boolean;
  tem_eventos_mentoria: boolean;
  tem_agendamento_aberto: boolean;
}

export const enriquecerContatos = (dniaIds: string[]) =>
  api.post<Record<string, SinaisEcossistema>>('/contatos/enriquecimento', { dnia_ids: dniaIds });

export const tagsPorContato = (leadIds: string[]) =>
  api.post<Record<string, { id: string; nome: string; cor: string | null }[]>>(
    '/contatos/tags-por-contato', { lead_ids: leadIds },
  );

export const conversoesUtm = () =>
  api.get<Record<string, string[]>>('/contatos/conversoes-utm');

export interface TagFicha { id: string; nome: string; cor: string | null }
export interface NotaFicha { id: string; conteudo: string; created_at: string }

export const lerFicha = <T>(leadId: string) =>
  api.get<{ lead: T; tags: TagFicha[]; notas: NotaFicha[] }>(`/contatos/${leadId}`);

export const eventosDoContato = (leadId: string, limite = 50) =>
  api.get<Record<string, unknown>[]>(`/contatos/${leadId}/eventos?limite=${limite}`);

export const conversoesDoContato = (leadId: string) =>
  api.get<Record<string, unknown>[]>(`/contatos/${leadId}/conversoes-lista`);

export const criarNota = (leadId: string, conteudo: string) =>
  api.post<NotaFicha>(`/contatos/${leadId}/notas`, { conteudo });

export const removerNota = (notaId: string) => api.delete<void>(`/notas/${notaId}`);

export const removerTagDoContato = (leadId: string, tagId: string) =>
  api.delete<void>(`/contatos/${leadId}/tags/${tagId}`);

export const criarTag = (nome: string, cor?: string) =>
  api.post<TagFicha>('/tags', { nome, cor });

export const duplicatas = () =>
  api.get<{ tipo: string; chave: string; identidades: Record<string, unknown>[] }[]>(
    '/contatos/duplicatas',
  );

export const fundirIdentidades = (manter: string, descartar: string) =>
  api.post<unknown>('/contatos/duplicatas/fundir', { manter, descartar });

export const lerPreferencia = <T>(chave: string) =>
  api.get<{ valor: T | null }>(`/preferencias/${chave}`);

export const gravarPreferencia = <T>(chave: string, valor: T) =>
  api.put<{ valor: T }>(`/preferencias/${chave}`, { valor });

// Usada só pelo detalhamento de score em LeadDetailSheet: o critério de
// reconversão pergunta quantas vezes o contato converteu.
export const contarConversoes = (leadId: string) =>
  api.get<{ total: number }>(`/contatos/${leadId}/conversoes`).then((r) => r.total);

// --- escrita (lote 1C) ---

export const mudarStatus = (leadId: string, status: string) =>
  api.patch<{ status: string; anterior: string | null }>(
    `/contatos/${leadId}/status`, { status });

export const statusEmLote = (leadIds: string[], status: string) =>
  api.post<{ atualizados: number; status: string }>(
    '/contatos/status-em-lote', { lead_ids: leadIds, status });

export const tagsEmLote = (leadIds: string[], tag: string) =>
  api.post<{ vinculados: number; tag: string }>(
    '/contatos/tags-em-lote', { lead_ids: leadIds, tag });

// O servidor decide qual dos três casos se aplica e diz qual foi.
export type CasoFusao = 'leads' | 'identidades' | 'vinculo';

export const fundirContatos = (manter: string, descartar: string) =>
  api.post<{
    caso: CasoFusao;
    mantido?: string;
    movidos?: Record<string, number>;
    identidade?: string;
  }>('/contatos/fundir', { manter, descartar });

export const editarContato = (leadId: string, campos: Record<string, unknown>) =>
  api.patch<{ atualizados: string[] }>(`/contatos/${leadId}`, campos);

export const excluirContato = (leadId: string) =>
  api.delete<void>(`/contatos/${leadId}`);
