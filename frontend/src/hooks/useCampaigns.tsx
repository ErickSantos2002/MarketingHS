import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { includeSegmentIds, excludeSegmentIds, describeAudience } from '@/lib/campaignAudience';
import {
  audienciaDaCampanha,
  cancelarAgendamento,
  criarCampanha,
  duplicarCampanha,
  editarCampanha,
  enviosDaCampanha,
  excluirCampanha,
  lerCampanha,
  listarCampanhas,
  type Campaign as CampanhaApi,
  type CampaignSend,
} from '@/lib/campanhas';

export type { CampaignSend };

export interface Campaign {
  id: string;
  name: string;
  channel: 'email' | 'whatsapp';
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'paused' | 'failed';
  segment_id: string | null;
  segment_ids: string[];
  excluded_segment_ids: string[];
  subject: string | null;
  body: string | null;
  design?: any;
  scheduled_at: string | null;
  sent_at: string | null;
  stats: {
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    failed: number;
  };
  created_at: string;
  updated_at: string;
  segment_name?: string;
}

export interface CampaignStats {
  totalCampaigns: number;
  totalReached: number;
  avgOpenRate: number;
  avgClickRate: number;
}

export interface CampaignLiveStats {
  total: number;
  pending: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  complained: number;
  failed: number;
  unsubscribed: number;
  suppressed: number;
}

const ZERO = { sent: 0, delivered: 0, opened: 0, clicked: 0, failed: 0 };

// As estatísticas agora chegam prontas do servidor, agregadas de campaign_sends
// com os MESMOS filtros de finalize_campaign_if_drained. Antes a lista chamava
// `execute_readonly_query` — uma RPC SECURITY DEFINER que aceita SQL arbitrário
// vindo do navegador — porque `campaigns.stats` é congelada e mostraria ~0% de
// abertura para sempre. O contorno era pior que o defeito.
function daApi(c: CampanhaApi): Campaign {
  const incluir = c.segment_ids ?? [];
  const excluir = c.excluded_segment_ids ?? [];
  return {
    ...c,
    // Derivado, não gravado: o trigger sync_campaign_legacy_segment_id mantém a
    // coluna legada no banco, e a tela só precisa dela para compatibilidade.
    segment_id: incluir[0] ?? null,
    segment_ids: incluir,
    excluded_segment_ids: excluir,
    stats: { ...ZERO, ...(c.stats ?? {}) },
    segment_name: describeAudience(incluir, excluir, c.segment_names ?? {}),
  };
}

