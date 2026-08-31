import { useMemo } from 'react';
import type { Lead } from './useLeads';

export type QualificationSegment = 'hot' | 'warm' | 'raw';
export type PriorityLevel = 'P1' | 'P2' | 'P3' | 'P4';

// Cargos que qualificam como decisor para HotLead (propriedade ou gestão executiva)
const HOTLEAD_DECISION_ROLES: string[] = [
  // CEO/Fundador
  'ceo', 'fundador', 'cofundador', 'co-founder', 'founder',
  // Empresário
  'empresário', 'empresária', 'empresario', 'empresaria',
  // Empreendedor
  'empreendedor', 'empreendedora', 'microempreendedor',
  // Dono/Proprietário
  'dono', 'dona', 'proprietário', 'proprietária', 'proprietario', 'owner',
  // Sócio
  'sócio', 'sócia', 'socio', 'socia', 'partner',
  // Presidente
  'presidente',
  // Diretor/C-Level
  'diretor', 'diretora', 'director', 'cto', 'cfo', 'coo', 'cmo', 'cio', 'c-level',
  // VP/Head
  'vp', 'vice-presidente', 'vice presidente', 'head', 'chief',
];

// ICP Configuration - Faturamento >= R$ 1.5M/ano (~R$ 125k/mês)
const ICP_CONFIG = {
  // Faixas de faturamento que atendem o ICP (>= R$ 100k/mês ou >= R$ 1.5M/ano)
  qualifiedRevenuePatterns: [
    // Mensal >= 100k (padrões exatos - sem substrings genéricas)
    'entre 100k e 500k',
    'entre 500k e 1mm', 
    'entre 1mm e 3mm',
    'entre 3mm e 5mm',
    'acima de 5mm',
    'acima de 1mm',
    'acima de 3mm',
    'acima de 100k',
    'acima de 500k',
    'mais de 100k',
    'mais de 500k',
    'mais de 1mm',
    // Novas opções com "R$ X mil/milhão/milhões"
    'entre r$ 100 mil e r$ 500 mil',
    'entre r$ 500 mil e r$ 1 milhão',
    'entre r$ 1 milhão e r$ 3 milhões',
    'entre r$ 3 milhões e r$ 5 milhões',
    'acima de r$ 5 milhões',
    // Anual >= 1.5M (padrões exatos)
    'de r$ 1 milhão a r$ 5 milhões',
    'de r$ 5 milhões a r$ 10 milhões',
    'de r$ 10 milhões a r$ 50 milhões',
    'acima de r$ 50 milhões',
    'acima de r$ 1 milhão',
    'mais de r$ 1 milhão',
    'mais de 1 milhão',
    'mais de 5 milhões',
  ],
  // Padrões que EXCLUEM do ICP (faturamento baixo)
  excludedRevenuePatterns: [
    'até 100k',
    'menos de 100k',
    'abaixo de 100k',
    'até r$ 100 mil',
    'até r$ 100',
    'menos de r$ 100',
    'até 50k',
    'menos de 50k',
  ],
};

// Decision power mapping by role keywords
const DECISION_POWER_SCORES: Record<string, number> = {
  // C-Level (100 points)
  'ceo': 100, 'cto': 100, 'cfo': 100, 'coo': 100, 'cmo': 100, 'cio': 100,
  'founder': 100, 'fundador': 100, 'cofundador': 100, 'co-founder': 100,
  'presidente': 100, 'owner': 100, 'dono': 100, 'sócio': 100, 'socio': 100,
  'proprietário': 100, 'proprietario': 100,
  'empresário': 100, 'empresario': 100, 'empresária': 100, 'empresaria': 100,
  'empreendedor': 100, 'empreendedora': 100,
  'investidor': 100, 'investidora': 100,
  'mentor': 100, 'mentora': 100,
  'partner': 100,
  
  // Director (80 points) - DECISOR
  'diretor': 80, 'director': 80, 'vp': 80, 'vice-presidente': 80,
  'vice presidente': 80, 'head': 80, 'chief': 80,
  'consultor': 80, 'consultant': 80, 'consultora': 80,
  'advisor': 80, 'assessor': 80, 'assessora': 80,
  'conselheiro': 80, 'conselheira': 80, 'board': 80,
  'c-level': 80,
  'executivo': 80, 'executiva': 80,
  
  // Manager/Gerência (60 points)
  'gerente': 60, 'manager': 60, 'gestor': 60, 'gestora': 60,
  'superintendente': 60, 'coordenador': 60, 'coordinator': 60, 'coordenadora': 60,
  'product manager': 60, 'project manager': 60, 'pm': 60,
  'scrum master': 60,
  'tech lead': 60, 'team lead': 60,
  'supervisor': 60, 'supervisora': 60,
  
  // Specialist/Lead (40 points)
  'especialista': 40, 'specialist': 40, 'líder': 40, 'lider': 40, 'lead': 40,
  'senior': 40, 'sênior': 40,
  'freelancer': 40, 'freelance': 40,
  'autônomo': 40, 'autonomo': 40, 'autônoma': 40, 'autonoma': 40,
  'profissional liberal': 40,
  
  // Analyst/Operator (20 points)
  'analista': 20, 'analyst': 20, 'assistente': 20, 'assistant': 20,
  'executor': 20, 'operador': 20, 'operator': 20,
  'estagiário': 20, 'estagiario': 20, 'estagiária': 20, 'estagiaria': 20,
  'trainee': 20,
  'junior': 20, 'júnior': 20,
  'aprendiz': 20,
};

