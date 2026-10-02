import { UserPlus, UserCheck, Calendar, CalendarCheck, ChevronRight, RefreshCw, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { EnrichedLead } from '@/hooks/useLeadQualification';

export type KPICardType = 'total' | 'today' | 'conversions' | 'week' | 'agendamentos';


export interface KPIVisibility {
  total: boolean;
  conversions: boolean;
  today: boolean;
  week: boolean;
  agendamentos: boolean;
}

interface KPICardsProps {
  /** Leads novos: `created_at` dentro do período (ou a base inteira, sem filtro de data). */
  newLeads: EnrichedLead[];
  /** Reconversões do mesmo recorte: contato antigo que voltou a converter. Não é lead novo. */
  reconversionsInScope: number;
  leadsToday: EnrichedLead[];
  conversionsToday: EnrichedLead[];
  reconversionsCount: number;
  leadsThisWeek: EnrichedLead[];
  agendamentosCount: number;
  agendamentosTodayCount: number;
  agendamentosLeads?: EnrichedLead[];
  agendamentosTodayLeads?: EnrichedLead[];
  onCardClick: (type: KPICardType, leads: EnrichedLead[], title: string) => void;
  showTemporalKPIs?: boolean;
  hasDateFilter?: boolean;
  isSingleDayFilter?: boolean;
  filterDateLabel?: string;
  visibleKPIs?: KPIVisibility;
}

interface KPICardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
  gradient: string;
  glowColor: string;
  delay?: string;
  onClick: () => void;
  subtitle?: string;
  subtitleColor?: string;
}

function KPICard({ title, value, icon, gradient, glowColor, delay = '0ms', onClick, subtitle, subtitleColor }: KPICardProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "bg-card border rounded-xl p-6 relative overflow-hidden group cursor-pointer text-left w-full",
        "hover:border-primary/30 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300"
      )}
      style={{ animationDelay: delay }}
    >
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm text-muted-foreground font-medium">{title}</span>
          <div className={cn("p-2 rounded-lg", gradient)}>
            {icon}
          </div>
        </div>

        <div className="flex items-end justify-between gap-2">
          <div className="flex flex-col">
            <span className="text-4xl font-bold text-foreground tracking-tight">
              {value.toLocaleString('pt-BR')}
            </span>
            {subtitle && (
              <span className={cn("text-xs font-medium mt-1", subtitleColor || "text-muted-foreground")}>
                {subtitle}
              </span>
            )}
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
        </div>
      </div>
    </button>
  );
}

