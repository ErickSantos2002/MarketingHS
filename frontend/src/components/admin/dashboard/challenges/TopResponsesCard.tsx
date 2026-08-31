import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Award, User, Building2, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import type { TopResponse } from '@/hooks/useLeadAnalytics';

interface TopResponsesCardProps {
  topResponses: TopResponse[];
}

export function TopResponsesCard({ topResponses }: TopResponsesCardProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  
  const displayedResponses = showAll ? topResponses : topResponses.slice(0, 5);

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'bg-green-500/10 text-green-500 border-green-500/20';
    if (score >= 60) return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
    return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
  };

  const getThemeColor = (theme: string) => {
    const colors: Record<string, string> = {
      'IA/Automação': 'bg-purple-500/10 text-purple-400 border-purple-500/20',
      'Conhecimento': 'bg-blue-500/10 text-blue-400 border-blue-500/20',
      'Ferramentas': 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
      'Dados': 'bg-green-500/10 text-green-400 border-green-500/20',
      'Execução': 'bg-orange-500/10 text-orange-400 border-orange-500/20',
      'Produtividade': 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
      'Estratégia': 'bg-red-500/10 text-red-400 border-red-500/20',
      'Equipe': 'bg-pink-500/10 text-pink-400 border-pink-500/20',
    };
    return colors[theme] || 'bg-muted text-muted-foreground border-border';
  };

  return (
    <Card className="bg-gradient-to-br from-background to-muted/30 border-border/50">
      <CardHeader>
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <Award className="h-5 w-5 text-amber-500" />
          <span className="bg-gradient-to-r from-amber-500 to-yellow-400 bg-clip-text text-transparent">
            Top Respostas de Alta Qualidade
          </span>
          <Badge variant="secondary" className="ml-2">
            {topResponses.length} respostas
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-4">
            {displayedResponses.map((item, index) => {
              const isExpanded = expanded === item.lead.id;
              const desafios = item.lead.desafios || '';
              const shouldTruncate = desafios.length > 200;
              
              return (
                <div
                  key={item.lead.id}
                  className="group relative bg-muted/30 rounded-lg p-4 border border-border/50 hover:border-primary/30 transition-all duration-300"
                >
                  {/* Rank badge */}
                  <div className="absolute -top-2 -left-2 w-6 h-6 rounded-full bg-gradient-to-r from-amber-500 to-yellow-400 flex items-center justify-center text-xs font-bold text-white shadow-lg">
                    {index + 1}
                  </div>
                  
                  {/* Header */}
                  <div className="flex items-start justify-between mb-3 ml-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <User className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="font-medium text-sm">
                          {item.lead.nome || 'Sem nome'}
                        </span>
                        {item.lead.cargo && (
                          <span className="text-xs text-muted-foreground">
                            • {item.lead.cargo}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                        {item.lead.empresa && (
                          <>
                            <Building2 className="h-3 w-3" />
                            <span>{item.lead.empresa}</span>
                          </>
                        )}
                        {item.lead.faturamento && (
                          <span className="text-emerald-500/80">
                            • {item.lead.faturamento}
                          </span>
                        )}
                      </div>
                    </div>
                    
                    {/* Score */}
                    <Badge 
                      variant="outline" 
                      className={`${getScoreColor(item.score)} font-bold`}
                    >
                      <Sparkles className="h-3 w-3 mr-1" />
                      {item.score}
                    </Badge>
                  </div>
                  
                  {/* Themes */}
                  <div className="flex flex-wrap gap-1.5 mb-3 ml-4">
                    {item.themes.filter(t => t !== 'Outros').map((theme) => (
                      <Badge
                        key={theme}
                        variant="outline"
                        className={`text-xs ${getThemeColor(theme)}`}
                      >
                        {theme}
                      </Badge>
                    ))}
                    <Badge variant="outline" className="text-xs bg-muted/50">
                      {item.length} chars
                    </Badge>
                  </div>
                  
                  {/* Response text */}
                  <div className="ml-4 bg-background/50 rounded-md p-3 text-sm text-foreground/90 leading-relaxed">
                    {isExpanded || !shouldTruncate ? (
                      desafios
                    ) : (
                      <>
                        {desafios.slice(0, 200)}...
                      </>
                    )}
                    
                    {shouldTruncate && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-2 h-6 px-2 text-xs text-primary hover:text-primary/80"
                        onClick={() => setExpanded(isExpanded ? null : item.lead.id)}
                      >
                        {isExpanded ? (
                          <>
                            <ChevronUp className="h-3 w-3 mr-1" />
                            Ver menos
                          </>
                        ) : (
                          <>
                            <ChevronDown className="h-3 w-3 mr-1" />
                            Ver mais
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
        
        {topResponses.length > 5 && (
          <div className="mt-4 pt-4 border-t border-border/50 text-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAll(!showAll)}
              className="gap-2"
            >
              {showAll ? (
                <>
                  <ChevronUp className="h-4 w-4" />
                  Mostrar menos
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4" />
                  Ver todas as {topResponses.length} respostas
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
