import { useMemo } from 'react';
import type { Lead } from './useLeads';
import type { EnrichedLead } from './useLeadQualification';
import { format, parseISO, startOfDay, subDays, isWithinInterval, startOfWeek, endOfWeek } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';

// Brasília timezone
export const BRASILIA_TIMEZONE = 'America/Sao_Paulo';

// A análise do campo `desafios` (temas, palavras-chave, qualidade de resposta,
// top respostas) saiu em 02/10/2026 com a aba Desafios (raio-x RD, R6).

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

  // Distribution by landing page (`leads.source` = slug da página de captura)
  const distributionBySource = useMemo(() => {
    const counts = new Map<string, number>();

    for (const lead of leads) {
      const source = lead.source || 'Sem página';
      counts.set(source, (counts.get(source) || 0) + 1);
    }
    
    return Array.from(counts.entries())
      .map(([source, count]) => ({ source, count, percentage: (count / leads.length) * 100 }))
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

  // Data completeness — cargo, empresa e WhatsApp, o que o comercial da H&S usa
  // para abordar. Faturamento e desafios saíram em 02/10/2026 (raio-x RD, R6):
  // eram as perguntas de qualificação da dn.ia e puxavam a média para baixo.
  const dataCompleteness = useMemo(() => {
    const total = leads.length;
    if (total === 0) return { cargo: 0, empresa: 0, whatsapp: 0, average: 0 };

    const filled = {
      cargo: leads.filter(l => l.cargo && l.cargo.trim()).length,
      empresa: leads.filter(l => l.empresa && l.empresa.trim()).length,
      whatsapp: leads.filter(l => l.whatsapp && l.whatsapp.trim()).length,
    };

    const percentages = {
      cargo: (filled.cargo / total) * 100,
      empresa: (filled.empresa / total) * 100,
      whatsapp: (filled.whatsapp / total) * 100,
    };

    const average = (percentages.cargo + percentages.empresa + percentages.whatsapp) / 3;

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

  return {
    leadsByDay,
    conversionsByDay,
    conversionsToday,
    distributionBySource,
    distributionByCargo,
    distributionByFuncionarios,
    distributionBySector,
    dataCompleteness,
    duplicateEmailsCount,
    leadsToday,
    leadsThisWeek,
  };
}
