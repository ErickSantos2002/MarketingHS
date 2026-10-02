import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Database, Briefcase, Building, Phone } from 'lucide-react';

interface DataCompletenessGaugesProps {
  data: {
    cargo: number;
    empresa: number;
    whatsapp: number;
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
    if (val >= 70) return 'text-[--on-tint-success]';
    if (val >= 40) return 'text-[--on-tint-warning]';
    return 'text-[--on-tint-danger]';
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-24 h-24">
        <svg className="w-full h-full -rotate-90">
          <circle
            cx="48"
            cy="48"
            r={radius}
            stroke="var(--muted)"
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
    { value: data.cargo, label: 'Cargo', icon: Briefcase, color: 'var(--primary)' },
    { value: data.empresa, label: 'Empresa', icon: Building, color: 'var(--color-info-500)' },
    { value: data.whatsapp, label: 'WhatsApp', icon: Phone, color: 'var(--color-success-500)' },
  ];

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-lg">
            <div className="p-2 rounded-lg bg-[--tint-primary]">
              <Database className="h-5 w-5 text-primary" />
            </div>
            Completude dos Dados
          </div>
          <div className="text-sm font-normal text-muted-foreground">
            Média: <span className={`font-semibold ${data.average >= 70 ? 'text-[--on-tint-success]' : data.average >= 40 ? 'text-[--on-tint-warning]' : 'text-[--on-tint-danger]'}`}>
              {data.average.toFixed(0)}%
            </span>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4 py-4">
          {gauges.map((gauge) => (
            <MiniGauge key={gauge.label} {...gauge} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
