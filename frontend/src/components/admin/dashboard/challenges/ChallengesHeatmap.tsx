import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Flame } from 'lucide-react';
import type { Lead } from '@/hooks/useLeads';
import { classifyChallengeThemes } from '@/hooks/useLeadAnalytics';
import { getDecisionPowerLevel } from '@/hooks/useLeadQualification';

interface ChallengesHeatmapProps {
  leads: Lead[];
  type: 'role' | 'revenue';
}

export function ChallengesHeatmap({ leads, type }: ChallengesHeatmapProps) {
  const heatmapData = useMemo(() => {
    const themes = ['IA/Automação', 'Conhecimento', 'Ferramentas', 'Dados', 'Execução', 'Produtividade', 'Estratégia', 'Equipe'];
    
    let categories: string[];
    let getCategoryFn: (lead: Lead) => string;
    
    if (type === 'role') {
      categories = ['C-Level', 'Direção', 'Gerência', 'Especialista', 'Analista', 'Não identificado'];
      getCategoryFn = (lead) => getDecisionPowerLevel(lead.cargo);
    } else {
      categories = ['> R$50M', 'R$10-50M', 'R$5-10M', 'R$1-5M', 'R$500K-1M', '< R$500K', 'Não informado'];
      getCategoryFn = (lead) => {
        const f = lead.faturamento?.toLowerCase() || '';
        if (f.includes('50 milhões') || f.includes('acima')) return '> R$50M';
        if (f.includes('10 milhões')) return 'R$10-50M';
        if (f.includes('5 milhões')) return 'R$5-10M';
        if (f.includes('1 milhão')) return 'R$1-5M';
        if (f.includes('500 mil')) return 'R$500K-1M';
        if (f.includes('100 mil') || f.includes('até')) return '< R$500K';
        return 'Não informado';
      };
    }
    
    // Create matrix
    const matrix: Record<string, Record<string, number>> = {};
    for (const cat of categories) {
      matrix[cat] = {};
      for (const theme of themes) {
        matrix[cat][theme] = 0;
      }
    }
    
    // Fill matrix
    for (const lead of leads) {
      const category = getCategoryFn(lead);
      const leadThemes = classifyChallengeThemes(lead.desafios);
      
      for (const theme of leadThemes) {
        if (matrix[category] && matrix[category][theme] !== undefined) {
          matrix[category][theme]++;
        }
      }
    }
    
    // Calculate max for intensity
    let maxValue = 0;
    for (const cat of categories) {
      for (const theme of themes) {
        maxValue = Math.max(maxValue, matrix[cat][theme]);
      }
    }
    
    return { matrix, categories, themes, maxValue };
  }, [leads, type]);

  const getIntensityColor = (value: number) => {
    if (value === 0) return 'bg-muted/20';
    const intensity = value / heatmapData.maxValue;
    if (intensity > 0.8) return 'bg-primary/90';
    if (intensity > 0.6) return 'bg-primary/70';
    if (intensity > 0.4) return 'bg-primary/50';
    if (intensity > 0.2) return 'bg-primary/30';
    return 'bg-primary/20';
  };

  return (
    <Card className="bg-gradient-to-br from-card via-card to-accent/10 border-border/50 shadow-lg overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <div className="p-2 rounded-lg bg-accent/20">
            <Flame className="h-5 w-5 text-accent" />
          </div>
          Desafios × {type === 'role' ? 'Cargo' : 'Faturamento'}
        </CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <div className="min-w-[600px]">
          {/* Header */}
          <div className="flex mb-2">
            <div className="w-28 shrink-0" />
            {heatmapData.themes.map((theme) => (
              <div 
                key={theme} 
                className="flex-1 text-center text-xs text-muted-foreground px-1 truncate"
                title={theme}
              >
                {theme.replace('/', '/ ')}
              </div>
            ))}
          </div>
          
          {/* Rows */}
          {heatmapData.categories.map((category) => (
            <div key={category} className="flex items-center mb-1 group">
              <div className="w-28 shrink-0 text-xs text-muted-foreground pr-2 truncate" title={category}>
                {category}
              </div>
              {heatmapData.themes.map((theme) => {
                const value = heatmapData.matrix[category][theme];
                return (
                  <div 
                    key={`${category}-${theme}`}
                    className={`flex-1 h-8 mx-0.5 rounded-md flex items-center justify-center text-xs font-medium transition-all duration-200 hover:scale-105 cursor-default ${getIntensityColor(value)}`}
                    title={`${category} + ${theme}: ${value} leads`}
                  >
                    {value > 0 ? value : ''}
                  </div>
                );
              })}
            </div>
          ))}
          
          {/* Legend */}
          <div className="flex items-center justify-center gap-2 mt-4 text-xs text-muted-foreground">
            <span>Menos</span>
            <div className="flex gap-1">
              <div className="w-4 h-4 rounded bg-muted/20" />
              <div className="w-4 h-4 rounded bg-primary/20" />
              <div className="w-4 h-4 rounded bg-primary/40" />
              <div className="w-4 h-4 rounded bg-primary/60" />
              <div className="w-4 h-4 rounded bg-primary/80" />
            </div>
            <span>Mais</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
