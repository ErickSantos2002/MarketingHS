import { useState, useMemo } from 'react';
import { KPICards, KPICardType } from './KPICards';
import { LeadsLineChart } from './LeadsLineChart';
import { DistributionPieChart } from './DistributionPieChart';
import { SourceBarChart } from './SourceBarChart';
import { QualificationGauge } from './QualificationGauge';
import { LeadGoalGauge } from './LeadGoalGauge';
import { ForecastCard } from './ForecastCard';
import { DailyVolumeCard } from './DailyVolumeCard';
import { LeadsListSheet } from '@/components/admin/dashboard/LeadsListSheet';
import { DashboardCardSelector } from '@/components/admin/dashboard/DashboardCardSelector';
import { useDashboardCardSettings, type CardConfig } from '@/hooks/useDashboardCardSettings';
import type { Lead } from '@/hooks/useLeads';
import { useLeadQualification, type EnrichedLead, enrichLeadWithQualification } from '@/hooks/useLeadQualification';
import { useLeadAnalytics, BRASILIA_TIMEZONE } from '@/hooks/useLeadAnalytics';
import { useGoalSettings } from '@/hooks/useGoalSettings';
import { useAgendamentos, useAgendamentosByDay, countAgendamentos, getAgendamentoLeadIds, useMqlReuniaoAgendadaToday } from '@/hooks/useAgendamentos';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { parseISO, format, startOfWeek, endOfWeek, startOfDay, endOfDay, isWithinInterval, addDays, subDays } from 'date-fns';
import { formatInTimeZone, toZonedTime, format as formatTz } from 'date-fns-tz';
import { ptBR } from 'date-fns/locale';
import type { DashboardFilters } from '@/hooks/useDashboardFilters';
import { classifyChallengeThemes } from '@/hooks/useLeadAnalytics';

interface OverviewTabProps {
  leads: Lead[];
  allLeads: Lead[];
  showHotMetrics: boolean;
  onShowHotMetricsChange: (value: boolean) => void;
  datePreset?: 'today' | 'yesterday' | 'last7days' | 'last30days' | 'thisMonth' | 'all' | 'custom';
  dateFrom?: Date | null;
  dateTo?: Date | null;
  filters?: DashboardFilters;
}

