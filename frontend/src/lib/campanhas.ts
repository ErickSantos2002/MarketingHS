// Cliente de campanhas. Substitui o acesso direto ao banco de useCampaigns e
// CampaignDetail.
//
// A API já usa os nomes de campo da tabela, então aqui não há tradução —
// só o transporte e os tipos.
import { api } from '@/lib/api';

export interface CampaignStatsNumbers {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  failed: number;
  suppressed: number;
  pending: number;
  bounced: number;
  complained: number;
  unsubscribed: number;
  total: number;
}

export interface Campaign {
  id: string;
  name: string;
  channel: 'email' | 'whatsapp';
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'paused' | 'failed';
  segment_ids: string[];
  excluded_segment_ids: string[];
  // Mapa id -> nome, cobrindo inclusões e exclusões. É o que
  // describeAudience consome; um id ausente é segmento apagado.
  segment_names: Record<string, string>;
  subject: string | null;
  body: string | null;
  design: any;
  scheduled_at: string | null;
  sent_at: string | null;
  // Ao vivo, agregado de campaign_sends no servidor. A coluna congelada vem em
  // `stats_congelado` — ela só é escrita uma vez, quando a fila drena, e por
  // isso mostraria ~0% de abertura para sempre.
  stats: CampaignStatsNumbers;
  stats_congelado: Partial<CampaignStatsNumbers> | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignSend {
  id: string;
  campaign_id: string;
  lead_id: string | null;
  dnia_id: string | null;
  channel: string;
  status: string;
  sent_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  error: string | null;
  lead_name: string;
  lead_email: string;
  lead_phone: string;
}

interface Pagina<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

export const listarCampanhas = () =>
  api.get<Pagina<Campaign>>('/campanhas?limit=100').then(p => p.data);

export const lerCampanha = (id: string) =>
  api.get<Campaign & { sends: CampaignSend[] }>(`/campanhas/${id}`);

export interface CampanhaEntrada {
  name: string;
  channel: 'email' | 'whatsapp';
  subject?: string | null;
  body?: string | null;
  design?: any;
  segment_ids?: string[];
  excluded_segment_ids?: string[];
  scheduled_at?: string | null;
}

// ⚠️ O `status` não entra: a campanha nasce sempre em `draft`. O servidor
// ignora o campo, e mandá-lo daqui só criaria a impressão de que dá para
// escolher.
export const criarCampanha = (dados: CampanhaEntrada) =>
  api.post<{ id: string }>('/campanhas', dados);

// PATCH parcial: mandar só o que mudou.
export const editarCampanha = (id: string, dados: Partial<CampanhaEntrada>) =>
  api.patch<{ id: string }>(`/campanhas/${id}`, dados);

export const duplicarCampanha = (id: string) =>
  api.post<{ id: string }>(`/campanhas/${id}/duplicar`);

export const excluirCampanha = (id: string) =>
  api.delete<void>(`/campanhas/${id}`);

export const enviosDaCampanha = (id: string) =>
  api.get<CampaignSend[]>(`/campanhas/${id}/envios`);

export const cancelarAgendamento = (id: string) =>
  api.post<{ id: string; status: string }>(`/campanhas/${id}/cancelar-agendamento`);

export interface AudienciaCampanha {
  total: number;
  amostra_nomes: string[];
  teto_aplicado: boolean;
}

export const audienciaDaCampanha = (id: string) =>
  api.get<AudienciaCampanha>(`/campanhas/${id}/audiencia`);