export function KPICards({
  newLeads,
  reconversionsInScope,
  leadsToday, 
  conversionsToday,
  reconversionsCount,
  leadsThisWeek, 
  agendamentosCount,
  agendamentosTodayCount,
  agendamentosLeads = [],
  agendamentosTodayLeads = [],
  onCardClick,
  showTemporalKPIs = true,
  hasDateFilter = false,
  isSingleDayFilter = false,
  filterDateLabel = '',
  visibleKPIs = { total: true, conversions: true, today: true, week: true, agendamentos: true }
}: KPICardsProps) {
  // O número principal é lead NOVO (cadastro no período). Reconversão — contato
  // antigo que preencheu de novo — aparece à parte e não soma (raio-x RD, R6).
  const newLeadsTitle = hasDateFilter ? 'Leads novos no período' : 'Leads novos (todo o período)';
  const newLeadsSubtitle = reconversionsInScope > 0
    ? `+ ${reconversionsInScope.toLocaleString('pt-BR')} reconversões à parte`
    : undefined;

  // Count visible cards to determine grid
  const visibleCount = [
    visibleKPIs.total,
    showTemporalKPIs ? visibleKPIs.conversions : (isSingleDayFilter ? visibleKPIs.conversions : false),
    showTemporalKPIs ? visibleKPIs.today : false,
    showTemporalKPIs ? visibleKPIs.week : false,
    visibleKPIs.agendamentos,
  ].filter(Boolean).length;

  const gridCols = visibleCount <= 2
    ? "grid-cols-1 sm:grid-cols-2"
    : visibleCount <= 4
    ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
    : visibleCount <= 5
    ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-5"
    : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-6";

  // Dynamic conversion card title
  const conversionCardTitle = isSingleDayFilter 
    ? `Conversões ${filterDateLabel}`
    : 'Conversões Hoje';

  // Dynamic agendamentos card title/value
  const agendamentosTitle = hasDateFilter
    ? (isSingleDayFilter ? `Agendamentos ${filterDateLabel}` : 'Agendamentos no Período')
    : 'Agendamentos Hoje';
  const agendamentosValue = hasDateFilter ? agendamentosCount : agendamentosTodayCount;

  if (visibleCount === 0) return null;

  return (
    <TooltipProvider>
      <div className={`grid ${gridCols} gap-4`}>
        {visibleKPIs.total && (
        <div className="relative">
          <KPICard
            title={newLeadsTitle}
            value={newLeads.length}
            icon={<UserPlus className="h-5 w-5 text-primary-foreground" />}
            gradient="bg-info"
            glowColor="primary"
            delay="0ms"
            onClick={() => onCardClick('total', newLeads, newLeadsTitle)}
            subtitle={newLeadsSubtitle}
            subtitleColor="text-muted-foreground"
          />
          {reconversionsInScope > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="absolute top-2 right-2 p-1 rounded-full bg-background/50 hover:bg-background/80 transition-colors z-20">
                  <Info className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[280px]">
                <p className="text-xs">
                  <strong>{newLeads.length.toLocaleString('pt-BR')}</strong> leads novos: o cadastro
                  {hasDateFilter ? ' caiu no período' : ' é o primeiro contato'}.
                  <br />
                  <strong>{reconversionsInScope.toLocaleString('pt-BR')}</strong> reconversões: contatos
                  que já existiam e converteram de novo{hasDateFilter ? ' no período' : ''}. Não contam
                  como lead novo.
                </p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        )}

      {showTemporalKPIs ? (
        <>
          {visibleKPIs.conversions && (
          <KPICard
            title={conversionCardTitle}
            value={conversionsToday.length}
            icon={<RefreshCw className="h-5 w-5 text-primary-foreground" />}
            gradient="bg-success"
            glowColor="emerald"
            delay="100ms"
            subtitle={reconversionsCount > 0 ? `(${reconversionsCount} reconversões)` : undefined}
            subtitleColor="text-[--on-tint-success]"
            onClick={() => onCardClick('conversions', conversionsToday, conversionCardTitle)}
          />
          )}
          {visibleKPIs.today && (
          <KPICard
            title="Leads Novos Hoje"
            value={leadsToday.length}
            icon={<Calendar className="h-5 w-5 text-primary-foreground" />}
            gradient="bg-primary"
            glowColor="blue"
            delay="150ms"
            onClick={() => onCardClick('today', leadsToday, 'Leads Novos Hoje')}
          />
          )}
          {visibleKPIs.week && (
          <KPICard
            title="Leads na Semana"
            value={leadsThisWeek.length}
            icon={<UserCheck className="h-5 w-5 text-[--color-slate-900]" />}
            gradient="bg-warning"
            glowColor="amber"
            delay="200ms"
            onClick={() => onCardClick('week', leadsThisWeek, 'Leads na Semana')}
          />
          )}
        </>
      ) : isSingleDayFilter && visibleKPIs.conversions ? (
        <KPICard
          title={conversionCardTitle}
          value={conversionsToday.length}
          icon={<RefreshCw className="h-5 w-5 text-primary-foreground" />}
          gradient="bg-success"
          glowColor="emerald"
          delay="100ms"
          subtitle={reconversionsCount > 0 ? `(${reconversionsCount} reconversões)` : undefined}
          subtitleColor="text-[--on-tint-success]"
          onClick={() => onCardClick('conversions', conversionsToday, conversionCardTitle)}
        />
      ) : null}

      {visibleKPIs.agendamentos && (
      <KPICard
        title={agendamentosTitle}
        value={agendamentosValue}
        icon={<CalendarCheck className="h-5 w-5 text-primary-foreground" />}
        gradient="bg-primary"
        glowColor="violet"
        delay={showTemporalKPIs ? "250ms" : "100ms"}
        subtitle="Reuniões marcadas"
        subtitleColor="text-[--on-tint-primary]"
        onClick={() => onCardClick('agendamentos', hasDateFilter ? agendamentosLeads : agendamentosTodayLeads, agendamentosTitle)}
      />
      )}
      </div>
    </TooltipProvider>
  );
}
