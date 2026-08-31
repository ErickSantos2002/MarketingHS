import { useState, useMemo, useCallback, useEffect } from 'react';
import { subDays, startOfMonth, startOfDay, endOfDay, addDays, parseISO, format } from 'date-fns';
import { toZonedTime, formatInTimeZone } from 'date-fns-tz';
import type { Lead } from './useLeads';
import type { EnrichedLead, QualificationSegment } from './useLeadQualification';
import { classifyChallengeThemes } from './useLeadAnalytics';

const BRASILIA_TIMEZONE = 'America/Sao_Paulo';
const STORAGE_KEY = 'dashboard-filters-v2';


export type DatePreset = 'today' | 'yesterday' | 'last7days' | 'last30days' | 'thisMonth' | 'all' | 'custom';
export type InteresseFilter = 'mtia_e_formacao' | 'apenas_mtia' | 'apenas_formacao';

export interface DashboardFilters {
  datePreset: DatePreset;
  dateFrom: Date | null;
  dateTo: Date | null;
  createdDatePreset: DatePreset;
  createdDateFrom: Date | null;
  createdDateTo: Date | null;
  tipos: string[];
  campaigns: string[];
  qualifications: QualificationSegment[];
  faturamentos: string[];
  cargos: string[];
  challengeThemes: string[];
  hideIncomplete: boolean;
  onlyReconversions: boolean;
  search: string;
  interesseEcossistema: InteresseFilter | null;
  sources: string[];
  utmContents: string[];
  presencas: string[];
}

const initialFilters: DashboardFilters = {
  datePreset: 'all',
  dateFrom: null,
  dateTo: null,
  createdDatePreset: 'all',
  createdDateFrom: null,
  createdDateTo: null,
  tipos: [],
  campaigns: [],
  qualifications: [],
  faturamentos: [],
  cargos: [],
  challengeThemes: [],
  hideIncomplete: false,
  onlyReconversions: false,
  search: '',
  interesseEcossistema: null,
  sources: [],
  utmContents: [],
  presencas: [],
};

// Serialize filters for localStorage (convert Dates to ISO strings)
function serializeFilters(filters: DashboardFilters): string {
  return JSON.stringify({
    ...filters,
    dateFrom: filters.dateFrom?.toISOString() || null,
    dateTo: filters.dateTo?.toISOString() || null,
    createdDateFrom: filters.createdDateFrom?.toISOString() || null,
    createdDateTo: filters.createdDateTo?.toISOString() || null,
  });
}

// Deserialize filters from localStorage (convert ISO strings to Dates)
function deserializeFilters(stored: string): DashboardFilters {
  const parsed = JSON.parse(stored);
  return {
    ...initialFilters,
    ...parsed,
    dateFrom: parsed.dateFrom ? new Date(parsed.dateFrom) : null,
    dateTo: parsed.dateTo ? new Date(parsed.dateTo) : null,
    createdDateFrom: parsed.createdDateFrom ? new Date(parsed.createdDateFrom) : null,
    createdDateTo: parsed.createdDateTo ? new Date(parsed.createdDateTo) : null,
    // Ensure booleans are always booleans (not undefined/null from old localStorage)
    hideIncomplete: !!parsed.hideIncomplete,
    onlyReconversions: !!parsed.onlyReconversions,
    // Don't restore search (it's temporary)
    search: '',
  };
}

// Compute date range for a preset (relative to now in Brasília)
function computeRangeForPreset(preset: DatePreset): { from: Date | null; to: Date | null } | null {
  const nowInBrasilia = toZonedTime(new Date(), BRASILIA_TIMEZONE);
  switch (preset) {
    case 'today':
      return { from: startOfDay(nowInBrasilia), to: endOfDay(nowInBrasilia) };
    case 'yesterday': {
      const yesterday = subDays(nowInBrasilia, 1);
      return { from: startOfDay(yesterday), to: endOfDay(yesterday) };
    }
    case 'last7days':
      return { from: subDays(nowInBrasilia, 7), to: nowInBrasilia };
    case 'last30days':
      return { from: subDays(nowInBrasilia, 30), to: nowInBrasilia };
    case 'thisMonth':
      return { from: startOfMonth(nowInBrasilia), to: nowInBrasilia };
    case 'all':
      return { from: null, to: null };
    case 'custom':
    default:
      return null;
  }
}

// Recalculate dates for relative presets (so "Last 7 days" is always relative to today)
function recalculateDatesForPreset(filters: DashboardFilters): DashboardFilters {
  let out = filters;
  if (out.datePreset !== 'custom' && out.datePreset !== 'all') {
    const r = computeRangeForPreset(out.datePreset);
    if (r) out = { ...out, dateFrom: r.from, dateTo: r.to };
  }
  if (out.createdDatePreset !== 'custom' && out.createdDatePreset !== 'all') {
    const r = computeRangeForPreset(out.createdDatePreset);
    if (r) out = { ...out, createdDateFrom: r.from, createdDateTo: r.to };
  }
  return out;
}

