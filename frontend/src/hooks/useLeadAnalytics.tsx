import { useMemo } from 'react';
import type { Lead } from './useLeads';
import type { EnrichedLead, QualificationSegment } from './useLeadQualification';
import { format, parseISO, startOfDay, subDays, isWithinInterval, startOfWeek, endOfWeek } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';

// Brasília timezone
export const BRASILIA_TIMEZONE = 'America/Sao_Paulo';

// Challenge themes classification
export const CHALLENGE_THEMES: Record<string, string[]> = {
  'IA/Automação': ['ia', 'inteligência artificial', 'inteligencia artificial', 'automação', 'automatizar', 'automatização', 'agente', 'bot', 'chatbot', 'machine learning', 'ml'],
  'Conhecimento': ['aprender', 'entender', 'implementar', 'capacitar', 'começar', 'comecar', 'conhecimento', 'treinamento', 'curso', 'estudar'],
  'Ferramentas': ['ferramenta', 'qual usar', 'escolher', 'melhor', 'plataforma', 'software', 'sistema', 'app', 'aplicativo'],
  'Dados': ['dados', 'integração', 'integracao', 'organizar', 'qualidade', 'base', 'informação', 'informacao', 'analytics'],
  'Execução': ['executar', 'processo', 'sistematizar', 'otimizar', 'implementação', 'implementacao', 'colocar em prática'],
  'Produtividade': ['produtividade', 'tempo', 'eficiência', 'eficiencia', 'escala', 'escalar', 'performance'],
  'Estratégia': ['estratégia', 'estrategia', 'planejamento', 'planejar', 'roadmap', 'visão', 'visao'],
  'Equipe': ['equipe', 'time', 'pessoas', 'colaboradores', 'funcionários', 'funcionarios', 'cultura'],
};

// Sector inference keywords
export const SECTOR_KEYWORDS: Record<string, string[]> = {
  'Tecnologia': ['tech', 'software', 'ti', 'sistema', 'digital', 'saas', 'startup', 'app', 'desenvolvimento', 'dev'],
  'Consultoria': ['consultoria', 'consulting', 'assessoria', 'advisory', 'consult'],
  'Marketing': ['marketing', 'comunicação', 'comunicacao', 'agência', 'agencia', 'mídia', 'midia', 'publicidade', 'propaganda'],
  'Varejo': ['loja', 'comércio', 'comercio', 'varejo', 'retail', 'e-commerce', 'ecommerce', 'atacado'],
  'Serviços': ['serviço', 'servico', 'solução', 'solucao', 'atendimento', 'service'],
  'Indústria': ['indústria', 'industria', 'fábrica', 'fabrica', 'manufatura', 'produção', 'producao'],
  'Saúde': ['saúde', 'saude', 'hospital', 'clínica', 'clinica', 'médico', 'medico', 'farmácia', 'farmacia'],
  'Educação': ['educação', 'educacao', 'escola', 'universidade', 'curso', 'ensino', 'treinamento'],
  'Financeiro': ['banco', 'financeiro', 'finanças', 'financas', 'investimento', 'seguro', 'fintech'],
};

export function classifyChallengeThemes(desafios: string | null): string[] {
  if (!desafios) return [];
  
  const desafiosLower = desafios.toLowerCase();
  const themes: string[] = [];
  
  for (const [theme, keywords] of Object.entries(CHALLENGE_THEMES)) {
    for (const keyword of keywords) {
      if (desafiosLower.includes(keyword)) {
        themes.push(theme);
        break;
      }
    }
  }
  
  return themes.length > 0 ? themes : ['Outros'];
}

export function inferSector(empresa: string | null): string {
  if (!empresa) return 'Não identificado';
  
  const empresaLower = empresa.toLowerCase();
  
  for (const [sector, keywords] of Object.entries(SECTOR_KEYWORDS)) {
    for (const keyword of keywords) {
      if (empresaLower.includes(keyword)) {
        return sector;
      }
    }
  }
  
  return 'Outros';
}

