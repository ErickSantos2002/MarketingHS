import { useMemo } from "react";

// Refeito em 02/10/2026 (raio-x RD, R6). O que saiu, e por quê:
// - taxa de resposta, abandono, "Horário Crítico" e a nota A–F das campanhas
//   mediam o preenchimento do campo `desafios`, que é do funil de evento da
//   dn.ia — a H&S não o coleta, e tudo ali lia 0% ou 100% de abandono;
// - "hot" era recalculado no navegador com o perfil da dn.ia (cargo decisor +
//   faturamento ICP); agora é a `etiqueta` que o banco grava pela pontuação
//   configurada em Configurações → Lead Scoring;
// - o heatmap dia × hora e as Recomendações saíram da tela: as recomendações
//   ("aumentar investimento", "pausar campanha") não têm custo por trás.

interface Lead {
  id: string;
  email: string | null;
  utm_campaign: string | null;
  etiqueta?: string | null;
}

export interface CampaignScore {
  campaign: string;
  totalLeads: number;
  hotLeads: number;
  hotRate: number;
}

export interface Alert {
  id: string;
  type: 'quality' | 'duplicate';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  value: number;
  campaign?: string;
}

function isHotLead(lead: Lead): boolean {
  return lead.etiqueta === 'hotlead';
}

export function useInsightsAnalytics(leads: Lead[]) {
  // Campanhas por volume, com a fatia hot pela etiqueta do banco
  const campaignScores = useMemo(() => {
    const campaignMap = new Map<string, { total: number; hot: number }>();

    leads.forEach(lead => {
      const campaign = lead.utm_campaign || 'Sem campanha';
      const current = campaignMap.get(campaign) || { total: 0, hot: 0 };
      current.total++;
      if (isHotLead(lead)) current.hot++;
      campaignMap.set(campaign, current);
    });

    const scores: CampaignScore[] = [];
    campaignMap.forEach((data, campaign) => {
      scores.push({
        campaign,
        totalLeads: data.total,
        hotLeads: data.hot,
        hotRate: data.total > 0 ? (data.hot / data.total) * 100 : 0,
      });
    });

    return scores.sort((a, b) => b.totalLeads - a.totalLeads);
  }, [leads]);

  const alerts = useMemo(() => {
    const alertsList: Alert[] = [];

    // Campanha com volume e quase nenhum hot (pela etiqueta do banco)
    campaignScores
      .filter(c => c.hotRate < 10 && c.totalLeads >= 20)
      .slice(0, 2)
      .forEach((campaign, index) => {
        alertsList.push({
          id: `quality-${index}`,
          type: 'quality',
          severity: 'warning',
          title: 'Poucos leads hot',
          description: `${campaign.campaign.substring(0, 25)}${campaign.campaign.length > 25 ? '...' : ''}`,
          value: Math.round(campaign.hotRate),
          campaign: campaign.campaign
        });
      });

    // Duplicate emails
    const emailCounts = new Map<string, number>();
    leads.forEach(lead => {
      if (lead.email) {
        const email = lead.email.toLowerCase().trim();
        emailCounts.set(email, (emailCounts.get(email) || 0) + 1);
      }
    });
    const duplicates = Array.from(emailCounts.values()).filter(c => c > 1).length;
    const duplicateRate = leads.length > 0 ? (duplicates / leads.length) * 100 : 0;

    if (duplicateRate > 2) {
      alertsList.push({
        id: 'duplicates',
        type: 'duplicate',
        severity: duplicateRate > 5 ? 'warning' : 'info',
        title: 'Leads Duplicados',
        description: `${duplicates} emails repetidos`,
        value: Math.round(duplicateRate * 10) / 10
      });
    }

    return alertsList;
  }, [campaignScores, leads]);

  const summaryStats = useMemo(() => {
    const totalLeads = leads.length;
    const hotLeads = leads.filter(isHotLead).length;
    const hotRate = totalLeads > 0 ? (hotLeads / totalLeads) * 100 : 0;

    return {
      totalLeads,
      hotLeads,
      hotRate,
      totalCampaigns: campaignScores.length,
      alertCount: alerts.length,
    };
  }, [leads, campaignScores, alerts]);

  return {
    campaignScores,
    alerts,
    summaryStats
  };
}
