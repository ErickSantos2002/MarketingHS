import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { TrendingUp, CalendarIcon, Loader2, Settings2 } from 'lucide-react';
import { format, differenceInDays, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';

interface ForecastCardProps {
  currentLeads: number;
  goal: number;
  startDate: string;
  endDate: string;
  onUpdateDates: (startDate: string, endDate: string) => Promise<void>;
  isSaving?: boolean;
}

export function ForecastCard({
  currentLeads,
  goal,
  startDate,
  endDate,
  onUpdateDates,
  isSaving,
}: ForecastCardProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [localStartDate, setLocalStartDate] = useState<Date>(parseISO(startDate));
  const [localEndDate, setLocalEndDate] = useState<Date>(parseISO(endDate));

  const today = new Date();
  const start = parseISO(startDate);
  const end = parseISO(endDate);

  // Calculations
  const totalDays = Math.max(differenceInDays(end, start) + 1, 1);
  const elapsedDays = Math.max(Math.min(differenceInDays(today, start) + 1, totalDays), 1);
  const remainingDays = Math.max(differenceInDays(end, today), 0);

  const averagePerDay = currentLeads / elapsedDays;
  const forecast = Math.round(averagePerDay * totalDays);
  const forecastPercentage = (forecast / goal) * 100;

  const getStatusColor = () => {
    if (forecastPercentage >= 100) return 'text-green-500';
    if (forecastPercentage >= 80) return 'text-yellow-500';
    return 'text-red-500';
  };

  const getStatusBg = () => {
    if (forecastPercentage >= 100) return 'bg-green-500/10 border-green-500/20';
    if (forecastPercentage >= 80) return 'bg-yellow-500/10 border-yellow-500/20';
    return 'bg-red-500/10 border-red-500/20';
  };

  const getStatusText = () => {
    if (forecastPercentage >= 100) return 'No ritmo! 🎯';
    if (forecastPercentage >= 80) return 'Quase lá ⚡';
    return 'Acelerar! 🚀';
  };

  const handleSaveDates = async () => {
    await onUpdateDates(
      format(localStartDate, 'yyyy-MM-dd'),
      format(localEndDate, 'yyyy-MM-dd')
    );
    setShowSettings(false);
  };

  return (
    <Card className={cn('border shadow-lg transition-all', getStatusBg())}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TrendingUp className={cn('h-4 w-4', getStatusColor())} />
            Forecast
          </CardTitle>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 opacity-50 hover:opacity-100"
            onClick={() => setShowSettings(!showSettings)}
          >
            <Settings2 className="h-3 w-3" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {/* Date Settings */}
        {showSettings && (
          <div className="mb-4 p-3 bg-muted/50 rounded-lg space-y-3 animate-fade-in">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Início</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="w-full justify-start text-xs h-8">
                      <CalendarIcon className="mr-1 h-3 w-3" />
                      {format(localStartDate, 'dd/MM/yy')}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={localStartDate}
                      onSelect={(date) => date && setLocalStartDate(date)}
                      locale={ptBR}
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Fim</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="w-full justify-start text-xs h-8">
                      <CalendarIcon className="mr-1 h-3 w-3" />
                      {format(localEndDate, 'dd/MM/yy')}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={localEndDate}
                      onSelect={(date) => date && setLocalEndDate(date)}
                      locale={ptBR}
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            <Button
              size="sm"
              className="w-full h-7 text-xs"
              onClick={handleSaveDates}
              disabled={isSaving}
            >
              {isSaving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Salvar Período
            </Button>
          </div>
        )}

        {/* Forecast Display */}
        <div className="text-center py-3">
          <div className={cn('text-4xl font-bold', getStatusColor())}>
            {forecast.toLocaleString('pt-BR')}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            leads projetados ({forecastPercentage.toFixed(0)}% da meta)
          </div>
          <div className={cn('text-sm font-medium mt-2', getStatusColor())}>
            {getStatusText()}
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mt-3">
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>Dia {elapsedDays} de {totalDays}</span>
            <span>{remainingDays} dias restantes</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                forecastPercentage >= 100 ? 'bg-green-500' :
                forecastPercentage >= 80 ? 'bg-yellow-500' : 'bg-red-500'
              )}
              style={{ width: `${Math.min((elapsedDays / totalDays) * 100, 100)}%` }}
            />
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-2 mt-3 text-center text-xs">
          <div className="bg-muted/50 rounded-md p-2">
            <div className="font-semibold text-foreground">{averagePerDay.toFixed(1)}</div>
            <div className="text-muted-foreground">Média/dia</div>
          </div>
          <div className="bg-muted/50 rounded-md p-2">
            <div className="font-semibold text-foreground">
              {format(start, 'dd/MM')} - {format(end, 'dd/MM')}
            </div>
            <div className="text-muted-foreground">Período</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