// Apply filters WITHOUT date filter (for conversion calculations)
function applyNonDateFilters(leads: Lead[], filters?: DashboardFilters): Lead[] {
  if (!filters) return leads;
  
  return leads.filter(lead => {
    // Tipo filter
    if ((filters.tipos?.length ?? 0) > 0) {
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

    // Faturamento filter
    if ((filters.faturamentos?.length ?? 0) > 0) {
      const leadFaturamento = lead.faturamento || 'Não informado';
      if (!filters.faturamentos.includes(leadFaturamento)) return false;
    }

    // Cargo filter
    if ((filters.cargos?.length ?? 0) > 0) {
      const leadCargo = lead.cargo || 'Não informado';
      if (!filters.cargos.includes(leadCargo)) return false;
    }

    // Challenge themes filter
    if ((filters.challengeThemes?.length ?? 0) > 0) {
      const leadThemes = classifyChallengeThemes(lead.desafios);
      const hasMatchingTheme = filters.challengeThemes.some(theme => leadThemes.includes(theme));
      if (!hasMatchingTheme) return false;
    }

    // Hide incomplete leads filter
    if (filters.hideIncomplete) {
      const hasCompleteFaturamento = lead.faturamento && lead.faturamento.trim() !== '' && lead.faturamento.toLowerCase() !== 'não informado';
      const hasCompleteCargo = lead.cargo && lead.cargo.trim() !== '' && lead.cargo.toLowerCase() !== 'não informado';
      if (!hasCompleteFaturamento || !hasCompleteCargo) return false;
    }

    // Search filter
    if (filters.search?.trim()) {
      const searchLower = filters.search.toLowerCase().trim();
      const matchesName = lead.nome?.toLowerCase().includes(searchLower);
      const matchesEmail = lead.email?.toLowerCase().includes(searchLower);
      const matchesCompany = lead.empresa?.toLowerCase().includes(searchLower);
      const matchesWhatsapp = lead.whatsapp?.toLowerCase().includes(searchLower);
      if (!matchesName && !matchesEmail && !matchesCompany && !matchesWhatsapp) return false;
    }

    // Interesse Ecossistema filter
    if (filters.interesseEcossistema) {
      const preencheuFormulario = lead.data_interesse !== null && lead.data_interesse !== undefined;
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

    // Only reconversions filter
    if (filters.onlyReconversions) {
      if (!lead.last_conversion_date || !lead.created_at) return false;
      const created = new Date(lead.created_at).getTime();
      const lastConversion = new Date(lead.last_conversion_date).getTime();
      if (Math.abs(lastConversion - created) <= 60000) return false;
    }

    return true;
  });
}
const OVERVIEW_CARDS: CardConfig[] = [
  { key: 'kpi_total', label: 'Conversões / Total Leads', defaultVisible: true },
  { key: 'kpi_whatsapp', label: 'Grupo WhatsApp', defaultVisible: true },
  { key: 'kpi_conversions', label: 'Conversões Hoje', defaultVisible: true },
  { key: 'kpi_today', label: 'Leads Novos Hoje', defaultVisible: true },
  { key: 'kpi_week', label: 'Leads na Semana', defaultVisible: true },
  { key: 'kpi_agendamentos', label: 'Agendamentos', defaultVisible: true },
  { key: 'line_chart', label: 'Gráfico de Linha', defaultVisible: true },
  { key: 'distribution_pie', label: 'Distribuição por Modal', defaultVisible: true },
  { key: 'source_bar', label: 'Fontes', defaultVisible: true },
  { key: 'qualification_gauge', label: 'Qualification Gauge', defaultVisible: true },
  { key: 'lead_goal', label: 'Meta de Leads', defaultVisible: true },
  { key: 'forecast', label: 'Forecast', defaultVisible: true },
  { key: 'daily_volume', label: 'Volume Diário', defaultVisible: true },
];

export function OverviewTab({ leads, allLeads, showHotMetrics, onShowHotMetricsChange, datePreset = 'all', dateFrom, dateTo, filters }: OverviewTabProps) {
  const { enrichedLeads, qualificationCounts, qualificationRate } = useLeadQualification(leads);
  const analytics = useLeadAnalytics(leads);
  const { settings, updateGoal, updateDates, updateWhatsappGroup, isSaving } = useGoalSettings();
  const { visibleCards, toggleCard, resetCards, isVisible } = useDashboardCardSettings('overview', OVERVIEW_CARDS);

  // Sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedLeads, setSelectedLeads] = useState<EnrichedLead[]>([]);
  const [selectedTitle, setSelectedTitle] = useState('');

  // Determine if filtering by a single day
  const isSingleDayFilter = useMemo(() => {
    if (!dateFrom || !dateTo) return false;
    const fromStr = format(dateFrom, 'yyyy-MM-dd');
    const toStr = format(dateTo, 'yyyy-MM-dd');
    return fromStr === toStr;
  }, [dateFrom, dateTo]);

  // Format label for the single day filter
  const filterDateLabel = useMemo(() => {
    if (!dateFrom) return '';
    const nowInBrasilia = toZonedTime(new Date(), BRASILIA_TIMEZONE);
    const todayStr = format(nowInBrasilia, 'yyyy-MM-dd');
    const yesterdayStr = format(subDays(nowInBrasilia, 1), 'yyyy-MM-dd');
    const fromStr = format(dateFrom, 'yyyy-MM-dd');
    
    if (fromStr === todayStr) return 'Hoje';
    if (fromStr === yesterdayStr) return 'Ontem';
    return format(dateFrom, 'dd/MM', { locale: ptBR });
  }, [dateFrom]);

  // Apply non-date filters to allLeads for conversion calculations
  const filteredAllLeads = useMemo(() => {
    return applyNonDateFilters(allLeads, filters);
  }, [allLeads, filters]);

  // Memoized filtered leads for each KPI card - using Brasília timezone
  const leadsToday = useMemo(() => {
    const nowInBrasilia = toZonedTime(new Date(), BRASILIA_TIMEZONE);
    const todayStr = format(nowInBrasilia, 'yyyy-MM-dd');
    
    return enrichedLeads.filter(lead => {
      if (!lead.created_at) return false;
      const leadDayStr = formatInTimeZone(parseISO(lead.created_at), BRASILIA_TIMEZONE, 'yyyy-MM-dd');
      return leadDayStr === todayStr;
    });
  }, [enrichedLeads]);

  const conversionsToday = useMemo(() => {
    const nowInBrasilia = toZonedTime(new Date(), BRASILIA_TIMEZONE);
    const todayStr = format(nowInBrasilia, 'yyyy-MM-dd');
    
    const filtered = filteredAllLeads.filter(lead => {
      const dateField = lead.last_conversion_date;
      if (!dateField) return false;
      const conversionDayStr = formatInTimeZone(parseISO(dateField), BRASILIA_TIMEZONE, 'yyyy-MM-dd');
      return conversionDayStr === todayStr;
    });
  
  return filtered.map(lead => enrichLeadWithQualification(lead));
  }, [filteredAllLeads]);

  const leadsThisWeek = useMemo(() => {
    const nowInBrasilia = toZonedTime(new Date(), BRASILIA_TIMEZONE);
    const weekStart = startOfWeek(nowInBrasilia, { weekStartsOn: 0 });
    const weekEnd = endOfWeek(nowInBrasilia, { weekStartsOn: 0 });
    
    return enrichedLeads.filter(lead => {
      if (!lead.created_at) return false;
      const leadDateInBrasilia = toZonedTime(parseISO(lead.created_at), BRASILIA_TIMEZONE);
      return isWithinInterval(leadDateInBrasilia, { start: weekStart, end: weekEnd });
    });
  }, [enrichedLeads]);

  // Conversões no período filtrado (ou hoje se sem filtro)
  const conversionsInFilteredPeriod = useMemo(() => {
    // If filtering by a specific date range, get conversions in that range
    if (dateFrom && dateTo) {
      const fromStr = format(dateFrom, 'yyyy-MM-dd');
      const toStr = format(dateTo, 'yyyy-MM-dd');
      
      const filtered = filteredAllLeads.filter(lead => {
        const conversionDate = lead.last_conversion_date;
        if (!conversionDate) return false;
        
        const conversionDayStr = formatInTimeZone(
          parseISO(conversionDate), 
          BRASILIA_TIMEZONE, 
          'yyyy-MM-dd'
        );
        
        return conversionDayStr >= fromStr && conversionDayStr <= toStr;
      });
      
      return filtered.map(lead => enrichLeadWithQualification(lead));
    }
    
    // Default: today's conversions
    const nowInBrasilia = toZonedTime(new Date(), BRASILIA_TIMEZONE);
    const todayStr = format(nowInBrasilia, 'yyyy-MM-dd');
    
    const filtered = filteredAllLeads.filter(lead => {
      const conversionDate = lead.last_conversion_date;
      if (!conversionDate) return false;
      
      const conversionDayStr = formatInTimeZone(
        parseISO(conversionDate), 
        BRASILIA_TIMEZONE, 
        'yyyy-MM-dd'
      );
      
      return conversionDayStr === todayStr;
    });
    
    return filtered.map(lead => enrichLeadWithQualification(lead));
  }, [filteredAllLeads, dateFrom, dateTo]);

  // Contagem de reconversões (leads criados fora do período filtrado)
  const reconversionsCountInPeriod = useMemo(() => {
    if (dateFrom && dateTo) {
      const fromStr = format(dateFrom, 'yyyy-MM-dd');
      
      return conversionsInFilteredPeriod.filter(lead => {
        if (!lead.created_at) return false;
        const createdDayStr = formatInTimeZone(
          parseISO(lead.created_at), 
          BRASILIA_TIMEZONE, 
          'yyyy-MM-dd'
        );
        // Reconversão = criado ANTES do período filtrado
        return createdDayStr < fromStr;
      }).length;
    }
    
    // Default: today
    const nowInBrasilia = toZonedTime(new Date(), BRASILIA_TIMEZONE);
    const todayStr = format(nowInBrasilia, 'yyyy-MM-dd');
    
    return conversionsInFilteredPeriod.filter(lead => {
      if (!lead.created_at) return false;
      const createdDayStr = formatInTimeZone(
        parseISO(lead.created_at), 
        BRASILIA_TIMEZONE, 
        'yyyy-MM-dd'
      );
      return createdDayStr !== todayStr;
    }).length;
  }, [conversionsInFilteredPeriod, dateFrom, dateTo]);

   // Reconversões de hoje (para quando showTemporalKPIs = true)
   const reconversionsCountToday = useMemo(() => {
     const nowInBrasilia = toZonedTime(new Date(), BRASILIA_TIMEZONE);
     const todayStr = format(nowInBrasilia, 'yyyy-MM-dd');
     
     return conversionsToday.filter(lead => {
       if (!lead.created_at) return false;
       const createdDayStr = formatInTimeZone(
         parseISO(lead.created_at), 
         BRASILIA_TIMEZONE, 
         'yyyy-MM-dd'
       );
       // Reconversão = criado ANTES de hoje
       return createdDayStr !== todayStr;
     }).length;
   }, [conversionsToday]);
 
  // Conversões no período selecionado (usando last_conversion_date) - agora respeitando filtros globais
  const conversionsInPeriod = useMemo(() => {
    if (!dateFrom && !dateTo) return filteredAllLeads.length;
    
    return filteredAllLeads.filter(lead => {
      const conversionDate = lead.last_conversion_date;
      if (!conversionDate) return false;
      
      const conversionDateParsed = toZonedTime(parseISO(conversionDate), BRASILIA_TIMEZONE);
      
      if (dateFrom && conversionDateParsed < startOfDay(dateFrom)) return false;
      if (dateTo) {
        const endDate = endOfDay(dateTo);
        if (conversionDateParsed > endDate) return false;
      }
      
      return true;
    }).length;
  }, [filteredAllLeads, dateFrom, dateTo]);

  // Reconversões no período = conversões totais - leads criados no período
  const periodReconversions = useMemo(() => {
    return Math.max(0, conversionsInPeriod - enrichedLeads.length);
  }, [conversionsInPeriod, enrichedLeads.length]);

  // Conversões por dia usando allLeads (filtrado pelo período selecionado)
  const allConversionsByDay = useMemo(() => {
    const counts = new Map<string, number>();
    
    for (const lead of allLeads) {
      const dateField = lead.last_conversion_date;
      if (!dateField) continue;
      
      // Verificar se a conversão está dentro do período filtrado
      const conversionDate = toZonedTime(parseISO(dateField), BRASILIA_TIMEZONE);
      
      if (dateFrom && conversionDate < startOfDay(dateFrom)) continue;
      if (dateTo && conversionDate > endOfDay(dateTo)) continue;
      
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
  }, [allLeads, dateFrom, dateTo]);

  const hotLeads = useMemo(() => 
    enrichedLeads.filter(lead => lead.qualification === 'hot'),
    [enrichedLeads]
  );

  // Agendamentos (meeting_scheduled + scheduling_widget_booked)
  const { events: agendamentoEvents } = useAgendamentos();
  const filteredLeadIds = useMemo(() => new Set(enrichedLeads.map(l => l.id)), [enrichedLeads]);
  const allLeadIds = useMemo(() => new Set(allLeads.map(l => l.id)), [allLeads]);

  const agendamentosByDay = useAgendamentosByDay(
    agendamentoEvents,
    allLeadIds,
    dateFrom,
    dateTo,
  );

  const agendamentosCount = useMemo(
    () => countAgendamentos(agendamentoEvents, filteredLeadIds, dateFrom, dateTo),
    [agendamentoEvents, filteredLeadIds, dateFrom, dateTo],
  );

  const agendamentosLeads = useMemo(() => {
    const ids = getAgendamentoLeadIds(agendamentoEvents, filteredLeadIds, dateFrom, dateTo);
    return enrichedLeads.filter(l => ids.has(l.id));
  }, [agendamentoEvents, filteredLeadIds, dateFrom, dateTo, enrichedLeads]);

  // "Agendamentos Hoje" = leads que ENTRARAM em 'MQL - Reunião agendada' hoje
  // (independente de status atual). Respeita filtros globais via filteredLeadIds.
  const { leadIds: mqlReuniaoTodayIds } = useMqlReuniaoAgendadaToday();

  const agendamentosTodayCount = useMemo(() => {
    let n = 0;
    for (const id of mqlReuniaoTodayIds) if (filteredLeadIds.has(id)) n++;
    return n;
  }, [mqlReuniaoTodayIds, filteredLeadIds]);

  const agendamentosTodayLeads = useMemo(() => {
    return enrichedLeads.filter(l => mqlReuniaoTodayIds.has(l.id));
  }, [mqlReuniaoTodayIds, enrichedLeads]);


  // Calculate conversions within the goal period (using last_conversion_date, same logic as "Conversões no Período")
  const leadsInGoalPeriod = useMemo(() => {
    if (!settings.start_date || !settings.end_date) return allLeads.length;
    
    const goalStart = startOfDay(parseISO(settings.start_date));
    const goalEnd = endOfDay(parseISO(settings.end_date));
    
    return allLeads.filter(lead => {
      const conversionDate = lead.last_conversion_date;
      if (!conversionDate) return false;
      const dateInBrasilia = toZonedTime(parseISO(conversionDate), BRASILIA_TIMEZONE);
      return dateInBrasilia >= goalStart && dateInBrasilia <= goalEnd;
    }).length;
  }, [allLeads, settings.start_date, settings.end_date]);

  // Determine if we should show temporal KPIs (today/week)
  // Show if: no date filter active OR today is within the selected period
  const showTemporalKPIs = useMemo(() => {
    if (datePreset === 'all') return true;
    
    // If no dates defined, show KPIs
    if (!dateFrom && !dateTo) return true;
    
    // Check if today is within the selected period
    const nowInBrasilia = toZonedTime(new Date(), BRASILIA_TIMEZONE);
    const todayStart = startOfDay(nowInBrasilia);
    
    // Check if today falls within the date range
    const isDateFromValid = !dateFrom || dateFrom <= todayStart;
    const isDateToValid = !dateTo || endOfDay(dateTo) >= todayStart;
    
    return isDateFromValid && isDateToValid;
  }, [datePreset, dateFrom, dateTo]);

  const [showExtraCards, setShowExtraCards] = useState(false);

  const handleCardClick = (type: KPICardType, leads: EnrichedLead[], title: string) => {
    setSelectedLeads(leads);
    setSelectedTitle(title);
    setSheetOpen(true);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Card Selector */}
      <div className="flex justify-end">
        <DashboardCardSelector cards={OVERVIEW_CARDS} visibleCards={visibleCards} onToggle={toggleCard} onReset={resetCards} />
      </div>

      {/* KPI Cards */}
      <KPICards
        totalLeads={enrichedLeads}
        leadsToday={leadsToday}
        conversionsToday={showTemporalKPIs ? conversionsToday : conversionsInFilteredPeriod}
        reconversionsCount={showTemporalKPIs ? reconversionsCountToday : reconversionsCountInPeriod}
        leadsThisWeek={leadsThisWeek}
        agendamentosCount={agendamentosCount}
        agendamentosTodayCount={agendamentosTodayCount}
        agendamentosLeads={agendamentosLeads}
        agendamentosTodayLeads={agendamentosTodayLeads}
        onCardClick={handleCardClick}
        whatsappGroupCount={settings.whatsapp_group}
        onUpdateWhatsappGroup={updateWhatsappGroup}
        isSavingWhatsapp={isSaving}
        showTemporalKPIs={showTemporalKPIs}
        hasDateFilter={datePreset !== 'all'}
        periodReconversions={periodReconversions}
        periodConversions={conversionsInPeriod}
        isSingleDayFilter={isSingleDayFilter}
        filterDateLabel={filterDateLabel}
        visibleKPIs={{
          total: isVisible('kpi_total'),
          whatsapp: isVisible('kpi_whatsapp'),
          conversions: isVisible('kpi_conversions'),
          today: isVisible('kpi_today'),
          week: isVisible('kpi_week'),
          agendamentos: isVisible('kpi_agendamentos'),
        }}
      />

      {/* Line Chart (Agendamentos por Dia) */}
      {isVisible('line_chart') && (
        <LeadsLineChart 
          data={analytics.leadsByDay} 
          conversionData={agendamentosByDay} 
          allConversionData={agendamentosByDay}
          filteredLeads={enrichedLeads}
          allLeads={allLeads}
          showHotMetrics={showHotMetrics} 
          onShowHotMetricsChange={onShowHotMetricsChange}
          isSingleDayFilter={isSingleDayFilter}
          filterDateLabel={filterDateLabel}
        />
      )}

      {/* Toggle for extra details */}
      <div className="flex justify-center">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowExtraCards(v => !v)}
          className="gap-2"
        >
          {showExtraCards ? (
            <>
              <ChevronUp className="h-4 w-4" />
              Ocultar detalhes
            </>
          ) : (
            <>
              <ChevronDown className="h-4 w-4" />
              Mostrar mais detalhes
            </>
          )}
        </Button>
      </div>

      {showExtraCards && (
        <div className="space-y-6 animate-fade-in">
          {/* Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {isVisible('distribution_pie') && (
              <DistributionPieChart data={analytics.distributionByTipo} title="Distribuição por Modal" />
            )}

            {isVisible('source_bar') && (
              <SourceBarChart data={analytics.distributionBySource} />
            )}
          </div>

          {/* Goal & Forecast Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {isVisible('qualification_gauge') && (
              <QualificationGauge rate={qualificationRate} />
            )}

            {isVisible('lead_goal') && (
              <LeadGoalGauge
                currentLeads={leadsInGoalPeriod}
                goal={settings.goal}
                startDate={settings.start_date}
                endDate={settings.end_date}
                onUpdateGoal={updateGoal}
                onUpdateDates={updateDates}
                isSaving={isSaving}
              />
            )}

            {isVisible('forecast') && (
              <ForecastCard
                currentLeads={leadsInGoalPeriod}
                goal={settings.goal}
                startDate={settings.start_date}
                endDate={settings.end_date}
                onUpdateDates={updateDates}
                isSaving={isSaving}
              />
            )}

            {isVisible('daily_volume') && (
              <DailyVolumeCard
                currentLeads={leadsInGoalPeriod}
                goal={settings.goal}
                startDate={settings.start_date}
                endDate={settings.end_date}
              />
            )}
          </div>
        </div>
      )}

      {/* Leads List Sheet */}
      <LeadsListSheet
        leads={selectedLeads}
        title={selectedTitle}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </div>
  );
}
