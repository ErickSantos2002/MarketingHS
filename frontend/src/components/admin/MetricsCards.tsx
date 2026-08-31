import { useMemo } from 'react';
import { parseISO } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, Calendar, TrendingUp, Target } from 'lucide-react';
import type { Lead } from '@/hooks/useLeads';

interface MetricsCardsProps {
  leads: Lead[];
}

export function MetricsCards({ leads }: MetricsCardsProps) {
  const metrics = useMemo(() => {
    // Usar timezone de Brasília (-3 horas)
    const now = new Date();
    const brasiliaOffset = -3 * 60; // -3 horas em minutos
    const localOffset = now.getTimezoneOffset();
    const offsetDiff = (localOffset - brasiliaOffset) * 60 * 1000;
    
    // Ajustar para meia-noite em Brasília
    const todayBrasilia = new Date(now.getTime() + offsetDiff);
    todayBrasilia.setHours(0, 0, 0, 0);
    
    const weekAgoBrasilia = new Date(todayBrasilia.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Converter cada lead para timezone de Brasília antes de comparar
    const leadsToday = leads.filter(l => {
      if (!l.created_at) return false;
      const utcDate = parseISO(l.created_at);
      const brasiliaDate = new Date(utcDate.getTime() - (3 * 60 * 60 * 1000));
      return brasiliaDate >= todayBrasilia;
    }).length;

    const leadsThisWeek = leads.filter(l => {
      if (!l.created_at) return false;
      const utcDate = parseISO(l.created_at);
      const brasiliaDate = new Date(utcDate.getTime() - (3 * 60 * 60 * 1000));
      return brasiliaDate >= weekAgoBrasilia;
    }).length;
    
    const paidLeads = leads.filter(l => l.tipo === 'pago').length;
    const freeLeads = leads.filter(l => l.tipo === 'gratuito' || l.tipo === 'modal').length;
    
    const conversionRate = leads.length > 0 
      ? ((paidLeads / leads.length) * 100).toFixed(1) 
      : '0';

    return {
      total: leads.length,
      today: leadsToday,
      week: leadsThisWeek,
      paid: paidLeads,
      free: freeLeads,
      conversionRate
    };
  }, [leads]);

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total de Leads</CardTitle>
          <Users className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{metrics.total}</div>
          <p className="text-xs text-muted-foreground">
            {metrics.paid} pagos · {metrics.free} gratuitos
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Leads Hoje</CardTitle>
          <Calendar className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{metrics.today}</div>
          <p className="text-xs text-muted-foreground">
            Nas últimas 24 horas
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Leads na Semana</CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{metrics.week}</div>
          <p className="text-xs text-muted-foreground">
            Últimos 7 dias
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Taxa de Conversão</CardTitle>
          <Target className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{metrics.conversionRate}%</div>
          <p className="text-xs text-muted-foreground">
            Leads pagos vs total
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
