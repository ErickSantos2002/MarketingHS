import { useState } from "react";
import { TemporalCell } from "@/hooks/useInsightsAnalytics";

interface TemporalHeatmapProps {
  matrix: TemporalCell[][];
}

const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function getColorClass(rate: number, total: number): string {
  if (total === 0) return 'bg-muted/30';
  if (rate >= 80) return 'bg-emerald-500';
  if (rate >= 70) return 'bg-emerald-500/80';
  if (rate >= 60) return 'bg-emerald-500/60';
  if (rate >= 50) return 'bg-amber-500/60';
  if (rate >= 40) return 'bg-amber-500/80';
  if (rate >= 30) return 'bg-orange-500/70';
  return 'bg-red-500/70';
}

export function TemporalHeatmap({ matrix }: TemporalHeatmapProps) {
  const [hoveredCell, setHoveredCell] = useState<{ day: number; hour: number } | null>(null);
  const [metricType, setMetricType] = useState<'response' | 'hot'>('response');

  // Generate hour labels (only show some to avoid crowding)
  const hourLabels = [0, 6, 12, 18, 23];

  const getCellData = (cell: TemporalCell) => {
    return metricType === 'response' ? cell.responseRate : cell.hotRate;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">
          Padrões Temporais
        </h3>
        <div className="flex gap-1 bg-muted/30 rounded-lg p-0.5">
          <button
            onClick={() => setMetricType('response')}
            className={`px-2 py-1 text-xs rounded-md transition-colors ${
              metricType === 'response' 
                ? 'bg-primary text-primary-foreground' 
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Resposta
          </button>
          <button
            onClick={() => setMetricType('hot')}
            className={`px-2 py-1 text-xs rounded-md transition-colors ${
              metricType === 'hot' 
                ? 'bg-primary text-primary-foreground' 
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Hot Rate
          </button>
        </div>
      </div>

      {/* Guia de interpretação */}
      <div className="p-3 bg-muted/30 rounded-lg border border-border/50 text-xs text-muted-foreground">
        <p className="font-medium text-foreground mb-2">Como usar este heatmap:</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <p className="font-medium text-foreground/80">Interpretação das cores:</p>
            <ul className="list-disc list-inside mt-1 space-y-0.5">
              <li><span className="text-emerald-400">Verde</span> = Alta taxa neste horário (bom!)</li>
              <li><span className="text-amber-400">Amarelo</span> = Taxa moderada</li>
              <li><span className="text-red-400">Vermelho</span> = Baixa taxa (leads abandonam)</li>
              <li><span className="text-muted-foreground">Cinza</span> = Poucos dados para análise</li>
            </ul>
          </div>
          <div>
            <p className="font-medium text-foreground/80">Ações sugeridas:</p>
            <ul className="list-disc list-inside mt-1 space-y-0.5">
              <li>Concentre anúncios nos horários verdes</li>
              <li>Evite impulsionar em horários vermelhos</li>
              <li>Passe o mouse sobre uma célula para detalhes</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border/50 p-4 overflow-x-auto">
        {/* Hour labels */}
        <div className="flex mb-1">
          <div className="w-10 shrink-0" />
          <div className="flex-1 flex">
            {Array.from({ length: 24 }, (_, i) => (
              <div 
                key={i} 
                className="flex-1 min-w-[16px] text-center"
              >
                {hourLabels.includes(i) && (
                  <span className="text-[10px] text-muted-foreground">{i}h</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Heatmap grid */}
        <div className="space-y-0.5">
          {matrix.map((day, dayIndex) => (
            <div key={dayIndex} className="flex items-center gap-1">
              <div className="w-10 shrink-0 text-xs text-muted-foreground">
                {dayNames[dayIndex]}
              </div>
              <div className="flex-1 flex gap-0.5">
                {day.map((cell, hourIndex) => {
                  const rate = getCellData(cell);
                  const isHovered = hoveredCell?.day === dayIndex && hoveredCell?.hour === hourIndex;
                  
                  return (
                    <div
                      key={hourIndex}
                      className={`flex-1 min-w-[16px] h-6 rounded-sm cursor-pointer transition-all ${getColorClass(rate, cell.totalLeads)} ${
                        isHovered ? 'ring-2 ring-primary ring-offset-1 ring-offset-background scale-110 z-10' : ''
                      }`}
                      onMouseEnter={() => setHoveredCell({ day: dayIndex, hour: hourIndex })}
                      onMouseLeave={() => setHoveredCell(null)}
                      title={`${dayNames[dayIndex]} ${hourIndex}h: ${cell.totalLeads} leads, ${rate.toFixed(0)}% ${metricType === 'response' ? 'resposta' : 'hot'}`}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="mt-4 flex items-center justify-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-red-500/70" />
            <span className="text-xs text-muted-foreground">Baixo</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-amber-500/70" />
            <span className="text-xs text-muted-foreground">Médio</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-emerald-500" />
            <span className="text-xs text-muted-foreground">Alto</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-muted/30" />
            <span className="text-xs text-muted-foreground">Sem dados</span>
          </div>
        </div>

        {/* Tooltip */}
        {hoveredCell && (
          <div className="mt-3 p-3 bg-muted/50 rounded-lg text-sm">
            <div className="font-medium">
              {dayNames[hoveredCell.day]} às {hoveredCell.hour}:00
            </div>
            <div className="text-muted-foreground mt-1 space-y-0.5">
              <div>Total: {matrix[hoveredCell.day][hoveredCell.hour].totalLeads} leads</div>
              <div>Resposta: {matrix[hoveredCell.day][hoveredCell.hour].responseRate.toFixed(1)}%</div>
              <div>Hot Rate: {matrix[hoveredCell.day][hoveredCell.hour].hotRate.toFixed(1)}%</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