export function useDashboardFilters() {
  const [filters, setFilters] = useState<DashboardFilters>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const restored = deserializeFilters(stored);
        return recalculateDatesForPreset(restored);
      }
    } catch (e) {
      console.error('Error loading dashboard filters:', e);
    }
    return initialFilters;
  });

  // Save filters to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, serializeFilters(filters));
    } catch (e) {
      console.error('Error saving dashboard filters:', e);
    }
  }, [filters]);

  const updateFilters = useCallback((updates: Partial<DashboardFilters>) => {
    setFilters(prev => ({ ...prev, ...updates }));
  }, []);

  const resetFilters = useCallback(() => {
    setFilters(initialFilters);
  }, []);

  const setDatePreset = useCallback((preset: DatePreset) => {
    if (preset === 'custom') {
      return updateFilters({ datePreset: preset });
    }
    const r = computeRangeForPreset(preset) ?? { from: null, to: null };
    updateFilters({ datePreset: preset, dateFrom: r.from, dateTo: r.to });
  }, [updateFilters]);

  const setCustomDateRange = useCallback((from: Date | null, to: Date | null) => {
    updateFilters({ datePreset: 'custom', dateFrom: from, dateTo: to });
  }, [updateFilters]);

  const setCreatedDatePreset = useCallback((preset: DatePreset) => {
    if (preset === 'custom') {
      return updateFilters({ createdDatePreset: preset });
    }
    const r = computeRangeForPreset(preset) ?? { from: null, to: null };
    updateFilters({ createdDatePreset: preset, createdDateFrom: r.from, createdDateTo: r.to });
  }, [updateFilters]);

  const setCustomCreatedDateRange = useCallback((from: Date | null, to: Date | null) => {
    updateFilters({ createdDatePreset: 'custom', createdDateFrom: from, createdDateTo: to });
  }, [updateFilters]);

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (filters.datePreset !== 'all') count++;
    if (filters.createdDatePreset !== 'all') count++;
    if ((filters.tipos?.length ?? 0) > 0) count++;
    if ((filters.campaigns?.length ?? 0) > 0) count++;
    if ((filters.qualifications?.length ?? 0) > 0) count++;
    if ((filters.faturamentos?.length ?? 0) > 0) count++;
    if ((filters.cargos?.length ?? 0) > 0) count++;
    if ((filters.challengeThemes?.length ?? 0) > 0) count++;
    if (filters.hideIncomplete) count++;
    if (filters.onlyReconversions) count++;
    if (filters.search?.trim()) count++;
    if (filters.interesseEcossistema) count++;
    if ((filters.sources?.length ?? 0) > 0) count++;
    if ((filters.utmContents?.length ?? 0) > 0) count++;
    if ((filters.presencas?.length ?? 0) > 0) count++;
    return count;
  }, [filters]);

  return {
    filters,
    updateFilters,
    resetFilters,
    setDatePreset,
    setCustomDateRange,
    setCreatedDatePreset,
    setCustomCreatedDateRange,
    activeFiltersCount,
  };
}