// Revenue score mapping
const REVENUE_SCORES: Record<string, number> = {
  'acima de r$ 50 milhões/ano': 100,
  'de r$ 10 milhões a r$ 50 milhões/ano': 85,
  'de r$ 5 milhões a r$ 10 milhões/ano': 70,
  'de r$ 1 milhão a r$ 5 milhões/ano': 55,
  'de r$ 500 mil a r$ 1 milhão/ano': 40,
  'de r$ 100 mil a r$ 500 mil/ano': 25,
  'até r$ 100 mil/ano': 10,
};

// Challenge themes for relevance scoring
const RELEVANT_THEMES = [
  'ia', 'inteligência artificial', 'automação', 'automatizar',
  'produtividade', 'eficiência', 'escalar', 'crescimento',
  'inovação', 'digital', 'transformação',
];

// Check if revenue meets ICP criteria (>= R$ 100k/mês ou >= R$ 1.5M/ano)
export function isICPRevenue(faturamento: string | null): boolean {
  if (!faturamento) return false;
  const lower = faturamento.toLowerCase().trim();
  
  // Primeiro verificar exclusões (faturamento baixo)
  const isExcluded = ICP_CONFIG.excludedRevenuePatterns.some(pattern => 
    lower.includes(pattern.toLowerCase())
  );
  if (isExcluded) return false;
  
  // Depois verificar inclusões
  return ICP_CONFIG.qualifiedRevenuePatterns.some(pattern => 
    lower.includes(pattern.toLowerCase())
  );
}

// Check if cargo is a decision maker (ownership or executive management)
export function isDecisionMaker(cargo: string | null): boolean {
  if (!cargo) return false;
  const cargoLower = cargo.toLowerCase().trim();
  
  // Usar word boundary regex para evitar falsos positivos
  // como "coordenador" matchando "coo" ou "social" matchando "socia"
  const wordBoundaryPattern = new RegExp(
    `\\b(${HOTLEAD_DECISION_ROLES.join('|')})\\b`
  );
  
  return wordBoundaryPattern.test(cargoLower);
}

/**
 * @deprecated Esta função é uma aproximação visual hardcoded.
 * Para a fonte de verdade da qualificação, use `lead.etiqueta` (calculado
 * dinamicamente pelo trigger `score_lead_from_config` a partir de
 * `scoring_config`, configurável em Settings → Lead Scoring).
 * Mantida apenas como fallback quando o etiqueta do banco não estiver disponível.
 */
export function getQualificationSegment(lead: Lead): QualificationSegment {
  // Preferir etiqueta do banco (scoring dinâmico) quando disponível
  const etiqueta = (lead as any).etiqueta as string | null | undefined;
  if (etiqueta === 'hotlead') return 'hot';
  if (etiqueta === 'warm') return 'warm';
  if (etiqueta === null) return 'raw';
  // etiqueta === undefined → fallback para cálculo hardcoded legado
  const meetsRevenueICP = isICPRevenue(lead.faturamento);
  const isDecider = isDecisionMaker(lead.cargo);

  // HOT: Atende AMBOS critérios do ICP (faturamento >= 1.5M E decisor)
  if (meetsRevenueICP && isDecider) {
    return 'hot';
  }
  
  // WARM: Atende pelo menos UM critério do ICP
  if (meetsRevenueICP || isDecider) {
    return 'warm';
  }
  
  // RAW: Não atende nenhum critério do ICP
  return 'raw';
}

export function getQualificationScore(lead: Lead): number {
  let score = 0;
  
  // Faturamento no ICP = 50 pontos
  if (isICPRevenue(lead.faturamento)) score += 50;
  
  // Decisor = 40 pontos
  if (isDecisionMaker(lead.cargo)) score += 40;
  
  // Desafios preenchidos = 10 pontos bônus
  if (lead.desafios && lead.desafios.trim().length > 0) score += 10;
  
  return score;
}

export function getDecisionPowerScore(cargo: string | null): number {
  if (!cargo) return 0;
  
  const cargoLower = cargo.toLowerCase().trim();
  
  // Find the highest matching score
  let highestScore = 0;
  for (const [keyword, score] of Object.entries(DECISION_POWER_SCORES)) {
    if (cargoLower.includes(keyword) && score > highestScore) {
      highestScore = score;
    }
  }
  
  return highestScore;
}

