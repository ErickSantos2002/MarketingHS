import { useMemo } from 'react';
import type { Lead } from './useLeads';

// Uma pontuação só (raio-x RD, R5 — 05/10/2026).
//
// Este hook calculava no navegador uma segunda pontuação, a da dn.ia: P1–P4,
// "prioridade (pontos)", ICP por faixa de faturamento e cargo decisor, temas
// do campo desafio. Ela discordava do `lead_score` que o banco grava pela
// pontuação configurada em Configurações → Lead Scoring — a ficha mostrava
// dois números para a mesma coisa. Saiu inteira. Hot/Warm/Raw agora é SÓ a
// `etiqueta` do banco (mesma régua do `applyFilters` e de
// `components/admin/dashboard/pontuacao.ts`), e o número é o `lead_score`.
//
// Ficou o "nível de decisão" por cargo (`getDecisionPowerLevel`): é um rótulo
// descritivo do cargo, não uma pontuação, e o gráfico de cargos do painel o usa.

export type QualificationSegment = 'hot' | 'warm' | 'raw';

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

/** Hot/Warm/Raw a partir da `etiqueta` gravada pelo banco. Sem etiqueta = Raw. */
export function getQualificationSegment(lead: Pick<Lead, 'etiqueta'>): QualificationSegment {
  if (lead.etiqueta === 'hotlead') return 'hot';
  if (lead.etiqueta === 'warm') return 'warm';
  return 'raw';
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

export function getQualificationColor(segment: QualificationSegment): string {
  switch (segment) {
    case 'hot': return 'bg-[--tint-success] text-[--on-tint-success] border-success/30';
    case 'warm': return 'bg-[--tint-warning] text-[--on-tint-warning] border-warning/30';
    case 'raw': return 'bg-[--tint-neutral] text-conteudo-muted border-borda';
  }
}

export interface EnrichedLead extends Lead {
  qualification: QualificationSegment;
  decisionPower: string;
}

export function enrichLeadWithQualification(lead: Lead): EnrichedLead {
  return {
    ...lead,
    qualification: getQualificationSegment(lead),
    decisionPower: getDecisionPowerLevel(lead.cargo),
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

  const qualificationRate = useMemo(() => {
    if (enrichedLeads.length === 0) return 0;
    const qualifiedCount = qualificationCounts.hot + qualificationCounts.warm;
    return (qualifiedCount / enrichedLeads.length) * 100;
  }, [enrichedLeads, qualificationCounts]);

  return {
    enrichedLeads,
    qualificationCounts,
    qualificationRate,
  };
}
