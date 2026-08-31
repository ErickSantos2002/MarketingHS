import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Target, Pencil, Check, X, Loader2, CalendarDays } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface LeadGoalGaugeProps {
  currentLeads: number;
  goal: number;
  startDate?: string;
  endDate?: string;
  onUpdateGoal: (goal: number) => Promise<void>;
  onUpdateDates?: (startDate: string, endDate: string) => Promise<void>;
  isSaving?: boolean;
}

export function LeadGoalGauge({ 
  currentLeads, 
  goal, 
  startDate, 
  endDate, 
  onUpdateGoal, 
  onUpdateDates, 
  isSaving 
}: LeadGoalGaugeProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(goal.toString());
  const [isEditingDates, setIsEditingDates] = useState(false);
  const [dateRange, setDateRange] = useState<{ from: Date | undefined; to: Date | undefined }>({
    from: startDate ? parseISO(startDate) : undefined,
    to: endDate ? parseISO(endDate) : undefined,
  });

  const percentage = Math.min((currentLeads / goal) * 100, 100);
  const remaining = Math.max(goal - currentLeads, 0);

  // Data for gauge
  const gaugeData = [
    { name: 'Alcançado', value: percentage },
    { name: 'Restante', value: 100 - percentage },
  ];

  const getColor = () => {
    if (percentage >= 100) return 'hsl(var(--chart-2))';
    if (percentage >= 70) return 'hsl(var(--chart-3))';
    if (percentage >= 40) return 'hsl(var(--chart-4))';
    return 'hsl(var(--chart-5))';
  };

  const handleSave = async () => {
    const newGoal = parseInt(editValue) || goal;
    if (newGoal > 0) {
      await onUpdateGoal(newGoal);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(goal.toString());
    setIsEditing(false);
  };

  const handleSaveDates = async () => {
    if (dateRange.from && dateRange.to && onUpdateDates) {
      await onUpdateDates(
        format(dateRange.from, 'yyyy-MM-dd'),
        format(dateRange.to, 'yyyy-MM-dd')
      );
    }
    setIsEditingDates(false);
  };

  const formatPeriod = () => {
    if (!startDate || !endDate) return 'Sem período';
    try {
      const start = parseISO(startDate);
      const end = parseISO(endDate);
      return `${format(start, 'dd/MM')} - ${format(end, 'dd/MM')}`;
    } catch {
      return 'Sem período';
    }
  };

  return (
    <Card className="bg-gradient-to-br from-card to-card/80 border-primary/10 shadow-lg">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            Meta de Leads
          </CardTitle>
          <div className="flex items-center gap-1">
            {!isEditing && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 opacity-50 hover:opacity-100"
                onClick={() => setIsEditing(true)}
              >
                <Pencil className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
        {/* Period indicator */}
        <div className="flex items-center gap-1 mt-1">
          <Popover open={isEditingDates} onOpenChange={setIsEditingDates}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                <CalendarDays className="h-3 w-3 mr-1" />
                {formatPeriod()}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <div className="p-3 space-y-3">
                <div className="text-sm font-medium">Período da Meta</div>
                <Calendar
                  mode="range"
                  selected={dateRange}
                  onSelect={(range) => setDateRange({ from: range?.from, to: range?.to })}
                  numberOfMonths={1}
                  locale={ptBR}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={handleSaveDates}
                    disabled={!dateRange.from || !dateRange.to || isSaving}
                  >
                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setIsEditingDates(false)}
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {/* Editable Goal */}
        {isEditing && (
          <div className="flex items-center gap-2 mb-4 animate-fade-in">
            <Input
              type="number"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="h-8 text-sm"
              placeholder="Meta..."
              autoFocus
            />
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-chart-2 hover:text-chart-2/80"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-destructive hover:text-destructive/80"
              onClick={handleCancel}
              disabled={isSaving}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Gauge Chart */}
        <div className="relative h-[120px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={gaugeData}
                cx="50%"
                cy="85%"
                startAngle={180}
                endAngle={0}
                innerRadius={50}
                outerRadius={65}
                paddingAngle={0}
                dataKey="value"
                stroke="none"
              >
                <Cell fill={getColor()} />
                <Cell fill="hsl(var(--muted))" />
              </Pie>
            </PieChart>
          </ResponsiveContainer>

          {/* Center Text */}
          <div className="absolute inset-0 flex flex-col items-center justify-end pb-2">
            <span className="text-2xl font-bold" style={{ color: getColor() }}>
              {currentLeads.toLocaleString('pt-BR')}
            </span>
            <span className="text-xs text-muted-foreground">
              de {goal.toLocaleString('pt-BR')} ({percentage.toFixed(0)}%)
            </span>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-2 mt-2 text-center text-xs">
          <div className="bg-muted/50 rounded-md p-2">
            <div className="font-semibold text-foreground">{currentLeads.toLocaleString('pt-BR')}</div>
            <div className="text-muted-foreground">Conquistados</div>
          </div>
          <div className="bg-muted/50 rounded-md p-2">
            <div className="font-semibold text-foreground">{remaining.toLocaleString('pt-BR')}</div>
            <div className="text-muted-foreground">Faltam</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
