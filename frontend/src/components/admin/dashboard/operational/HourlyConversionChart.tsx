import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, ComposedChart } from 'recharts';
import { Clock, TrendingUp, TrendingDown, Zap } from 'lucide-react';
import { useMemo } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { Lead } from '@/hooks/useLeads';
import type { EnrichedLead } from '@/hooks/useLeadQualification';

interface HourlyConversionChartProps {
  leads: (Lead | EnrichedLead)[];
}

export function HourlyConversionChart({ leads }: HourlyConversionChartProps) {
  // Calculate date range from leads
  const dateRange = useMemo(() => {
    if (leads.length === 0) return null;
    
    const dates = leads
      .map(l => new Date(l.created_at || 0))
      .filter(d => !isNaN(d.getTime()));
    
    if (dates.length === 0) return null;
    
    const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
    const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));
    
    return { from: minDate, to: maxDate };
  }, [leads]);

  const { hourlyData, bestHour, worstHour, peakHour } = useMemo(() => {
    const hourMap = new Map<number, { total: number; hot: number }>();

    // Initialize all hours
    for (let h = 0; h < 24; h++) {
      hourMap.set(h, { total: 0, hot: 0 });
    }

    leads.forEach((lead) => {
      if (!lead.created_at) return;
      const hour = new Date(lead.created_at).getHours();
      const current = hourMap.get(hour) || { total: 0, hot: 0 };
      current.total += 1;
      
      // Check if lead is "hot" (enriched lead with qualification)
      const isHot = 'qualification' in lead && lead.qualification === 'hot';
      if (isHot) {
        current.hot += 1;
      }
      hourMap.set(hour, current);
    });

    const data = Array.from(hourMap.entries())
      .map(([hour, stats]) => ({
        hour,
        hourLabel: `${hour.toString().padStart(2, '0')}h`,
        total: stats.total,
        hot: stats.hot,
        hotRate: stats.total > 0 ? Math.round((stats.hot / stats.total) * 100) : 0,
      }))
      .sort((a, b) => a.hour - b.hour);

    // Find best hour (highest hot rate with minimum threshold)
    const significantHours = data.filter(d => d.total >= 3);
    const best = significantHours.length > 0
      ? significantHours.reduce((a, b) => a.hotRate > b.hotRate ? a : b)
      : null;

    // Find worst hour (lowest hot rate with minimum threshold)
    const worst = significantHours.length > 0
      ? significantHours.reduce((a, b) => a.hotRate < b.hotRate ? a : b)
      : null;

    // Find peak hour (highest volume)
    const peak = data.reduce((a, b) => a.total > b.total ? a : b);

    return { hourlyData: data, bestHour: best, worstHour: worst, peakHour: peak };
  }, [leads]);


  return (
    <Card className="bg-gradient-to-br from-card via-card to-primary/10 border-border/50 shadow-lg">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <div className="p-2 rounded-lg bg-primary/20">
            <Clock className="h-5 w-5 text-primary" />
          </div>
          <span>Análise por Horário</span>
          {dateRange && (
            <span className="text-xs font-normal text-muted-foreground">
              ({format(dateRange.from, 'dd/MM', { locale: ptBR })} - {format(dateRange.to, 'dd/MM', { locale: ptBR })})
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* KPI Cards */}
        <div className="grid grid-cols-3 gap-3">
          {bestHour && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <div className="flex items-center gap-2 text-emerald-400 mb-1">
                <TrendingUp className="h-4 w-4" />
                <span className="text-xs font-medium">Melhor Horário</span>
              </div>
              <p className="text-lg font-bold text-foreground">{bestHour.hourLabel}</p>
              <p className="text-xs text-muted-foreground">{bestHour.hotRate}% hot rate</p>
            </div>
          )}
          {worstHour && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
              <div className="flex items-center gap-2 text-red-400 mb-1">
                <TrendingDown className="h-4 w-4" />
                <span className="text-xs font-medium">Pior Horário</span>
              </div>
              <p className="text-lg font-bold text-foreground">{worstHour.hourLabel}</p>
              <p className="text-xs text-muted-foreground">{worstHour.hotRate}% hot rate</p>
            </div>
          )}
          {peakHour && (
            <div className="p-3 rounded-xl bg-primary/10 border border-primary/20">
              <div className="flex items-center gap-2 text-primary mb-1">
                <Zap className="h-4 w-4" />
                <span className="text-xs font-medium">Horário de Pico</span>
              </div>
              <p className="text-lg font-bold text-foreground">{peakHour.hourLabel}</p>
              <p className="text-xs text-muted-foreground">{peakHour.total} leads</p>
            </div>
          )}
        </div>

        {/* Chart */}
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={hourlyData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis
                dataKey="hourLabel"
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                axisLine={{ stroke: 'hsl(var(--border))' }}
                tickLine={false}
                interval={2}
              />
              <YAxis
                yAxisId="left"
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                axisLine={{ stroke: 'hsl(var(--border))' }}
                tickLine={false}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                axisLine={{ stroke: 'hsl(var(--border))' }}
                tickLine={false}
                domain={[0, 100]}
                tickFormatter={(value) => `${value}%`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                }}
                labelStyle={{ color: 'hsl(var(--foreground))' }}
                itemStyle={{ color: 'hsl(var(--foreground))' }}
                formatter={(value: number, name: string) => {
                  if (name === 'hotRate') return [`${value}%`, 'Taxa Hot'];
                  if (name === 'total') return [value, 'Total Leads'];
                  return [value, name];
                }}
              />
              <Bar
                yAxisId="left"
                dataKey="total"
                radius={[4, 4, 0, 0]}
                maxBarSize={20}
                fill="rgba(222, 26, 17, 0.4)"
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="hotRate"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={{ fill: 'hsl(var(--primary))', strokeWidth: 0, r: 3 }}
                activeDot={{ r: 5 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: 'rgba(222, 26, 17, 0.6)' }} />
            <span>Volume de Leads</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-primary" />
            <span>Taxa Hot</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