export function applyFilters<T extends Lead | EnrichedLead>(
  leads: T[],
  filters: DashboardFilters,
  options?: { skipUtmContent?: boolean }
): T[] {
  const inRange = (iso: string | null | undefined, from: Date | null, to: Date | null): boolean | null => {
    if (!iso) return null;
    const dayStr = formatInTimeZone(parseISO(iso), BRASILIA_TIMEZONE, 'yyyy-MM-dd');
    if (from && dayStr < format(from, 'yyyy-MM-dd')) return false;
    if (to && dayStr > format(to, 'yyyy-MM-dd')) return false;
    return true;
  };

  return leads.filter(lead => {
    // "Última conversão" filter — matches last_conversion_date, falling back to created_at when missing
    if (filters.dateFrom || filters.dateTo) {
      const target = lead.last_conversion_date || lead.created_at;
      const r = inRange(target, filters.dateFrom, filters.dateTo);
      if (r !== true) return false;
    }

    // "Data de cadastro" filter — matches created_at only
    if (filters.createdDateFrom || filters.createdDateTo) {
      const r = inRange(lead.created_at, filters.createdDateFrom, filters.createdDateTo);
      if (r !== true) return false;
    }



    // Tipo filter
    if (filters.tipos.length > 0) {
      if (!filters.tipos.includes(lead.tipo)) return false;
    }

    // Campaign filter
    if ((filters.campaigns?.length ?? 0) > 0) {
      const leadCampaign = lead.utm_campaign || 'Sem campanha';
      if (!filters.campaigns!.includes(leadCampaign)) return false;
    }

    // Source filter
    if ((filters.sources?.length ?? 0) > 0) {
      const leadSource = lead.utm_source || 'Sem origem';
      if (!filters.sources!.includes(leadSource)) return false;
    }

    // UTM Content filter (OR semantics): lead passes if its stored utm_content OR any of its
    // conversion-history utm_contents (when available via `all_utm_contents`) matches any selected.
    if (!options?.skipUtmContent && (filters.utmContents?.length ?? 0) > 0) {
      const historyValues = ((lead as any).all_utm_contents as string[] | undefined) || [];
      const leadValues = new Set<string>(historyValues);
      leadValues.add((lead as any).utm_content || 'Sem utm_content');
      const matches = filters.utmContents!.some(v => leadValues.has(v));
      if (!matches) return false;
    }

    // Qualification filter — uses leads.etiqueta from DB (dynamic scoring config)
    // 'hot' = etiqueta 'hotlead', 'warm' = etiqueta 'warm', 'raw' = etiqueta NULL
    if (filters.qualifications.length > 0) {
      const etiqueta = (lead as any).etiqueta as string | null | undefined;
      const segment = etiqueta === 'hotlead' ? 'hot' : etiqueta === 'warm' ? 'warm' : 'raw';
      if (!filters.qualifications.includes(segment as any)) return false;
    }

    // Faturamento filter
    if (filters.faturamentos.length > 0) {
      const leadFaturamento = lead.faturamento || 'Não informado';
      if (!filters.faturamentos.includes(leadFaturamento)) return false;
    }

    // Cargo filter
    if (filters.cargos.length > 0) {
      const leadCargo = lead.cargo || 'Não informado';
      if (!filters.cargos.includes(leadCargo)) return false;
    }

    // Challenge themes filter
    if (filters.challengeThemes.length > 0) {
      const leadThemes = classifyChallengeThemes(lead.desafios);
      const hasMatchingTheme = filters.challengeThemes.some(theme => leadThemes.includes(theme));
      if (!hasMatchingTheme) return false;
    }

    // Hide incomplete leads filter
    if (filters.hideIncomplete) {
      const hasCompleteFaturamento = lead.faturamento && lead.faturamento.trim() !== '' && lead.faturamento.toLowerCase() !== 'não informado';
      const hasCompleteCargo = lead.cargo && lead.cargo.trim() !== '' && lead.cargo.toLowerCase() !== 'não informado';
      const hasCompleteDesafios = lead.desafios && lead.desafios.trim() !== '';
      
      // Lead must have at least faturamento AND cargo to be considered complete
      if (!hasCompleteFaturamento || !hasCompleteCargo) return false;
    }

    // Only reconversions filter
    if (filters.onlyReconversions) {
      if (!lead.last_conversion_date || !lead.created_at) return false;
      const created = new Date(lead.created_at).getTime();
      const lastConversion = new Date(lead.last_conversion_date).getTime();
      if (Math.abs(lastConversion - created) <= 60000) return false;
    }

    // Search filter
    if (filters.search.trim()) {
      const searchLower = filters.search.toLowerCase().trim();
      const matchesName = lead.nome?.toLowerCase().includes(searchLower);
      const matchesEmail = lead.email?.toLowerCase().includes(searchLower);
      const matchesCompany = lead.empresa?.toLowerCase().includes(searchLower);
      const matchesWhatsapp = lead.whatsapp?.toLowerCase().includes(searchLower);
      if (!matchesName && !matchesEmail && !matchesCompany && !matchesWhatsapp) return false;
    }

    // Presença filter
    if ((filters.presencas?.length ?? 0) > 0) {
      const leadPresenca = lead.presenca || '';
      if (!filters.presencas!.some(p => leadPresenca.includes(p))) return false;
    }

    // Interesse Ecossistema filter
    if (filters.interesseEcossistema) {
      // Verificar se o lead preencheu o formulário de interesse
      const preencheuFormulario = lead.data_interesse !== null && lead.data_interesse !== undefined;
      
      // Se não preencheu o formulário, não incluir em nenhum filtro de interesse
      if (!preencheuFormulario) return false;
      
      const temMTIA = lead.interesse_mtia === true;
      const temFormacao = lead.interesse_formacao === true;
      
      switch (filters.interesseEcossistema) {
        case 'mtia_e_formacao':
          if (!(temMTIA && temFormacao)) return false;
          break;
        case 'apenas_mtia':
          if (!(temMTIA && !temFormacao)) return false;
          break;
        case 'apenas_formacao':
          if (!(!temMTIA && temFormacao)) return false;
          break;
      }
    }

    return true;
  });
}

export function getUniqueValues(leads: Lead[], field: keyof Lead): string[] {
  const values = new Set<string>();
  
  for (const lead of leads) {
    const value = lead[field];
    if (value && typeof value === 'string' && value.trim()) {
      values.add(value);
    }
  }
  
  return Array.from(values).sort();
}