export function extractKeywords(texts: string[], minLength = 3): Map<string, number> {
  const stopWords = new Set([
    'que', 'com', 'para', 'como', 'uma', 'mais', 'por', 'não', 'nao', 'mas', 'dos', 'das',
    'nos', 'nas', 'seu', 'sua', 'seus', 'suas', 'este', 'esta', 'isso', 'esse', 'essa',
    'são', 'sao', 'tem', 'ter', 'foi', 'ser', 'está', 'esta', 'pode', 'fazer', 'muito',
    'bem', 'ele', 'ela', 'eles', 'elas', 'você', 'voce', 'ainda', 'quando', 'onde',
    'qual', 'quais', 'porque', 'também', 'tambem', 'sobre', 'entre', 'depois', 'antes',
    'mesmo', 'apenas', 'cada', 'pela', 'pelo', 'pelas', 'pelos', 'desde', 'assim',
    'todo', 'toda', 'todos', 'todas', 'meu', 'minha', 'nosso', 'nossa', 'outro', 'outra',
  ]);
  
  const wordCounts = new Map<string, number>();
  
  for (const text of texts) {
    if (!text) continue;
    
    const words = text.toLowerCase()
      .replace(/[^\w\sáàâãéèêíìîóòôõúùûç]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length >= minLength && !stopWords.has(word));
    
    for (const word of words) {
      wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    }
  }
  
  return wordCounts;
}

// Quality thresholds for response analysis
export const QUALITY_THRESHOLDS = {
  high: 50,      // 50+ characters = High quality
  medium: 10,    // 10-49 characters = Medium quality
  low: 0,        // <10 characters = Low quality
};

export interface ResponseQuality {
  total: number;
  withResponse: number;
  withoutResponse: number;
  responseRate: number;
  highQuality: number;
  mediumQuality: number;
  lowQuality: number;
  highQualityRate: number;
  approvalRate: number;  // High + Medium
  averageLength: number;
  qualityScore: number;  // 0-100
}

export interface TopResponse {
  lead: Lead | EnrichedLead;
  score: number;
  themes: string[];
  length: number;
}

export interface ThemeQualityData {
  theme: string;
  high: number;
  medium: number;
  low: number;
  total: number;
}

export function calculateResponseQuality(desafios: string | null): 'high' | 'medium' | 'low' | 'none' {
  if (!desafios || !desafios.trim()) return 'none';
  const length = desafios.trim().length;
  if (length >= QUALITY_THRESHOLDS.high) return 'high';
  if (length >= QUALITY_THRESHOLDS.medium) return 'medium';
  return 'low';
}

export function calculateQualityScore(lead: Lead | EnrichedLead): number {
  const desafios = lead.desafios;
  if (!desafios || !desafios.trim()) return 0;
  
  const length = desafios.trim().length;
  const themes = classifyChallengeThemes(desafios);
  
  // Base score from length (max 60 points)
  let score = Math.min(length * 0.5, 60);
  
  // Bonus for identified themes (max 30 points)
  const themeBonus = themes.filter(t => t !== 'Outros').length * 10;
  score += Math.min(themeBonus, 30);
  
  // Bonus for specific keywords (max 10 points)
  const keywordPatterns = ['como', 'preciso', 'quero', 'necessito', 'problema', 'dificuldade'];
  const keywordMatches = keywordPatterns.filter(k => desafios.toLowerCase().includes(k)).length;
  score += Math.min(keywordMatches * 2.5, 10);
  
  return Math.min(Math.round(score), 100);
}

