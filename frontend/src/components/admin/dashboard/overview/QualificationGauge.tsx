import { Gauge } from 'lucide-react';

interface QualificationGaugeProps {
  rate: number;
}

export function QualificationGauge({ rate }: QualificationGaugeProps) {
  // Clamp rate between 0 and 100
  const clampedRate = Math.min(100, Math.max(0, rate));
  
  // Calculate the arc path for the gauge
  const angle = (clampedRate / 100) * 180;
  
  // Determine color based on rate
  const getColor = () => {
    if (clampedRate >= 70) return 'hsl(142, 76%, 36%)'; // Green
    if (clampedRate >= 40) return 'hsl(47, 100%, 50%)'; // Yellow
    return 'hsl(0, 84%, 60%)'; // Red
  };

  const getLabel = () => {
    if (clampedRate >= 70) return 'Excelente';
    if (clampedRate >= 40) return 'Bom';
    return 'Baixo';
  };

  return (
    <div className="glass-card p-6">
      <div className="flex items-center gap-2 mb-6">
        <Gauge className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-semibold text-foreground">Taxa de Qualificação</h3>
      </div>

      <div className="flex flex-col items-center justify-center py-4">
        {/* Gauge SVG */}
        <div className="relative w-48 h-28">
          <svg viewBox="0 0 200 110" className="w-full h-full">
            {/* Background arc */}
            <path
              d="M 20 100 A 80 80 0 0 1 180 100"
              fill="none"
              stroke="hsl(0, 0%, 20%)"
              strokeWidth="16"
              strokeLinecap="round"
            />
            
            {/* Colored arc */}
            <path
              d="M 20 100 A 80 80 0 0 1 180 100"
              fill="none"
              stroke={getColor()}
              strokeWidth="16"
              strokeLinecap="round"
              strokeDasharray={`${(clampedRate / 100) * 251.2} 251.2`}
              style={{
                filter: `drop-shadow(0 0 10px ${getColor()})`,
                transition: 'stroke-dasharray 0.5s ease-out',
              }}
            />
            
            {/* Pointer */}
            <g
              transform={`rotate(${angle - 90}, 100, 100)`}
              style={{ transition: 'transform 0.5s ease-out' }}
            >
              <line
                x1="100"
                y1="100"
                x2="100"
                y2="40"
                stroke="hsl(0, 0%, 100%)"
                strokeWidth="3"
                strokeLinecap="round"
              />
              <circle cx="100" cy="100" r="8" fill="hsl(0, 0%, 100%)" />
            </g>
          </svg>
          
          {/* Center value */}
          <div className="absolute inset-0 flex flex-col items-center justify-end pb-2">
            <span
              className="text-3xl font-bold"
              style={{ color: getColor() }}
            >
              {clampedRate.toFixed(1)}%
            </span>
          </div>
        </div>

        {/* Label */}
        <div className="mt-4 text-center">
          <span
            className="px-3 py-1 rounded-full text-sm font-medium"
            style={{
              backgroundColor: `${getColor()}20`,
              color: getColor(),
            }}
          >
            {getLabel()}
          </span>
          <p className="text-sm text-muted-foreground mt-2">
            Hot Leads + Warm Leads
          </p>
        </div>
      </div>
    </div>
  );
}