export function useCampaigns() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<CampaignStats>({
    totalCampaigns: 0,
    totalReached: 0,
    avgOpenRate: 0,
    avgClickRate: 0,
  });

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    try {
      const parsed = (await listarCampanhas()).map(daApi);
      setCampaigns(parsed);

      // ⚠️ `stats.sent` já é um roll-up que EXCLUI falhas. Subtrair `failed` de
      // novo contaria as falhas duas vezes: uma campanha com 100 entregues e 20
      // bounced reportaria 80, e uma 100% falha contribuiria com número
      // negativo para o total.
      const enviadas = parsed.filter(c => c.status === 'sent');
      const totalReached = enviadas.reduce((soma, c) => soma + c.stats.sent, 0);

      const email = enviadas.filter(c => c.channel === 'email' && c.stats.sent > 0);
      const media = (f: (c: Campaign) => number) =>
        email.length > 0 ? email.reduce((s, c) => s + f(c), 0) / email.length : 0;

      setStats({
        totalCampaigns: enviadas.length,
        totalReached,
        avgOpenRate: Math.round(media(c => (c.stats.opened / c.stats.sent) * 100) * 10) / 10,
        avgClickRate: Math.round(media(c => (c.stats.clicked / c.stats.sent) * 100) * 10) / 10,
      });
    } catch {
      toast.error('Erro ao carregar campanhas');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCampaigns(); }, [fetchCampaigns]);

  const createCampaign = async (data: {
    name: string;
    channel: 'email' | 'whatsapp';
    segment_ids: string[];
    excluded_segment_ids: string[];
    subject: string | null;
    body: string | null;
    scheduled_at: string | null;
    // Aceito por compatibilidade com quem já chamava assim; o servidor ignora e
    // a campanha nasce sempre em `draft`.
    status?: string;
    design?: any;
  }) => {
    try {
      const { id } = await criarCampanha({
        name: data.name,
        channel: data.channel,
        subject: data.subject,
        body: data.body,
        design: data.design,
        segment_ids: data.segment_ids,
        excluded_segment_ids: data.excluded_segment_ids,
        scheduled_at: data.scheduled_at,
      });
      return { id } as unknown as Campaign;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao criar campanha');
      return null;
    }
  };

  // A trava de status é reavaliada NO SERVIDOR, no instante do UPDATE: entre o
  // clique e a chegada da requisição a campanha pode ter mudado de estado. O
  // 409 é o sinal de que a corrida foi perdida.
  const updateCampaign = async (
    id: string,
    data: {
      name: string;
      segment_ids: string[];
      excluded_segment_ids: string[];
      subject: string | null;
      body: string | null;
      design: any;
      scheduled_at: string | null;
      status?: string;
    },
  ): Promise<boolean> => {
    try {
      await editarCampanha(id, {
        name: data.name,
        segment_ids: data.segment_ids,
        excluded_segment_ids: data.excluded_segment_ids,
        subject: data.subject,
        body: data.body,
        design: data.design,
        scheduled_at: data.scheduled_at,
      });
      toast.success('Campanha atualizada');
      fetchCampaigns();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar a campanha');
      fetchCampaigns();
      return false;
    }
  };

  const duplicateCampaign = async (campaign: Campaign) => {
    try {
      await duplicarCampanha(campaign.id);
      toast.success('Campanha duplicada');
      fetchCampaigns();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao duplicar campanha');
    }
  };

  const deleteCampaign = async (id: string) => {
    try {
      await excluirCampanha(id);
      toast.success('Campanha excluída');
      fetchCampaigns();
    } catch (e) {
      // A guarda do banco recusa apagar campanha em envio ou com fila pendente,
      // e a mensagem dela nomeia o motivo — é a única informação acionável que
      // o admin recebe. O backend a devolve como 409.
      toast.error(e instanceof Error ? e.message : 'Erro ao excluir campanha');
      fetchCampaigns();
    }
  };

  const getCampaignSends = async (campaignId: string): Promise<CampaignSend[]> => {
    try {
      return await enviosDaCampanha(campaignId);
    } catch {
      return [];
    }
  };

  // Uma chamada. Antes eram DEZ consultas de contagem, uma por status.
  const getCampaignStats = async (campaignId: string): Promise<CampaignLiveStats> => {
    const vazio: CampaignLiveStats = {
      total: 0, pending: 0, sent: 0, delivered: 0, opened: 0, clicked: 0,
      bounced: 0, complained: 0, failed: 0, unsubscribed: 0, suppressed: 0,
    };
    try {
      const c = await lerCampanha(campaignId);
      return { ...vazio, ...(c.stats ?? {}) };
    } catch {
      return vazio;
    }
  };

  const cancelSchedule = async (id: string) => {
    try {
      await cancelarAgendamento(id);
      toast.success('Agendamento cancelado — a campanha voltou para rascunho');
      fetchCampaigns();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao cancelar o agendamento');
      fetchCampaigns();
    }
  };

  const getCampaignAudience = (id: string) => audienciaDaCampanha(id);

  return {
    campaigns,
    loading,
    stats,
    refetch: fetchCampaigns,
    createCampaign,
    updateCampaign,
    duplicateCampaign,
    deleteCampaign,
    cancelSchedule,
    getCampaignSends,
    getCampaignStats,
    getCampaignAudience,
  };
}
