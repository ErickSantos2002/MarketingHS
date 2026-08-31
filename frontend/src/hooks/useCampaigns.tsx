import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { includeSegmentIds, excludeSegmentIds, describeAudience } from '@/lib/campaignAudience';

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
  lead_name?: string;
  lead_email?: string;
  lead_phone?: string;
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

const SEND_STATUSES = [
  'pending', 'sent', 'delivered', 'opened', 'clicked',
  'bounced', 'complained', 'failed', 'unsubscribed', 'suppressed',
] as const;

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
    const { data, error } = await supabase
      .from('campaigns' as any)
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      toast.error('Erro ao carregar campanhas');
      setLoading(false);
      return;
    }

    const raw = (data || []) as any[];

    // Agora uma campanha pode referenciar N segmentos de inclusão e N de exclusão.
    // Buscamos os nomes de todos de uma vez e deixamos describeAudience montar o
    // rótulo -- a mesma função usada em qualquer outro lugar, para os dois não
    // divergirem.
    const segIds = [...new Set(
      raw.flatMap(c => [...includeSegmentIds(c), ...excludeSegmentIds(c)])
    )];
    let segMap: Record<string, string> = {};
    if (segIds.length > 0) {
      const { data: segs } = await supabase.from('segments').select('id, name').in('id', segIds);
      if (segs) segMap = Object.fromEntries(segs.map(s => [s.id, s.name]));
    }

    // Correção I4 (achado do review final): `campaigns.stats` (JSONB) só é recomputado
    // uma vez, em finalize_campaign_if_drained, no instante em que a fila drena — antes
    // de qualquer humano abrir ou clicar em algo. Nada recomputa depois disso, então a
    // lista lia esse valor congelado para sempre e mostrava ~0% de abertura/clique. Aqui
    // trocamos a leitura da coluna congelada por uma única query agregada (GROUP BY) ao
    // vivo sobre campaign_sends para TODAS as campanhas visíveis — uma query em vez de N
    // chamadas por campanha (useCampaigns.getCampaignStats, usado no detalhe, já é ao
    // vivo mas é 1 campanha por vez; aqui precisamos de todas de uma vez). Mesmo padrão
    // de agregação via execute_readonly_query já usado em usePages.tsx e campaigns-api.
    const campaignIds = raw
      .map(c => String(c.id))
      .filter(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));

    const liveStatsByCampaign: Record<string, Campaign['stats']> = {};
    if (campaignIds.length > 0) {
      const idList = campaignIds.map(id => `'${id}'`).join(',');
      const { data: aggRows, error: aggErr } = await supabase.rpc('execute_readonly_query', {
        query_text: `SELECT campaign_id, status, count(*)::int AS n FROM campaign_sends WHERE campaign_id IN (${idList}) GROUP BY campaign_id, status`,
      });
      if (aggErr) {
        console.error('campaign list live stats aggregation failed, falling back to frozen campaigns.stats:', aggErr);
      } else {
        const byCampaign: Record<string, Record<string, number>> = {};
        for (const r of (aggRows as unknown as Array<{ campaign_id: string; status: string; n: number }> | null) || []) {
          (byCampaign[r.campaign_id] ??= {})[r.status] = r.n;
        }
        // Roll-up semantics: sent ⊇ delivered ⊇ opened ⊇ clicked (mesma lógica de
        // getCampaignStats/campaigns-api, para as taxas baterem em toda a UI).
        for (const [campaignId, m] of Object.entries(byCampaign)) {
          const clicked = m.clicked ?? 0;
          const opened = clicked + (m.opened ?? 0);
          const delivered = opened + (m.delivered ?? 0);
          const sent = delivered + (m.sent ?? 0);
          const failed = (m.failed ?? 0) + (m.bounced ?? 0);
          liveStatsByCampaign[campaignId] = { sent, delivered, opened, clicked, failed };
        }
      }
    }

    const parsed: Campaign[] = raw.map(c => ({
      ...c,
      stats: liveStatsByCampaign[String(c.id)]
        ?? (typeof c.stats === 'string' ? JSON.parse(c.stats) : (c.stats || { sent: 0, delivered: 0, opened: 0, clicked: 0, failed: 0 })),
      segment_ids: Array.isArray(c.segment_ids) ? c.segment_ids : [],
      excluded_segment_ids: Array.isArray(c.excluded_segment_ids) ? c.excluded_segment_ids : [],
      segment_name: describeAudience(includeSegmentIds(c), excludeSegmentIds(c), segMap),
    }));

    setCampaigns(parsed);

    // Compute global stats
    // Correção (achado do review final): `c.stats.sent` já é um roll-up que
    // EXCLUI falhas (ver bloco acima: `sent = delivered + m.sent`, sem somar
    // `failed`/`bounced` — mesma semântica de finalize_campaign_if_drained).
    // Subtrair `c.stats.failed` de novo contava as falhas duas vezes: uma
    // campanha com 100 entregues + 20 bounced reportava 80 (deveria ser 100),
    // e uma campanha 100% falha (sent=0, failed=50) contribuía -50 para o
    // total, podendo deixar o card de KPI negativo.
    const sentCampaigns = parsed.filter(c => c.status === 'sent');
    const totalReached = sentCampaigns.reduce((sum, c) => sum + c.stats.sent, 0);

    const emailCampaigns = sentCampaigns.filter(c => c.channel === 'email' && c.stats.sent > 0);
    const avgOpen = emailCampaigns.length > 0
      ? emailCampaigns.reduce((sum, c) => sum + (c.stats.opened / c.stats.sent) * 100, 0) / emailCampaigns.length
      : 0;
    const avgClick = emailCampaigns.length > 0
      ? emailCampaigns.reduce((sum, c) => sum + (c.stats.clicked / c.stats.sent) * 100, 0) / emailCampaigns.length
      : 0;

    setStats({
      totalCampaigns: sentCampaigns.length,
      totalReached,
      avgOpenRate: Math.round(avgOpen * 10) / 10,
      avgClickRate: Math.round(avgClick * 10) / 10,
    });

    setLoading(false);
  }, []);

  useEffect(() => { fetchCampaigns(); }, [fetchCampaigns]);

  const createCampaign = async (data: {
    name: string;
    channel: 'email' | 'whatsapp';
    // `segment_id` não entra mais no payload: o trigger trg_sync_campaign_legacy_segment_id
    // o deriva de segment_ids[1] no banco. Enviá-lo daqui só criaria uma segunda
    // fonte de verdade para o mesmo dado.
    segment_ids: string[];
    excluded_segment_ids: string[];
    subject: string | null;
    body: string | null;
    scheduled_at: string | null;
    status: string;
    // Opcional porque o wizard grava o design num UPDATE separado, depois do
    // insert (ele só existe após o export do Unlayer). Quem já tem o design em
    // mãos -- o duplicateCampaign -- passa aqui e evita a segunda viagem.
    design?: any;
  }) => {
    const { data: result, error } = await supabase
      .from('campaigns' as any)
      .insert(data as any)
      .select()
      .single();

    if (error) {
      // A mensagem do banco vai junto: um toast genérico transformou uma coluna
      // faltando (migration não aplicada) num "Erro ao criar campanha" sem
      // nenhuma pista, e o diagnóstico teve que sair do catálogo do Postgres.
      toast.error('Erro ao criar campanha' + (error.message ? `: ${error.message}` : ''));
      return null;
    }
    return result as any as Campaign;
  };

  // Edição só faz sentido enquanto a campanha ainda não saiu. O filtro de status é
  // reavaliado NO SERVIDOR, no instante do UPDATE: entre o clique do admin e a
  // chegada da requisição, o cron promote-scheduled-campaigns (roda a cada minuto)
  // pode ter promovido a campanha para 'sending'. O .select('id') é o que permite
  // distinguir "atualizei" de "não casou nenhuma linha" -- o PostgREST devolve
  // error: null nos dois casos. Mesmo padrão de cancelSchedule/deleteCampaign.
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
      status: string;
    },
  ): Promise<boolean> => {
    const { data: rows, error } = await supabase
      .from('campaigns' as any)
      .update({ ...data, updated_at: new Date().toISOString() } as any)
      .eq('id', id)
      .in('status', ['draft', 'scheduled'])
      .select('id');

    if (error) {
      toast.error('Erro ao salvar a campanha');
      return false;
    }
    if (!rows || rows.length === 0) {
      toast.error('A campanha já começou a ser enviada e não pode mais ser editada.');
      fetchCampaigns(); // ressincroniza a UI com o status real
      return false;
    }
    toast.success('Campanha atualizada');
    fetchCampaigns();
    return true;
  };

  const duplicateCampaign = async (campaign: Campaign) => {
    const newCampaign = await createCampaign({
      name: campaign.name + ' (cópia)',
      channel: campaign.channel,
      segment_ids: includeSegmentIds(campaign),
      excluded_segment_ids: excludeSegmentIds(campaign),
      subject: campaign.subject,
      body: campaign.body,
      // Sem o design, a cópia levava só o HTML: ao abrir no wizard o Unlayer não
      // tinha o que carregar, caía no template base e o layout original morria no
      // primeiro salvamento. `design` não está no tipo Campaign (a coluna existe
      // no banco mas não em types.ts), daí o cast -- mesmo padrão do wizard.
      design: (campaign as any).design ?? null,
      scheduled_at: null,
      status: 'draft',
    });
    if (newCampaign) {
      toast.success('Campanha duplicada');
      fetchCampaigns();
    }
  };

  // Exclusão protegida contra corrida com o cron: o filtro de status é reavaliado
  // no servidor, no instante do DELETE. Entre o render da lista e o clique do admin,
  // o promote-scheduled-campaigns (roda a cada minuto) pode ter promovido a campanha
  // para 'sending' — e campaign_sends tem ON DELETE CASCADE, então excluir aqui
  // destruiria os envios de uma campanha cujos emails JÁ estão saindo (inclusive as
  // linhas que o resend-webhook ainda precisa para correlacionar). O .select('id')
  // é o que permite distinguir "excluí" de "não casou nenhuma linha" — o PostgREST
  // devolve error: null nos dois casos.
  //
  // Status permitidos: todos MENOS 'sending' — 'draft'/'scheduled'/'sent'/'failed'/
  // 'paused' já podem ser excluídos pelo admin (com a advertência sobre os envios
  // que serão perdidos, mostrada no diálogo de confirmação — ver Campaigns.tsx).
  // O guard real (defesa em profundidade, independente deste filtro client-side)
  // é o trigger trg_guard_campaign_delete no banco (migration
  // 20260714170000_campaign_delete_relax.sql): ele bloqueia status='sending' E
  // qualquer campaign_sends 'pending' da campanha, incondicionalmente. Por isso o
  // .in() aqui é só uma otimização (evita a viagem ao banco pra descobrir que vai
  // ser rejeitado) — o tratamento de "0 linhas" abaixo cobre tanto a corrida do
  // cron quanto uma rejeição do trigger por 'pending' órfão.
  const deleteCampaign = async (id: string) => {
    const { data, error } = await supabase
      .from('campaigns' as any)
      .delete()
      .eq('id', id)
      .neq('status', 'sending')
      .select('id');

    if (error) {
      toast.error('Erro ao excluir campanha: ' + (error.message || 'a campanha ainda tem envios pendentes na fila.'));
      fetchCampaigns(); // ressincroniza a UI com o status real
      return;
    }
    if (!data || data.length === 0) {
      toast.error('A campanha já começou a ser enviada e não pode mais ser excluída.');
      fetchCampaigns(); // ressincroniza a UI com o status real
      return;
    }
    toast.success('Campanha excluída');
    fetchCampaigns();
  };

  const getCampaignSends = async (campaignId: string): Promise<CampaignSend[]> => {
    const { data, error } = await supabase
      .from('campaign_sends' as any)
      .select('*')
      .eq('campaign_id', campaignId)
      // nullsFirst:false: a partir da Fase 3 os sends nascem 'pending' com sent_at NULL,
      // e em Postgres NULLS vem PRIMEIRO num ORDER BY DESC -- sem isso a lista de envios
      // da campanha mostraria os ainda-nao-enviados acima dos que ja sairam.
      .order('sent_at', { ascending: false, nullsFirst: false });

    if (error) return [];

    const sends = (data || []) as any[];
    const leadIds = [...new Set(sends.filter(s => s.lead_id).map(s => s.lead_id))];
    let leadMap: Record<string, any> = {};
    if (leadIds.length > 0) {
      for (let i = 0; i < leadIds.length; i += 200) {
        const batch = leadIds.slice(i, i + 200);
        const { data: leads } = await supabase.from('leads').select('id, nome, email, whatsapp').in('id', batch);
        if (leads) leads.forEach(l => { leadMap[l.id] = l; });
      }
    }

    return sends.map(s => ({
      ...s,
      lead_name: s.lead_id ? leadMap[s.lead_id]?.nome || '-' : '-',
      lead_email: s.lead_id ? leadMap[s.lead_id]?.email || '-' : '-',
      lead_phone: s.lead_id ? leadMap[s.lead_id]?.whatsapp || '-' : '-',
    }));
  };

  // Stats ao vivo agregadas de campaign_sends (status atualizados pelo resend-webhook).
  // Roll-up: sent ⊇ delivered ⊇ opened ⊇ clicked.
  const getCampaignStats = async (campaignId: string): Promise<CampaignLiveStats> => {
    const counts = await Promise.all(SEND_STATUSES.map(async (s) => {
      const { count } = await supabase
        .from('campaign_sends' as any)
        .select('*', { count: 'exact', head: true })
        .eq('campaign_id', campaignId)
        .eq('status', s);
      return [s, count ?? 0] as const;
    }));
    const m = Object.fromEntries(counts) as Record<(typeof SEND_STATUSES)[number], number>;
    const clicked = m.clicked;
    const opened = clicked + m.opened;
    const delivered = opened + m.delivered;
    const sent = delivered + m.sent;
    // total = todas as linhas de campaign_sends (inclui pending) — base da barra de progresso
    const total = SEND_STATUSES.reduce((acc, s) => acc + m[s], 0);
    return {
      total,
      pending: m.pending,
      sent,
      delivered,
      opened,
      clicked,
      bounced: m.bounced,
      complained: m.complained,
      failed: m.failed,
      unsubscribed: m.unsubscribed,
      suppressed: m.suppressed,
    };
  };

  // Cancelar agendamento: volta a campanha para rascunho. Seguro porque o
  // promote-scheduled-campaigns (pg_cron) só enxerga status = 'scheduled' — uma
  // vez cancelada aqui, o job não a encontra mais na próxima varredura.
  //
  // O .eq('status','scheduled') impede o cancelamento de uma campanha que o cron já
  // promoveu, mas o PostgREST devolve error: null tanto para 1 linha quanto para 0 —
  // sem o .select('id') exibiríamos "Agendamento cancelado" para um envio que, na
  // verdade, está em curso. O array vazio é o único sinal de que perdemos a corrida.
  const cancelSchedule = async (id: string) => {
    const { data, error } = await supabase
      .from('campaigns' as any)
      .update({ status: 'draft', scheduled_at: null } as any)
      .eq('id', id)
      .eq('status', 'scheduled')
      .select('id');

    if (error) {
      toast.error('Erro ao cancelar o agendamento');
      return;
    }
    if (!data || data.length === 0) {
      toast.error('A campanha já começou a ser enviada e não pode mais ser cancelada.');
      fetchCampaigns(); // ressincroniza a UI com o status real
      return;
    }
    toast.success('Agendamento cancelado — a campanha voltou para rascunho');
    fetchCampaigns();
  };

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
  };
}
