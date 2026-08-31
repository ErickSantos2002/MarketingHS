import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Database, Briefcase, Building, DollarSign, MessageSquare } from 'lucide-react';

interface DataCompletenessGaugesProps {
  data: {
    cargo: number;
    empresa: number;
    faturamento: number;
    desafios: number;
    average: number;
  };
}

function MiniGauge({ 
  value, 
  label, 
  icon: Icon,
  color 
}: { 
  value: number; 
  label: string; 
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}) {
  const radius = 35;
  const circumference = 2 * Math.PI * radius;
  const progress = (value / 100) * circumference;
  const offset = circumference - progress;

  const getColorClass = (val: number) => {
    if (val >= 70) return 'text-emerald-400';
    if (val >= 40) return 'text-yellow-400';
    return 'text-red-400';
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-24 h-24">
        <svg className="w-full h-full -rotate-90">
          <circle
            cx="48"
            cy="48"
            r={radius}
            stroke="hsl(var(--muted))"
            strokeWidth="8"
            fill="none"
            className="opacity-30"
          />
          <circle
            cx="48"
            cy="48"
            r={radius}
            stroke={color}
            strokeWidth="8"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`text-lg font-bold ${getColorClass(value)}`}>
            {value.toFixed(0)}%
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span>{label}</span>
      </div>
    </div>
  );
}

export function DataCompletenessGauges({ data }: DataCompletenessGaugesProps) {
  const gauges = [
    { value: data.cargo, label: 'Cargo', icon: Briefcase, color: 'hsl(var(--primary))' },
    { value: data.empresa, label: 'Empresa', icon: Building, color: 'hsl(var(--accent))' },
    { value: data.faturamento, label: 'Faturamento', icon: DollarSign, color: '#10B981' },
    { value: data.desafios, label: 'Desafios', icon: MessageSquare, color: 'hsl(var(--primary))' },
  ];

  return (
    <Card className="bg-gradient-to-br from-card via-card to-primary/10 border-border/50 shadow-lg overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-lg">
            <div className="p-2 rounded-lg bg-primary/20">
              <Database className="h-5 w-5 text-primary" />
            </div>
            Completude dos Dados
          </div>
          <div className="text-sm font-normal text-muted-foreground">
            Média: <span className={`font-semibold ${data.average >= 70 ? 'text-emerald-400' : data.average >= 40 ? 'text-yellow-400' : 'text-red-400'}`}>
              {data.average.toFixed(0)}%
            </span>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-4">
          {gauges.map((gauge) => (
            <MiniGauge key={gauge.label} {...gauge} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
