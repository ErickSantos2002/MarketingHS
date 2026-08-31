import { useMemo } from "react";
import { format, parseISO, getDay, getHours, startOfWeek, endOfWeek, isWithinInterval } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Lead {
  id: string;
  created_at: string | null;
  nome: string | null;
  email: string | null;
  empresa: string | null;
  cargo: string | null;
  faturamento: string | null;
  funcionarios: string | null;
  desafios: string | null;
  tipo: string;
  source: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
}

export interface CampaignScore {
  campaign: string;
  totalLeads: number;
  respondedLeads: number;
  hotLeads: number;
  responseRate: number;
  hotRate: number;
  abandonmentRate: number;
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
}

export interface Alert {
  id: string;
  type: 'abandonment' | 'quality' | 'duplicate' | 'critical_hour';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  value: number;
  campaign?: string;
  hour?: number;
}

export interface Recommendation {
  id: string;
  type: 'pause' | 'invest' | 'avoid' | 'prioritize' | 'review';
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  campaign?: string;
  metric?: string;
}

export interface TemporalCell {
  dayOfWeek: number;
  hour: number;
  totalLeads: number;
  respondedLeads: number;
  hotLeads: number;
  responseRate: number;
  hotRate: number;
}

// Decision maker score calculation (same logic as useLeadQualification)
const CARGO_SCORES: Record<string, number> = {
  'ceo': 100, 'fundador': 100, 'founder': 100, 'proprietario': 100, 'dono': 100, 'socio': 100,
  'diretor': 95, 'director': 95, 'vp': 95, 'vice-presidente': 95, 'c-level': 95, 'cto': 95, 'cfo': 95, 'cmo': 95, 'coo': 95,
  'gerente': 85, 'manager': 85, 'head': 85, 'lider': 85, 'leader': 85,
  'consultor': 80, 'consultant': 80, 'assessor': 80, 'advisor': 80,
  'coordenador': 70, 'coordinator': 70, 'supervisor': 70,
  'especialista': 60, 'specialist': 60, 'analista senior': 65, 'senior analyst': 65,
  'analista': 50, 'analyst': 50,
  'assistente': 30, 'assistant': 30, 'auxiliar': 30, 'estagiario': 20, 'intern': 20,
  'estudante': 15, 'student': 15, 'autonomo': 40, 'freelancer': 40
};

function getCargoScore(cargo: string | null): number {
  if (!cargo) return 0;
  const cargoLower = cargo.toLowerCase().trim();
  for (const [key, score] of Object.entries(CARGO_SCORES)) {
    if (cargoLower.includes(key)) return score;
  }
  return 40;
}

function isRevenueICP(faturamento: string | null): boolean {
  if (!faturamento) return false;
  const icpRevenues = ['100k-500k', '500k-1m', '1m-5m', '5m+', 'acima de r$ 100 mil'];
  return icpRevenues.some(r => faturamento.toLowerCase().includes(r.toLowerCase()));
}

function isHotLead(lead: Lead): boolean {
  const cargoScore = getCargoScore(lead.cargo);
  const isDecisionMaker = cargoScore >= 80;
  const meetsRevenue = isRevenueICP(lead.faturamento);
  return isDecisionMaker && meetsRevenue;
}

function hasResponded(lead: Lead): boolean {
  return !!(lead.desafios && lead.desafios.trim().length > 0);
}

