import { useState } from 'react';
import { Users, UserCheck, Calendar, CalendarCheck, ChevronRight, MessageCircle, Pencil, Check, X, Loader2, RefreshCw, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { EnrichedLead } from '@/hooks/useLeadQualification';

export type KPICardType = 'total' | 'today' | 'conversions' | 'week' | 'agendamentos';


export interface KPIVisibility {
  total: boolean;
  whatsapp: boolean;
  conversions: boolean;
  today: boolean;
  week: boolean;
  agendamentos: boolean;
}

interface KPICardsProps {
  totalLeads: EnrichedLead[];
  leadsToday: EnrichedLead[];
  conversionsToday: EnrichedLead[];
  reconversionsCount: number;
  leadsThisWeek: EnrichedLead[];
  agendamentosCount: number;
  agendamentosTodayCount: number;
  agendamentosLeads?: EnrichedLead[];
  agendamentosTodayLeads?: EnrichedLead[];
  onCardClick: (type: KPICardType, leads: EnrichedLead[], title: string) => void;
  whatsappGroupCount: number;
  onUpdateWhatsappGroup: (count: number) => Promise<void>;
  isSavingWhatsapp?: boolean;
  showTemporalKPIs?: boolean;
  hasDateFilter?: boolean;
  periodReconversions?: number;
  periodConversions?: number;
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
        "glass-card p-6 relative overflow-hidden group cursor-pointer text-left w-full",
        "hover:border-primary/30 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300"
      )}
      style={{ animationDelay: delay }}
    >
      {/* Background glow */}
      <div
        className={cn(
          "absolute -top-10 -right-10 w-32 h-32 rounded-full opacity-20 blur-2xl transition-opacity duration-300",
          "group-hover:opacity-40",
          gradient
        )}
      />

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

interface WhatsAppKPICardProps {
  value: number;
  periodConversionsCount: number;
  onUpdate: (count: number) => Promise<void>;
  isSaving?: boolean;
  delay?: string;
}

