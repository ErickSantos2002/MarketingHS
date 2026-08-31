import { AlertTriangle, Clock, Users, TrendingDown } from "lucide-react";
import { Alert } from "@/hooks/useInsightsAnalytics";

interface AlertsSectionProps {
  alerts: Alert[];
}

const alertIcons = {
  abandonment: TrendingDown,
  quality: Users,
  duplicate: Users,
  critical_hour: Clock
};

const severityColors = {
  critical: 'bg-red-500/10 border-red-500/30 text-red-400',
  warning: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
  info: 'bg-blue-500/10 border-blue-500/30 text-blue-400'
};

const severityIconColors = {
  critical: 'text-red-500',
  warning: 'text-amber-500',
  info: 'text-blue-500'
};

export function AlertsSection({ alerts }: AlertsSectionProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg border border-border/50">
        <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
        <div className="text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">Como interpretar os alertas:</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li><strong>Alto Abandono:</strong> Campanha com &gt;50% dos leads não completando o formulário</li>
            <li><strong>Baixa Qualidade:</strong> Campanha trazendo volume mas poucos leads qualificados (ICP)</li>
            <li><strong>Horário Crítico:</strong> Período do dia com abandono acima da média</li>
            <li><strong>Leads Duplicados:</strong> Possível problema de tracking ou remarketing</li>
          </ul>
        </div>
      </div>

      {alerts.length === 0 ? (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4 text-center">
          <div className="flex items-center justify-center gap-2 text-emerald-400">
            <span className="text-lg">✓</span>
            <span className="font-medium">Nenhum alerta crítico no momento</span>
          </div>
        </div>
      ) : (
        <>
          <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Alertas ({alerts.length})
          </h3>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {alerts.map((alert) => {
              const Icon = alertIcons[alert.type];
              return (
                <div
                  key={alert.id}
                  className={`rounded-lg border p-4 ${severityColors[alert.severity]}`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 ${severityIconColors[alert.severity]}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm">{alert.title}</span>
                        <span className="text-lg font-bold">{alert.value}%</span>
                      </div>
                      <p className="text-xs opacity-80 mt-1 truncate" title={alert.description}>
                        {alert.description}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );

}