export function getDecisionPowerLevel(cargo: string | null): string {
  const score = getDecisionPowerScore(cargo);
  if (score >= 100) return 'C-Level';
  if (score >= 80) return 'Direção';
  if (score >= 60) return 'Gerência';
  if (score >= 40) return 'Especialista';
  if (score >= 20) return 'Analista';
  return 'Não identificado';
}

export function getRevenueScore(faturamento: string | null): number {
  if (!faturamento) return 0;
  
  const faturamentoLower = faturamento.toLowerCase().trim();
  
  for (const [key, score] of Object.entries(REVENUE_SCORES)) {
    if (faturamentoLower.includes(key) || key.includes(faturamentoLower)) {
      return score;
    }
  }
  
  // Fallback matching
  if (faturamentoLower.includes('50 milhões') || faturamentoLower.includes('acima')) return 100;
  if (faturamentoLower.includes('10 milhões')) return 85;
  if (faturamentoLower.includes('5 milhões')) return 70;
  if (faturamentoLower.includes('1 milhão')) return 55;
  if (faturamentoLower.includes('500 mil')) return 40;
  if (faturamentoLower.includes('100 mil')) return 25;
  
  return 10;
}

export function getRelevantThemeScore(desafios: string | null): number {
  if (!desafios) return 0;
  
  const desafiosLower = desafios.toLowerCase();
  let matchCount = 0;
  
  for (const theme of RELEVANT_THEMES) {
    if (desafiosLower.includes(theme)) {
      matchCount++;
    }
  }
  
  // Max 100 points, 20 points per theme match (max 5 themes)
  return Math.min(matchCount * 20, 100);
}

export function getPriorityScore(lead: Lead): number {
  const qualScore = getQualificationScore(lead);
  const decisionScore = getDecisionPowerScore(lead.cargo);
  const revenueScore = getRevenueScore(lead.faturamento);
  const themeScore = getRelevantThemeScore(lead.desafios);
  
  // Formula: Qualificação × 40% + Poder de Decisão × 30% + Faturamento × 20% + Tema × 10%
  return (qualScore * 0.4) + (decisionScore * 0.3) + (revenueScore * 0.2) + (themeScore * 0.1);
}

export function getPriorityLevel(score: number): PriorityLevel {
  if (score >= 75) return 'P1';
  if (score >= 50) return 'P2';
  if (score >= 25) return 'P3';
  return 'P4';
}

export function getPriorityColor(priority: PriorityLevel): string {
  switch (priority) {
    case 'P1': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    case 'P2': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    case 'P3': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
    case 'P4': return 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30';
  }
}

export function getQualificationColor(segment: QualificationSegment): string {
  switch (segment) {
    case 'hot': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    case 'warm': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    case 'raw': return 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30';
  }
}

export interface ICPScore {
  revenue: boolean;
  decisionMaker: boolean;
}

export interface EnrichedLead extends Lead {
  qualification: QualificationSegment;
  priorityScore: number;
  priorityLevel: PriorityLevel;
  decisionPower: string;
  meetsICP: boolean;
  icpScore: ICPScore;
}

export function enrichLeadWithQualification(lead: Lead): EnrichedLead {
  const revenueICP = isICPRevenue(lead.faturamento);
  const decisionMakerICP = isDecisionMaker(lead.cargo);
  
  return {
    ...lead,
    qualification: getQualificationSegment(lead),
    priorityScore: getPriorityScore(lead),
    priorityLevel: getPriorityLevel(getPriorityScore(lead)),
    decisionPower: getDecisionPowerLevel(lead.cargo),
    meetsICP: revenueICP && decisionMakerICP,
    icpScore: {
      revenue: revenueICP,
      decisionMaker: decisionMakerICP,
    },
  };
}

export function useLeadQualification(leads: Lead[]) {
  const enrichedLeads = useMemo(() => {
    return leads.map(enrichLeadWithQualification);
  }, [leads]);

  const qualificationCounts = useMemo(() => {
    return enrichedLeads.reduce(
      (acc, lead) => {
        acc[lead.qualification]++;
        return acc;
      },
      { hot: 0, warm: 0, raw: 0 } as Record<QualificationSegment, number>
    );
  }, [enrichedLeads]);

  const priorityCounts = useMemo(() => {
    return enrichedLeads.reduce(
      (acc, lead) => {
        acc[lead.priorityLevel]++;
        return acc;
      },
      { P1: 0, P2: 0, P3: 0, P4: 0 } as Record<PriorityLevel, number>
    );
  }, [enrichedLeads]);

  const qualificationRate = useMemo(() => {
    if (enrichedLeads.length === 0) return 0;
    const qualifiedCount = qualificationCounts.hot + qualificationCounts.warm;
    return (qualifiedCount / enrichedLeads.length) * 100;
  }, [enrichedLeads, qualificationCounts]);

  return {
    enrichedLeads,
    qualificationCounts,
    priorityCounts,
    qualificationRate,
  };
}