export function useInsightsAnalytics(leads: Lead[]) {
  // Campaign scores
  const campaignScores = useMemo(() => {
    const campaignMap = new Map<string, { total: number; responded: number; hot: number }>();

    leads.forEach(lead => {
      const campaign = lead.utm_campaign || 'Sem campanha';
      const current = campaignMap.get(campaign) || { total: 0, responded: 0, hot: 0 };
      current.total++;
      if (hasResponded(lead)) current.responded++;
      if (isHotLead(lead)) current.hot++;
      campaignMap.set(campaign, current);
    });

    const scores: CampaignScore[] = [];
    campaignMap.forEach((data, campaign) => {
      const responseRate = data.total > 0 ? (data.responded / data.total) * 100 : 0;
      const hotRate = data.total > 0 ? (data.hot / data.total) * 100 : 0;
      const abandonmentRate = 100 - responseRate;
      
      // Score: weighted combination of response rate and hot rate
      const score = Math.round(responseRate * 0.4 + hotRate * 1.5 + Math.min(data.total / 10, 20));
      
      let grade: 'A' | 'B' | 'C' | 'D' | 'F';
      if (score >= 80) grade = 'A';
      else if (score >= 60) grade = 'B';
      else if (score >= 40) grade = 'C';
      else if (score >= 20) grade = 'D';
      else grade = 'F';

      scores.push({
        campaign,
        totalLeads: data.total,
        respondedLeads: data.responded,
        hotLeads: data.hot,
        responseRate,
        hotRate,
        abandonmentRate,
        score,
        grade
      });
    });

    return scores.sort((a, b) => b.score - a.score);
  }, [leads]);

  // Temporal matrix (7 days x 24 hours)
  const temporalMatrix = useMemo(() => {
    const matrix: TemporalCell[][] = Array(7).fill(null).map((_, dayIndex) =>
      Array(24).fill(null).map((_, hourIndex) => ({
        dayOfWeek: dayIndex,
        hour: hourIndex,
        totalLeads: 0,
        respondedLeads: 0,
        hotLeads: 0,
        responseRate: 0,
        hotRate: 0
      }))
    );

    leads.forEach(lead => {
      if (!lead.created_at) return;
      const date = parseISO(lead.created_at);
      const dayOfWeek = getDay(date); // 0 = Sunday, 6 = Saturday
      const hour = getHours(date);

      const cell = matrix[dayOfWeek][hour];
      cell.totalLeads++;
      if (hasResponded(lead)) cell.respondedLeads++;
      if (isHotLead(lead)) cell.hotLeads++;
    });

    // Calculate rates
    matrix.forEach(day => {
      day.forEach(cell => {
        if (cell.totalLeads > 0) {
          cell.responseRate = (cell.respondedLeads / cell.totalLeads) * 100;
          cell.hotRate = (cell.hotLeads / cell.totalLeads) * 100;
        }
      });
    });

    return matrix;
  }, [leads]);

  // Alerts
  const alerts = useMemo(() => {
    const alertsList: Alert[] = [];

    // High abandonment campaigns (>50%)
    campaignScores
      .filter(c => c.abandonmentRate > 50 && c.totalLeads >= 10)
      .slice(0, 3)
      .forEach((campaign, index) => {
        alertsList.push({
          id: `abandonment-${index}`,
          type: 'abandonment',
          severity: campaign.abandonmentRate > 70 ? 'critical' : 'warning',
          title: 'Alto Abandono',
          description: `${campaign.campaign.substring(0, 25)}${campaign.campaign.length > 25 ? '...' : ''}`,
          value: Math.round(campaign.abandonmentRate),
          campaign: campaign.campaign
        });
      });

    // Low quality campaigns (hot rate < 10% with volume)
    campaignScores
      .filter(c => c.hotRate < 10 && c.totalLeads >= 20)
      .slice(0, 2)
      .forEach((campaign, index) => {
        alertsList.push({
          id: `quality-${index}`,
          type: 'quality',
          severity: 'warning',
          title: 'Baixa Qualidade',
          description: `${campaign.campaign.substring(0, 25)}${campaign.campaign.length > 25 ? '...' : ''}`,
          value: Math.round(campaign.hotRate),
          campaign: campaign.campaign
        });
      });

    // Critical hours (abandonment peaks)
    const hourlyStats = Array(24).fill(null).map((_, hour) => {
      let total = 0, responded = 0;
      temporalMatrix.forEach(day => {
        total += day[hour].totalLeads;
        responded += day[hour].respondedLeads;
      });
      return { hour, total, responded, abandonmentRate: total > 0 ? ((total - responded) / total) * 100 : 0 };
    }).filter(h => h.total >= 5);

    const avgAbandonment = hourlyStats.length > 0 
      ? hourlyStats.reduce((sum, h) => sum + h.abandonmentRate, 0) / hourlyStats.length 
      : 0;

    hourlyStats
      .filter(h => h.abandonmentRate > avgAbandonment + 15)
      .sort((a, b) => b.abandonmentRate - a.abandonmentRate)
      .slice(0, 2)
      .forEach((hourData, index) => {
        alertsList.push({
          id: `hour-${index}`,
          type: 'critical_hour',
          severity: 'info',
          title: 'Horário Crítico',
          description: `${hourData.hour}:00 - ${hourData.hour + 1}:00`,
          value: Math.round(hourData.abandonmentRate),
          hour: hourData.hour
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
  }, [campaignScores, temporalMatrix, leads]);

  // Recommendations
  const recommendations = useMemo(() => {
    const recs: Recommendation[] = [];

    // Pause high abandonment campaigns
    const worstCampaign = campaignScores.find(c => c.abandonmentRate > 60 && c.totalLeads >= 15);
    if (worstCampaign) {
      recs.push({
        id: 'pause-campaign',
        type: 'pause',
        title: 'Pausar Campanha',
        description: `"${worstCampaign.campaign.substring(0, 20)}..." tem ${Math.round(worstCampaign.abandonmentRate)}% de abandono`,
        impact: 'high',
        campaign: worstCampaign.campaign,
        metric: `${Math.round(worstCampaign.abandonmentRate)}% abandono`
      });
    }

    // Invest in best performing campaigns
    const bestCampaign = campaignScores.find(c => c.grade === 'A' && c.totalLeads >= 10);
    if (bestCampaign) {
      recs.push({
        id: 'invest-campaign',
        type: 'invest',
        title: 'Aumentar Investimento',
        description: `"${bestCampaign.campaign.substring(0, 20)}..." tem score ${bestCampaign.score} e ${Math.round(bestCampaign.hotRate)}% hot leads`,
        impact: 'high',
        campaign: bestCampaign.campaign,
        metric: `Score ${bestCampaign.score}`
      });
    }

    // Avoid critical hours
    const hourlyTotals = Array(24).fill(null).map((_, hour) => {
      let total = 0, responded = 0;
      temporalMatrix.forEach(day => {
        total += day[hour].totalLeads;
        responded += day[hour].respondedLeads;
      });
      return { hour, total, responded, rate: total > 0 ? (responded / total) * 100 : 0 };
    }).filter(h => h.total >= 5);

    const worstHour = hourlyTotals.sort((a, b) => a.rate - b.rate)[0];
    if (worstHour && worstHour.rate < 50) {
      recs.push({
        id: 'avoid-hour',
        type: 'avoid',
        title: 'Evitar Horário',
        description: `${worstHour.hour}h tem apenas ${Math.round(worstHour.rate)}% de resposta`,
        impact: 'medium',
        metric: `${Math.round(worstHour.rate)}% resposta`
      });
    }

    // Prioritize best days
    const dayNames = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const dailyTotals = temporalMatrix.map((day, index) => {
      const total = day.reduce((sum, cell) => sum + cell.totalLeads, 0);
      const responded = day.reduce((sum, cell) => sum + cell.respondedLeads, 0);
      return { dayIndex: index, total, responded, rate: total > 0 ? (responded / total) * 100 : 0 };
    }).filter(d => d.total >= 5);

    const bestDay = dailyTotals.sort((a, b) => b.rate - a.rate)[0];
    if (bestDay && bestDay.rate > 70) {
      recs.push({
        id: 'prioritize-day',
        type: 'prioritize',
        title: 'Priorizar Dia',
        description: `${dayNames[bestDay.dayIndex]} tem ${Math.round(bestDay.rate)}% de taxa de resposta`,
        impact: 'medium',
        metric: `${Math.round(bestDay.rate)}% resposta`
      });
    }

    // Review campaigns with volume but low hot rate
    const reviewCampaign = campaignScores.find(c => c.totalLeads >= 30 && c.hotRate < 15 && c.responseRate > 50);
    if (reviewCampaign) {
      recs.push({
        id: 'review-segment',
        type: 'review',
        title: 'Revisar Segmentação',
        description: `"${reviewCampaign.campaign.substring(0, 20)}..." traz volume mas só ${Math.round(reviewCampaign.hotRate)}% são ICP`,
        impact: 'medium',
        campaign: reviewCampaign.campaign,
        metric: `${Math.round(reviewCampaign.hotRate)}% ICP`
      });
    }

    return recs;
  }, [campaignScores, temporalMatrix]);

  // Summary stats
  const summaryStats = useMemo(() => {
    const totalLeads = leads.length;
    const respondedLeads = leads.filter(hasResponded).length;
    const hotLeads = leads.filter(isHotLead).length;
    const responseRate = totalLeads > 0 ? (respondedLeads / totalLeads) * 100 : 0;
    const hotRate = totalLeads > 0 ? (hotLeads / totalLeads) * 100 : 0;

    return {
      totalLeads,
      respondedLeads,
      hotLeads,
      responseRate,
      hotRate,
      totalCampaigns: campaignScores.length,
      gradedACampaigns: campaignScores.filter(c => c.grade === 'A').length,
      criticalAlerts: alerts.filter(a => a.severity === 'critical').length
    };
  }, [leads, campaignScores, alerts]);

  return {
    campaignScores,
    temporalMatrix,
    alerts,
    recommendations,
    summaryStats
  };
}
