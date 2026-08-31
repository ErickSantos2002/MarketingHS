import { useState, useMemo } from 'react';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart, BarChart, Bar, Line, ComposedChart } from 'recharts';
import { TrendingUp, Clock, Flame, Users, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { Lead } from '@/hooks/useLeads';
import { getQualificationSegment } from '@/hooks/useLeadQualification';

interface LeadsLineChartProps {
  data: { date: string; dateFormatted: string; count: number }[];
  conversionData?: { date: string; dateFormatted: string; count: number }[];
  allConversionData?: { date: string; dateFormatted: string; count: number }[];
  filteredLeads?: Lead[];
  allLeads?: Lead[];
  showHotMetrics: boolean;
  onShowHotMetricsChange: (value: boolean) => void;
  isSingleDayFilter?: boolean;
  filterDateLabel?: string;
}

type DataMode = 'leads' | 'conversions';

export function LeadsLineChart({ data, conversionData = [], allConversionData = [], filteredLeads = [], allLeads = [], showHotMetrics, onShowHotMetricsChange, isSingleDayFilter = false, filterDateLabel = '' }: LeadsLineChartProps) {
  const [viewMode, setViewMode] = useState<'daily' | 'hourly'>('daily');
  const [dataMode, setDataMode] = useState<DataMode>('conversions');

  // Use conversion data or leads data based on mode
  // For conversions, use allConversionData (unfiltered) if available
  const chartData = dataMode === 'conversions' 
    ? (allConversionData.length > 0 ? allConversionData : conversionData) 
    : data;

  // Use allLeads for conversion calculations to include reconversions
  const leadsForConversions = dataMode === 'conversions' && allLeads.length > 0 ? allLeads : filteredLeads;

  // Calculate date range from filtered leads
  const dateRange = useMemo(() => {
    const leadsToUse = dataMode === 'conversions' ? leadsForConversions : filteredLeads;
    if (leadsToUse.length === 0) return null;
    
    const dateField = dataMode === 'conversions' ? 'last_conversion_date' : 'created_at';
    const dates = leadsToUse
      .map(l => new Date((l as any)[dateField] || l.created_at || 0))
      .filter(d => !isNaN(d.getTime()));
    
    if (dates.length === 0) return null;
    
    const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
    const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));
    
    return { from: minDate, to: maxDate };
  }, [filteredLeads, leadsForConversions, dataMode]);

  // Calculate daily data with hot lead metrics
  const dailyHotData = useMemo(() => {
    const dayMap = new Map<string, { total: number; hot: number }>();
    const dateField = dataMode === 'conversions' ? 'last_conversion_date' : 'created_at';
    const leadsToUse = dataMode === 'conversions' ? leadsForConversions : filteredLeads;
    
    leadsToUse.forEach(lead => {
      const leadDate = (lead as any)[dateField] || lead.created_at;
      if (!leadDate) return;
      const date = format(new Date(leadDate), 'yyyy-MM-dd');
      const current = dayMap.get(date) || { total: 0, hot: 0 };
      current.total++;
      if (getQualificationSegment(lead) === 'hot') {
        current.hot++;
      }
      dayMap.set(date, current);
    });
    
    return chartData.map(d => {
      const stats = dayMap.get(d.date) || { total: 0, hot: 0 };
      return {
        ...d,
        hotCount: stats.hot,
        hotRate: stats.total > 0 ? Math.round((stats.hot / stats.total) * 100) : 0,
      };
    });
  }, [chartData, filteredLeads, leadsForConversions, dataMode]);

  const hourlyData = useMemo(() => {
    const hourMap = new Map<number, number>();
    for (let h = 0; h < 24; h++) hourMap.set(h, 0);
    const dateField = dataMode === 'conversions' ? 'last_conversion_date' : 'created_at';
    // For hourly view, always use filteredLeads (already date-filtered) so single-day shows only that day's data
    const leadsToUse = filteredLeads;

    leadsToUse.forEach(lead => {
      const leadDate = (lead as any)[dateField] || lead.created_at;
      if (!leadDate) return;
      const hour = new Date(leadDate).getHours();
      hourMap.set(hour, (hourMap.get(hour) || 0) + 1);
    });

    let cumulative = 0;
    return Array.from(hourMap.entries()).map(([hour, count]) => {
      cumulative += count;
      return {
        hour,
        hourLabel: `${hour.toString().padStart(2, '0')}h`,
        count,
        cumulative,
      };
    });
  }, [filteredLeads, leadsForConversions, dataMode]);

  const hasNoData = viewMode === 'daily' 
    ? chartData.length === 0 
    : (dataMode === 'conversions' ? leadsForConversions.length === 0 : filteredLeads.length === 0);
  const emptyMessage = viewMode === 'daily' ? 'Nenhum dado disponível' : 'Nenhum dado no período';

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          {viewMode === 'daily' ? (
            <TrendingUp className="h-5 w-5 text-primary" />
          ) : (
            <Clock className="h-5 w-5 text-primary" />
          )}
          <h3 className="text-lg font-semibold text-foreground">
            {viewMode === 'daily' 
              ? (dataMode === 'conversions' ? 'Agendamentos por Dia' : 'Leads Novos por Dia')
              : 'Agendamentos por Hora'}
            {viewMode === 'hourly' && isSingleDayFilter && filterDateLabel && (
              <span className="text-xs font-normal text-muted-foreground ml-2">
                ({filterDateLabel})
              </span>
            )}
            {viewMode === 'hourly' && !isSingleDayFilter && dateRange && (
              <span className="text-xs font-normal text-muted-foreground ml-2">
                ({format(dateRange.from, 'dd/MM', { locale: ptBR })} - {format(dateRange.to, 'dd/MM', { locale: ptBR })})
              </span>
            )}
          </h3>
        </div>

        {/* Toggle Buttons */}
        <div className="flex gap-2">
          {viewMode === 'daily' && (
            <>
              {/* Data Mode Toggle */}
              <div className="flex rounded-lg border border-border/50 bg-background/50 p-1">
                <button
                  onClick={() => setDataMode('conversions')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1.5 ${
                    dataMode === 'conversions'
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  title="Reuniões marcadas por dia"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Agendamentos
                </button>
                <button
                  onClick={() => setDataMode('leads')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1.5 ${
                    dataMode === 'leads'
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  title="Conta por data de criação (apenas leads novos)"
                >
                  <Users className="h-3.5 w-3.5" />
                  Novos
                </button>
              </div>
            </>
          )}
          <div className="flex rounded-lg border border-border/50 bg-background/50 p-1">
            <button
              onClick={() => setViewMode('daily')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                viewMode === 'daily'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Por Dia
            </button>
            <button
              onClick={() => setViewMode('hourly')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                viewMode === 'hourly'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Por Horário
            </button>
          </div>
        </div>
      </div>

      {hasNoData ? (
        <div className="h-[300px] flex items-center justify-center text-muted-foreground">
          {emptyMessage}
        </div>
      ) : (
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            {viewMode === 'daily' ? (
              showHotMetrics ? (
                <ComposedChart data={dailyHotData} margin={{ top: 10, right: 40, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorLeadsComposed" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--accent))" stopOpacity={0.4} />
                      <stop offset="50%" stopColor="hsl(var(--primary))" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="lineGradientComposed" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="hsl(var(--accent))" />
                      <stop offset="100%" stopColor="hsl(var(--primary))" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="dateFormatted"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    yAxisId="left"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => value.toLocaleString()}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    domain={[0, 100]}
                    stroke="#10b981"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      boxShadow: '0 10px 40px -10px rgba(222, 26, 17, 0.3)',
                    }}
                    labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}
                    formatter={(value: number, name: string) => {
                      if (name === 'hotRate') return [`${value}%`, 'Taxa Hot'];
                      if (name === 'hotCount') return [value.toLocaleString('pt-BR'), 'Hot Leads'];
                      return [value.toLocaleString('pt-BR'), dataMode === 'conversions' ? 'Conversões' : 'Leads'];
                    }}
                  />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="count"
                    stroke="url(#lineGradientComposed)"
                    strokeWidth={3}
                    fill="url(#colorLeadsComposed)"
                    dot={false}
                    activeDot={{
                      r: 6,
                      fill: 'hsl(var(--accent))',
                      stroke: 'hsl(var(--background))',
                      strokeWidth: 2,
                    }}
                  />
                  <Bar
                    yAxisId="left"
                    dataKey="hotCount"
                    fill="rgba(16, 185, 129, 0.4)"
                    radius={[4, 4, 0, 0]}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="hotRate"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={{ fill: '#10b981', r: 3 }}
                    activeDot={{ r: 5, fill: '#10b981', stroke: 'hsl(var(--background))', strokeWidth: 2 }}
                  />
                </ComposedChart>
              ) : (
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorLeads" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--accent))" stopOpacity={0.4} />
                      <stop offset="50%" stopColor="hsl(var(--primary))" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="lineGradient" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="hsl(var(--accent))" />
                      <stop offset="100%" stopColor="hsl(var(--primary))" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="dateFormatted"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => value.toLocaleString()}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      boxShadow: '0 10px 40px -10px rgba(222, 26, 17, 0.3)',
                    }}
                    labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}
                    itemStyle={{ color: 'hsl(var(--accent))' }}
                    formatter={(value: number) => [value.toLocaleString('pt-BR'), dataMode === 'conversions' ? 'Conversões' : 'Leads']}
                  />
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke="url(#lineGradient)"
                    strokeWidth={3}
                    fill="url(#colorLeads)"
                    dot={false}
                    activeDot={{
                      r: 6,
                      fill: 'hsl(var(--accent))',
                      stroke: 'hsl(var(--background))',
                      strokeWidth: 2,
                    }}
                  />
                </AreaChart>
              )
            ) : isSingleDayFilter ? (
                <ComposedChart data={hourlyData} margin={{ top: 10, right: 40, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="barGradientComposed" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={1} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.8} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="hourLabel"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    interval={1}
                  />
                  <YAxis
                    yAxisId="left"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    stroke="#8b5cf6"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      boxShadow: '0 10px 40px -10px rgba(222, 26, 17, 0.3)',
                    }}
                    labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}
                    formatter={(value: number, name: string) => {
                      if (name === 'cumulative') return [value.toLocaleString('pt-BR'), 'Acumulado'];
                      return [value.toLocaleString('pt-BR'), 'Volume/Hora'];
                    }}
                  />
                  <Bar
                    yAxisId="left"
                    dataKey="count"
                    fill="url(#barGradientComposed)"
                    radius={[4, 4, 0, 0]}
                    name="count"
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="cumulative"
                    stroke="#8b5cf6"
                    strokeWidth={2.5}
                    dot={{ fill: '#8b5cf6', r: 3 }}
                    activeDot={{ r: 5, fill: '#8b5cf6', stroke: 'hsl(var(--background))', strokeWidth: 2 }}
                    name="cumulative"
                  />
                </ComposedChart>
              ) : (
                <BarChart data={hourlyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={1} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.8} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="hourLabel"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    interval={1}
                  />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      boxShadow: '0 10px 40px -10px rgba(222, 26, 17, 0.3)',
                    }}
                    labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}
                    itemStyle={{ color: 'hsl(var(--accent))' }}
                    formatter={(value: number) => [value.toLocaleString('pt-BR'), 'Conversões']}
                  />
                  <Bar
                    dataKey="count"
                    fill="url(#barGradient)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              )}

          </ResponsiveContainer>
          {/* Legend for cumulative line */}
          {viewMode === 'hourly' && isSingleDayFilter && (
            <div className="flex items-center justify-center gap-6 mt-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm" style={{ background: 'linear-gradient(to bottom, hsl(var(--accent)), hsl(var(--primary)))' }} />
                <span>Volume/Hora</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-1.5 rounded-full bg-[#8b5cf6]" />
                <span>Acumulado</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
