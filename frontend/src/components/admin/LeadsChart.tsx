import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Area, AreaChart, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from 'recharts';
import { format, subDays, startOfDay, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { Lead } from '@/hooks/useLeads';

interface LeadsChartProps {
  leads: Lead[];
}

const chartConfig = {
  leads: {
    label: "Leads",
    color: "hsl(25, 95%, 53%)", // Orange color like the reference
  },
};

export function LeadsChart({ leads }: LeadsChartProps) {
  const chartData = useMemo(() => {
    const days = 14;
    
    // Usar timezone de Brasília (-3 horas)
    const now = new Date();
    const brasiliaOffset = -3 * 60; // -3 horas em minutos
    const localOffset = now.getTimezoneOffset();
    const offsetDiff = (localOffset - brasiliaOffset) * 60 * 1000;
    
    // Ajustar para meia-noite em Brasília
    const todayBrasilia = new Date(now.getTime() + offsetDiff);
    todayBrasilia.setHours(0, 0, 0, 0);
    
    // Criar array dos últimos N dias
    const dateArray = Array.from({ length: days }, (_, i) => {
      const date = subDays(todayBrasilia, days - 1 - i);
      return {
        date: format(date, 'yyyy-MM-dd'),
        displayDate: format(date, 'dd/MM', { locale: ptBR }),
        leads: 0,
      };
    });

    // Contar leads ajustando para timezone de Brasília
    leads.forEach(lead => {
      if (!lead.created_at) return;
      
      // Converter UTC para Brasília (subtrair 3 horas)
      const utcDate = parseISO(lead.created_at);
      const brasiliaDate = new Date(utcDate.getTime() - (3 * 60 * 60 * 1000));
      const leadDateStr = format(brasiliaDate, 'yyyy-MM-dd');
      
      const dayEntry = dateArray.find(d => d.date === leadDateStr);
      if (dayEntry) {
        dayEntry.leads += 1;
      }
    });

    return dateArray;
  }, [leads]);

  return (
    <Card className="col-span-full">
      <CardHeader>
        <CardTitle className="text-lg font-medium">Volume de Leads por Dia</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[300px] w-full">
          <AreaChart
            data={chartData}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="fillLeads" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(25, 95%, 53%)" stopOpacity={0.8} />
                <stop offset="95%" stopColor="hsl(25, 95%, 53%)" stopOpacity={0.1} />
              </linearGradient>
            </defs>
            <CartesianGrid 
              strokeDasharray="3 3" 
              vertical={true} 
              stroke="hsl(var(--border))" 
              opacity={0.3}
            />
            <XAxis
              dataKey="displayDate"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              fontSize={12}
              stroke="hsl(var(--muted-foreground))"
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              fontSize={12}
              stroke="hsl(var(--muted-foreground))"
              allowDecimals={false}
            />
            <ChartTooltip
              cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1 }}
              content={<ChartTooltipContent indicator="line" />}
            />
            <Area
              type="monotone"
              dataKey="leads"
              stroke="hsl(25, 95%, 53%)"
              strokeWidth={2}
              fill="url(#fillLeads)"
              name="Leads"
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