function WhatsAppKPICard({ value, periodConversionsCount, onUpdate, isSaving, delay = '0ms' }: WhatsAppKPICardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value.toString());

  const percentage = periodConversionsCount > 0 
    ? ((value / periodConversionsCount) * 100).toFixed(1) 
    : '0.0';

  const handleSave = async () => {
    const newCount = parseInt(editValue) || 0;
    if (newCount >= 0) {
      await onUpdate(newCount);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(value.toString());
    setIsEditing(false);
  };

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditValue(value.toString());
    setIsEditing(true);
  };

  return (
    <div
      className={cn(
        "glass-card p-6 relative overflow-hidden group text-left w-full",
        "hover:border-primary/30 transition-all duration-300"
      )}
      style={{ animationDelay: delay }}
    >
      {/* Background glow - WhatsApp green */}
      <div
        className={cn(
          "absolute -top-10 -right-10 w-32 h-32 rounded-full opacity-20 blur-2xl transition-opacity duration-300",
          "group-hover:opacity-40",
          "bg-gradient-to-br from-[#25D366] to-[#128C7E]"
        )}
      />

      <div className="relative z-10">
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm text-muted-foreground font-medium">Grupo WhatsApp</span>
          <div className="flex items-center gap-1">
            {!isEditing && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 opacity-50 hover:opacity-100"
                onClick={handleStartEdit}
              >
                <Pencil className="h-3 w-3" />
              </Button>
            )}
            <div className="p-2 rounded-lg bg-gradient-to-br from-[#25D366] to-[#128C7E]">
              <MessageCircle className="h-5 w-5 text-white" />
            </div>
          </div>
        </div>

        {isEditing ? (
          <div className="flex items-center gap-2 animate-fade-in">
            <Input
              type="number"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="h-10 text-lg font-bold"
              placeholder="Quantidade..."
              autoFocus
              min={0}
              onClick={(e) => e.stopPropagation()}
            />
            <Button
              size="icon"
              variant="ghost"
              className="h-10 w-10 text-chart-2 hover:text-chart-2/80"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-10 w-10 text-destructive hover:text-destructive/80"
              onClick={handleCancel}
              disabled={isSaving}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-end justify-between gap-2">
            <div className="flex flex-col">
              <span className="text-4xl font-bold text-foreground tracking-tight">
                {value.toLocaleString('pt-BR')}
              </span>
              <span className="text-xs text-[#25D366] font-medium mt-1">
                {percentage}% dos leads
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function KPICards({ 
  totalLeads, 
  leadsToday, 
  conversionsToday,
  reconversionsCount,
  leadsThisWeek, 
  agendamentosCount,
  agendamentosTodayCount,
  agendamentosLeads = [],
  agendamentosTodayLeads = [],
  onCardClick,
  whatsappGroupCount,
  onUpdateWhatsappGroup,
  isSavingWhatsapp,
  showTemporalKPIs = true,
  hasDateFilter = false,
  periodReconversions = 0,
  periodConversions = 0,
  isSingleDayFilter = false,
  filterDateLabel = '',
  visibleKPIs = { total: true, whatsapp: true, conversions: true, today: true, week: true, agendamentos: true }
}: KPICardsProps) {
  // Determine title and subtitle for the Total Leads card
  const showReconversionInfo = hasDateFilter && periodReconversions > 0;
  const totalLeadsTitle = hasDateFilter ? 'Conversões no Período' : 'Total de Leads';
  const totalLeadsSubtitle = showReconversionInfo 
    ? `(${periodReconversions} reconversões)`
    : undefined;

  // Count visible cards to determine grid
  const visibleCount = [
    visibleKPIs.total,
    visibleKPIs.whatsapp,
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
            title={totalLeadsTitle}
            value={hasDateFilter ? periodConversions : totalLeads.length}
            icon={<Users className="h-5 w-5 text-white" />}
            gradient="bg-gradient-to-br from-accent to-primary"
            glowColor="primary"
            delay="0ms"
            onClick={() => onCardClick('total', totalLeads, totalLeadsTitle)}
            subtitle={totalLeadsSubtitle}
            subtitleColor="text-muted-foreground"
          />
          {showReconversionInfo && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="absolute top-2 right-2 p-1 rounded-full bg-background/50 hover:bg-background/80 transition-colors z-20">
                  <Info className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[280px]">
                <p className="text-xs">
                  <strong>{periodConversions}</strong> conversões totais no período.
                  <br />
                  <strong>{totalLeads.length}</strong> são leads novos criados no período.
                  <br />
                  <strong>{periodReconversions}</strong> são reconversões de leads anteriores.
                </p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        )}

      {visibleKPIs.whatsapp && (
      <WhatsAppKPICard
        value={whatsappGroupCount}
        periodConversionsCount={hasDateFilter ? periodConversions : totalLeads.length}
        onUpdate={onUpdateWhatsappGroup}
        isSaving={isSavingWhatsapp}
        delay="50ms"
      />
      )}

      {showTemporalKPIs ? (
        <>
          {visibleKPIs.conversions && (
          <KPICard
            title={conversionCardTitle}
            value={conversionsToday.length}
            icon={<RefreshCw className="h-5 w-5 text-white" />}
            gradient="bg-gradient-to-br from-emerald-500 to-emerald-700"
            glowColor="emerald"
            delay="100ms"
            subtitle={reconversionsCount > 0 ? `(${reconversionsCount} reconversões)` : undefined}
            subtitleColor="text-emerald-500"
            onClick={() => onCardClick('conversions', conversionsToday, conversionCardTitle)}
          />
          )}
          {visibleKPIs.today && (
          <KPICard
            title="Leads Novos Hoje"
            value={leadsToday.length}
            icon={<Calendar className="h-5 w-5 text-white" />}
            gradient="bg-gradient-to-br from-primary to-primary/70"
            glowColor="blue"
            delay="150ms"
            onClick={() => onCardClick('today', leadsToday, 'Leads Novos Hoje')}
          />
          )}
          {visibleKPIs.week && (
          <KPICard
            title="Leads na Semana"
            value={leadsThisWeek.length}
            icon={<UserCheck className="h-5 w-5 text-white" />}
            gradient="bg-gradient-to-br from-amber-500 to-amber-700"
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
          icon={<RefreshCw className="h-5 w-5 text-white" />}
          gradient="bg-gradient-to-br from-emerald-500 to-emerald-700"
          glowColor="emerald"
          delay="100ms"
          subtitle={reconversionsCount > 0 ? `(${reconversionsCount} reconversões)` : undefined}
          subtitleColor="text-emerald-500"
          onClick={() => onCardClick('conversions', conversionsToday, conversionCardTitle)}
        />
      ) : null}

      {visibleKPIs.agendamentos && (
      <KPICard
        title={agendamentosTitle}
        value={agendamentosValue}
        icon={<CalendarCheck className="h-5 w-5 text-white" />}
        gradient="bg-gradient-to-br from-violet-500 to-violet-700"
        glowColor="violet"
        delay={showTemporalKPIs ? "250ms" : "100ms"}
        subtitle="Reuniões marcadas"
        subtitleColor="text-violet-400"
        onClick={() => onCardClick('agendamentos', hasDateFilter ? agendamentosLeads : agendamentosTodayLeads, agendamentosTitle)}
      />
      )}
      </div>
    </TooltipProvider>
  );
}
