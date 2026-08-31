import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Zap, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';
import { differenceInDays, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';

interface DailyVolumeCardProps {
  currentLeads: number;
  goal: number;
  startDate: string;
  endDate: string;
}

export function DailyVolumeCard({
  currentLeads,
  goal,
  startDate,
  endDate,
}: DailyVolumeCardProps) {
  const today = new Date();
  const start = parseISO(startDate);
  const end = parseISO(endDate);

  // Calculations
  const totalDays = Math.max(differenceInDays(end, start) + 1, 1);
  const elapsedDays = Math.max(Math.min(differenceInDays(today, start) + 1, totalDays), 1);
  const remainingDays = Math.max(differenceInDays(end, today) + 1, 0);

  const leadsNeeded = Math.max(goal - currentLeads, 0);
  const dailyNeeded = remainingDays > 0 ? Math.ceil(leadsNeeded / remainingDays) : 0;
  const currentAverage = currentLeads / elapsedDays;

  const isOnTrack = currentAverage >= dailyNeeded || leadsNeeded === 0;
  const isAlmostThere = currentAverage >= dailyNeeded * 0.8;
  const isCritical = dailyNeeded > currentAverage * 2;

  const getStatusColor = () => {
    if (leadsNeeded === 0) return 'text-green-500';
    if (isOnTrack) return 'text-green-500';
    if (isAlmostThere) return 'text-yellow-500';
    return 'text-red-500';
  };

  const getStatusBg = () => {
    if (leadsNeeded === 0) return 'bg-green-500/10 border-green-500/20';
    if (isOnTrack) return 'bg-green-500/10 border-green-500/20';
    if (isAlmostThere) return 'bg-yellow-500/10 border-yellow-500/20';
    return 'bg-red-500/10 border-red-500/20';
  };

  const getIcon = () => {
    if (leadsNeeded === 0) return <Zap className="h-4 w-4 text-green-500" />;
    if (isOnTrack) return <TrendingUp className="h-4 w-4 text-green-500" />;
    if (isCritical) return <AlertTriangle className="h-4 w-4 text-red-500" />;
    return <TrendingDown className="h-4 w-4 text-yellow-500" />;
  };

  const getMessage = () => {
    if (leadsNeeded === 0) return 'Meta batida! 🎉';
    if (remainingDays === 0) return 'Último dia!';
    if (isOnTrack) return 'Ritmo adequado';
    if (isCritical) return 'Ação urgente!';
    return 'Acelerar captação';
  };

  const getDiff = () => {
    const diff = currentAverage - dailyNeeded;
    if (diff >= 0) return `+${diff.toFixed(1)} acima`;
    return `${Math.abs(diff).toFixed(1)} abaixo`;
  };

  return (
    <Card className={cn('border shadow-lg transition-all', getStatusBg())}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          {getIcon()}
          Volume Diário Necessário
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {/* Main Number */}
        <div className="text-center py-3">
          <div className={cn('text-5xl font-bold', getStatusColor())}>
            {dailyNeeded}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            leads/dia nos próximos {remainingDays} dias
          </div>
          <div className={cn('text-sm font-medium mt-2', getStatusColor())}>
            {getMessage()}
          </div>
        </div>

        {/* Comparison */}
        <div className="grid grid-cols-3 gap-2 mt-3 text-center text-xs">
          <div className="bg-muted/50 rounded-md p-2">
            <div className="font-semibold text-foreground">{leadsNeeded.toLocaleString('pt-BR')}</div>
            <div className="text-muted-foreground">Faltam</div>
          </div>
          <div className="bg-muted/50 rounded-md p-2">
            <div className="font-semibold text-foreground">{currentAverage.toFixed(1)}</div>
            <div className="text-muted-foreground">Atual/dia</div>
          </div>
          <div className={cn('rounded-md p-2', isOnTrack ? 'bg-green-500/20' : 'bg-red-500/20')}>
            <div className={cn('font-semibold', isOnTrack ? 'text-green-500' : 'text-red-500')}>
              {getDiff()}
            </div>
            <div className="text-muted-foreground">Diferença</div>
          </div>
        </div>

        {/* Alert for Critical */}
        {isCritical && remainingDays > 0 && (
          <div className="mt-3 p-2 bg-red-500/10 border border-red-500/20 rounded-md flex items-center gap-2 text-xs text-red-500">
            <AlertTriangle className="h-3 w-3 flex-shrink-0" />
            <span>Necessário {((dailyNeeded / currentAverage) - 1) * 100 | 0}% mais leads/dia</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