export function useLeadAnalytics(leads: Lead[] | EnrichedLead[]) {
  // Leads by day for line chart (uses created_at - new leads only)
  const leadsByDay = useMemo(() => {
    const counts = new Map<string, number>();
    
    for (const lead of leads) {
      if (!lead.created_at) continue;
      // Use Brasília timezone for day grouping
      const day = formatInTimeZone(parseISO(lead.created_at), BRASILIA_TIMEZONE, 'yyyy-MM-dd');
      counts.set(day, (counts.get(day) || 0) + 1);
    }
    
    // Sort by date and return as array
    return Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, count]) => ({
        date,
        dateFormatted: format(parseISO(date), 'dd/MM', { locale: ptBR }),
        count,
      }));
  }, [leads]);

  // Conversions by day (uses last_conversion_date - includes reconversions)
  const conversionsByDay = useMemo(() => {
    const counts = new Map<string, number>();
    
    for (const lead of leads) {
      const dateField = lead.last_conversion_date;
      if (!dateField) continue;
      // Use Brasília timezone for day grouping
      const day = formatInTimeZone(parseISO(dateField), BRASILIA_TIMEZONE, 'yyyy-MM-dd');
      counts.set(day, (counts.get(day) || 0) + 1);
    }
    
    return Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, count]) => ({
        date,
        dateFormatted: format(parseISO(date), 'dd/MM', { locale: ptBR }),
        count,
      }));
  }, [leads]);

  // Conversions today (uses last_conversion_date) - Brasília timezone
  const conversionsToday = useMemo(() => {
    const nowInBrasilia = toZonedTime(new Date(), BRASILIA_TIMEZONE);
    const todayStr = format(nowInBrasilia, 'yyyy-MM-dd');
    
    return leads.filter(lead => {
      const dateField = lead.last_conversion_date;
      if (!dateField) return false;
      const conversionDayStr = formatInTimeZone(parseISO(dateField), BRASILIA_TIMEZONE, 'yyyy-MM-dd');
      return conversionDayStr === todayStr;
    }).length;
  }, [leads]);

  // Distribution by tipo (modal)
  const distributionByTipo = useMemo(() => {
    const counts = new Map<string, number>();
    
    for (const lead of leads) {
      const tipo = lead.tipo || 'Não identificado';
      counts.set(tipo, (counts.get(tipo) || 0) + 1);
    }
    
    return Array.from(counts.entries())
      .map(([tipo, count]) => ({ tipo, count, percentage: (count / leads.length) * 100 }))
      .sort((a, b) => b.count - a.count);
  }, [leads]);

  // Distribution by source
  const distributionBySource = useMemo(() => {
    const counts = new Map<string, number>();
    
    for (const lead of leads) {
      const source = lead.source || 'Direto';
      counts.set(source, (counts.get(source) || 0) + 1);
    }
    
    return Array.from(counts.entries())
      .map(([source, count]) => ({ source, count, percentage: (count / leads.length) * 100 }))
      .sort((a, b) => b.count - a.count);
  }, [leads]);

  // Distribution by faturamento
  const distributionByFaturamento = useMemo(() => {
    const counts = new Map<string, number>();
    
    for (const lead of leads) {
      const faturamento = lead.faturamento || 'Não informado';
      counts.set(faturamento, (counts.get(faturamento) || 0) + 1);
    }
    
    return Array.from(counts.entries())
      .map(([faturamento, count]) => ({ faturamento, count, percentage: (count / leads.length) * 100 }))
      .sort((a, b) => b.count - a.count);
  }, [leads]);

  // Distribution by cargo
  const distributionByCargo = useMemo(() => {
    const counts = new Map<string, number>();
    
    for (const lead of leads) {
      const cargo = lead.cargo || 'Não informado';
      counts.set(cargo, (counts.get(cargo) || 0) + 1);
    }
    
    return Array.from(counts.entries())
      .map(([cargo, count]) => ({ cargo, count, percentage: (count / leads.length) * 100 }))
      .sort((a, b) => b.count - a.count);
  }, [leads]);

  // Distribution by funcionarios (company size)
  const distributionByFuncionarios = useMemo(() => {
    const counts = new Map<string, number>();
    
    for (const lead of leads) {
      const funcionarios = lead.funcionarios || 'Não informado';
      counts.set(funcionarios, (counts.get(funcionarios) || 0) + 1);
    }
    
    return Array.from(counts.entries())
      .map(([funcionarios, count]) => ({ funcionarios, count, percentage: (count / leads.length) * 100 }))
      .sort((a, b) => b.count - a.count);
  }, [leads]);

  // Distribution by inferred sector
  const distributionBySector = useMemo(() => {
    const counts = new Map<string, number>();
    
    for (const lead of leads) {
      const sector = inferSector(lead.empresa);
      counts.set(sector, (counts.get(sector) || 0) + 1);
    }
    
    return Array.from(counts.entries())
      .map(([sector, count]) => ({ sector, count, percentage: (count / leads.length) * 100 }))
      .sort((a, b) => b.count - a.count);
  }, [leads]);

  // Challenge themes distribution
  const challengeThemesDistribution = useMemo(() => {
    const counts = new Map<string, number>();
    
    for (const lead of leads) {
      const themes = classifyChallengeThemes(lead.desafios);
      for (const theme of themes) {
        counts.set(theme, (counts.get(theme) || 0) + 1);
      }
    }
    
    return Array.from(counts.entries())
      .map(([theme, count]) => ({ theme, count, percentage: (count / leads.length) * 100 }))
      .sort((a, b) => b.count - a.count);
  }, [leads]);

  // Top keywords from desafios
  const topKeywords = useMemo(() => {
    const desafiosTexts = leads.map(l => l.desafios).filter(Boolean) as string[];
    const keywordCounts = extractKeywords(desafiosTexts);
    
    return Array.from(keywordCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([keyword, count]) => ({ keyword, count }));
  }, [leads]);

  // Data completeness
  const dataCompleteness = useMemo(() => {
    const total = leads.length;
    if (total === 0) return { cargo: 0, empresa: 0, faturamento: 0, desafios: 0, average: 0 };
    
    const filled = {
      cargo: leads.filter(l => l.cargo && l.cargo.trim()).length,
      empresa: leads.filter(l => l.empresa && l.empresa.trim()).length,
      faturamento: leads.filter(l => l.faturamento && l.faturamento.trim()).length,
      desafios: leads.filter(l => l.desafios && l.desafios.trim()).length,
    };
    
    const percentages = {
      cargo: (filled.cargo / total) * 100,
      empresa: (filled.empresa / total) * 100,
      faturamento: (filled.faturamento / total) * 100,
      desafios: (filled.desafios / total) * 100,
    };
    
    const average = (percentages.cargo + percentages.empresa + percentages.faturamento + percentages.desafios) / 4;
    
    return { ...percentages, average };
  }, [leads]);

  // Duplicate emails count
  const duplicateEmailsCount = useMemo(() => {
    const emailCounts = new Map<string, number>();
    
    for (const lead of leads) {
      if (!lead.email) continue;
      const email = lead.email.toLowerCase().trim();
      emailCounts.set(email, (emailCounts.get(email) || 0) + 1);
    }
    
    const duplicates = Array.from(emailCounts.entries()).filter(([_, count]) => count > 1);
    const duplicateCount = duplicates.reduce((sum, [_, count]) => sum + count - 1, 0);
    
    return {
      count: duplicateCount,
      percentage: leads.length > 0 ? (duplicateCount / leads.length) * 100 : 0,
      duplicateEmails: duplicates.map(([email, count]) => ({ email, count })),
    };
  }, [leads]);

  // Today's leads count - Brasília timezone
  const leadsToday = useMemo(() => {
    const nowInBrasilia = toZonedTime(new Date(), BRASILIA_TIMEZONE);
    const todayStr = format(nowInBrasilia, 'yyyy-MM-dd');
    
    return leads.filter(lead => {
      if (!lead.created_at) return false;
      const leadDayStr = formatInTimeZone(parseISO(lead.created_at), BRASILIA_TIMEZONE, 'yyyy-MM-dd');
      return leadDayStr === todayStr;
    }).length;
  }, [leads]);

  // This week's leads count - Brasília timezone
  const leadsThisWeek = useMemo(() => {
    const nowInBrasilia = toZonedTime(new Date(), BRASILIA_TIMEZONE);
    const weekStart = startOfWeek(nowInBrasilia, { weekStartsOn: 0 });
    const weekEnd = endOfWeek(nowInBrasilia, { weekStartsOn: 0 });
    
    return leads.filter(lead => {
      if (!lead.created_at) return false;
      // Convert lead date to Brasília time for comparison
      const leadDateInBrasilia = toZonedTime(parseISO(lead.created_at), BRASILIA_TIMEZONE);
      return isWithinInterval(leadDateInBrasilia, { start: weekStart, end: weekEnd });
    }).length;
  }, [leads]);

  // Response quality analysis
  const responseQuality = useMemo((): ResponseQuality => {
    const total = leads.length;
    if (total === 0) {
      return {
        total: 0,
        withResponse: 0,
        withoutResponse: 0,
        responseRate: 0,
        highQuality: 0,
        mediumQuality: 0,
        lowQuality: 0,
        highQualityRate: 0,
        approvalRate: 0,
        averageLength: 0,
        qualityScore: 0,
      };
    }

    let withResponse = 0;
    let highQuality = 0;
    let mediumQuality = 0;
    let lowQuality = 0;
    let totalLength = 0;
    let totalScore = 0;

    for (const lead of leads) {
      const quality = calculateResponseQuality(lead.desafios);
      const score = calculateQualityScore(lead);
      
      if (quality !== 'none') {
        withResponse++;
        totalLength += (lead.desafios?.trim().length || 0);
        totalScore += score;
      }

      switch (quality) {
        case 'high':
          highQuality++;
          break;
        case 'medium':
          mediumQuality++;
          break;
        case 'low':
          lowQuality++;
          break;
      }
    }

    const withoutResponse = total - withResponse;
    const responseRate = (withResponse / total) * 100;
    const highQualityRate = (highQuality / total) * 100;
    const approvalRate = ((highQuality + mediumQuality) / total) * 100;
    const averageLength = withResponse > 0 ? totalLength / withResponse : 0;
    const qualityScore = withResponse > 0 ? totalScore / withResponse : 0;

    return {
      total,
      withResponse,
      withoutResponse,
      responseRate,
      highQuality,
      mediumQuality,
      lowQuality,
      highQualityRate,
      approvalRate,
      averageLength,
      qualityScore,
    };
  }, [leads]);

  // Top responses with score
  const topResponses = useMemo((): TopResponse[] => {
    return leads
      .filter(lead => lead.desafios && lead.desafios.trim().length >= QUALITY_THRESHOLDS.high)
      .map(lead => ({
        lead,
        score: calculateQualityScore(lead),
        themes: classifyChallengeThemes(lead.desafios),
        length: lead.desafios?.trim().length || 0,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
  }, [leads]);

  // Theme quality matrix
  const themeQualityMatrix = useMemo((): ThemeQualityData[] => {
    const matrix = new Map<string, { high: number; medium: number; low: number; total: number }>();

    for (const lead of leads) {
      const quality = calculateResponseQuality(lead.desafios);
      if (quality === 'none') continue;

      const themes = classifyChallengeThemes(lead.desafios);
      for (const theme of themes) {
        if (!matrix.has(theme)) {
          matrix.set(theme, { high: 0, medium: 0, low: 0, total: 0 });
        }
        const data = matrix.get(theme)!;
        data.total++;
        switch (quality) {
          case 'high':
            data.high++;
            break;
          case 'medium':
            data.medium++;
            break;
          case 'low':
            data.low++;
            break;
        }
      }
    }

    return Array.from(matrix.entries())
      .map(([theme, data]) => ({ theme, ...data }))
      .sort((a, b) => b.total - a.total);
  }, [leads]);

  return {
    leadsByDay,
    conversionsByDay,
    conversionsToday,
    distributionByTipo,
    distributionBySource,
    distributionByFaturamento,
    distributionByCargo,
    distributionByFuncionarios,
    distributionBySector,
    challengeThemesDistribution,
    topKeywords,
    dataCompleteness,
    duplicateEmailsCount,
    leadsToday,
    leadsThisWeek,
    responseQuality,
    topResponses,
    themeQualityMatrix,
  };
}
