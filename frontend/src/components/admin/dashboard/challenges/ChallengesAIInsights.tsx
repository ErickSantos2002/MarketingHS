import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sparkles,
  Loader2,
  Lightbulb,
  Target,
  FileText,
  Gem,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  History,
} from 'lucide-react';
import { api, ErroApi } from '@/lib/api';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Collapsible,
  CollapsibleContent,
} from '@/components/ui/collapsible';
import type { Lead } from '@/hooks/useLeads';

interface ChallengesAIInsightsProps {
  leads: Lead[];
}

interface AIInsights {
  patterns: string[];
  copyRecommendations: string[];
  contentSuggestions: string[];
  gems: Array<{
    response: string;
    reason: string;
  }>;
  opportunities: string[];
}

interface StoredInsight {
  id: string;
  insights: AIInsights;
  leads_analyzed: number;
  created_at: string;
}

export function ChallengesAIInsights({ leads }: ChallengesAIInsightsProps) {
  const [insights, setInsights] = useState<AIInsights | null>(null);
  const [storedInsights, setStoredInsights] = useState<StoredInsight[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [currentInsightId, setCurrentInsightId] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>('patterns');

  const leadsWithChallenges = leads.filter(l => l.desafios && l.desafios.trim().length > 0);

  // Load stored insights on mount
  useEffect(() => {
    loadStoredInsights();
  }, []);

  const loadStoredInsights = async () => {
    setIsLoadingHistory(true);
    try {
      const data = await api.get<StoredInsight[]>('/ia/insights-de-desafios');
      setStoredInsights(data);

      // Load most recent insight if available
      if (data.length > 0) {
        setInsights(data[0].insights);
        setCurrentInsightId(data[0].id);
      }
    } catch (error) {
      console.error('Error loading insights:', error);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const generateInsights = async () => {
    if (leadsWithChallenges.length === 0) {
      toast.error('Nenhum lead com desafio para analisar');
      return;
    }

    setIsLoading(true);
    try {
      // ⚠️ Sem corpo: o servidor busca a amostra de desafios sozinho, pelas
      // mesmas ferramentas do analista.
      const newInsights = await api.post<AIInsights>('/ia/analisar-desafios');

      // Save to database
      const savedData = await api.post<StoredInsight>('/ia/insights-de-desafios', {
        insights: newInsights,
        leads_analyzed: leadsWithChallenges.length,
      });

      setInsights(newInsights);
      setCurrentInsightId(savedData.id);

      // Reload history
      await loadStoredInsights();

      toast.success('Insights gerados e salvos com sucesso!');
    } catch (error) {
      console.error('Error generating insights:', error);
      toast.error('Erro ao gerar insights', {
        description: error instanceof ErroApi ? error.message : 'Tente novamente.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const loadInsight = (stored: StoredInsight) => {
    setInsights(stored.insights);
    setCurrentInsightId(stored.id);
    setShowHistory(false);
  };

  const sections = [
    { id: 'patterns', label: 'Padrões Identificados', icon: Target, color: 'text-blue-500', data: insights?.patterns },
    { id: 'copy', label: 'Sugestões de Copy', icon: FileText, color: 'text-purple-500', data: insights?.copyRecommendations },
    { id: 'content', label: 'Recomendações de Conteúdo', icon: Lightbulb, color: 'text-yellow-500', data: insights?.contentSuggestions },
    { id: 'opportunities', label: 'Oportunidades', icon: Target, color: 'text-green-500', data: insights?.opportunities },
  ];

  if (isLoadingHistory) {
    return (
      <Card className="bg-gradient-to-br from-background to-muted/30 border-border/50">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-gradient-to-br from-background to-muted/30 border-border/50">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <span className="bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
                Insights com IA
              </span>
            </CardTitle>
            {currentInsightId && (
              <Badge variant="outline" className="ml-2">
                {storedInsights.find(s => s.id === currentInsightId)?.leads_analyzed || 0} leads analisados
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {storedInsights.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowHistory(!showHistory)}
              >
                <History className="h-4 w-4 mr-2" />
                Histórico ({storedInsights.length})
                {showHistory ? <ChevronUp className="h-4 w-4 ml-1" /> : <ChevronDown className="h-4 w-4 ml-1" />}
              </Button>
            )}
            <Button
              onClick={generateInsights}
              disabled={isLoading || leadsWithChallenges.length === 0}
              className="gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analisando...
                </>
              ) : insights ? (
                <>
                  <RefreshCw className="h-4 w-4" />
                  Atualizar
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Gerar Insights
                </>
              )}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* History Panel */}
        <Collapsible open={showHistory} onOpenChange={setShowHistory}>
          <CollapsibleContent>
            <div className="border rounded-lg p-4 mb-6 bg-muted/30">
              <h4 className="font-medium mb-3 flex items-center gap-2">
                <History className="h-4 w-4" />
                Histórico de Análises
              </h4>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {storedInsights.map((stored) => (
                  <div
                    key={stored.id}
                    className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                      stored.id === currentInsightId
                        ? 'bg-primary/10 border-primary'
                        : 'bg-background hover:bg-muted/50'
                    }`}
                  >
                    <button
                      onClick={() => loadInsight(stored)}
                      className="flex-1 text-left"
                    >
                      <div className="flex items-center gap-3">
                        <div>
                          <p className="font-medium text-sm">
                            {format(new Date(stored.created_at), "dd 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: ptBR })}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {stored.leads_analyzed} leads analisados
                          </p>
                        </div>
                        {stored.id === currentInsightId && (
                          <Badge variant="secondary" className="text-xs">Atual</Badge>
                        )}
                      </div>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {!insights && !isLoading && (
          <div className="text-center py-8 text-muted-foreground">
            <Sparkles className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-sm">
              Clique em "Gerar Insights" para analisar os desafios dos leads com IA
            </p>
            <p className="text-xs mt-2 opacity-70">
              A IA identificará padrões, sugerirá copies e recomendará conteúdos
            </p>
          </div>
        )}

        {isLoading && (
          <div className="text-center py-8">
            <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              Analisando {leadsWithChallenges.length} respostas...
            </p>
            <p className="text-xs mt-2 text-muted-foreground opacity-70">
              Isso pode levar alguns segundos
            </p>
          </div>
        )}

        {insights && !isLoading && (
          <div className="space-y-4">
            {/* Main sections */}
            {sections.map(section => {
              const Icon = section.icon;
              const isExpanded = expandedSection === section.id;
              const items = section.data || [];

              return (
                <div key={section.id} className="border border-border/50 rounded-lg overflow-hidden">
                  <button
                    onClick={() => setExpandedSection(isExpanded ? null : section.id)}
                    className="w-full flex items-center justify-between p-4 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Icon className={`h-4 w-4 ${section.color}`} />
                      <span className="font-medium">{section.label}</span>
                      <Badge variant="secondary" className="text-xs">
                        {items.length}
                      </Badge>
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>

                  {isExpanded && items.length > 0 && (
                    <div className="p-4 pt-0 space-y-2">
                      {items.map((item, idx) => (
                        <div
                          key={idx}
                          className="flex items-start gap-2 p-3 bg-muted/30 rounded-md"
                        >
                          <span className="text-xs text-muted-foreground font-medium mt-0.5">
                            {idx + 1}.
                          </span>
                          <p className="text-sm text-foreground/90">{item}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Gems section - special highlight */}
            {insights.gems && insights.gems.length > 0 && (
              <div className="border border-amber-500/30 rounded-lg overflow-hidden bg-amber-500/5">
                <button
                  onClick={() => setExpandedSection(expandedSection === 'gems' ? null : 'gems')}
                  className="w-full flex items-center justify-between p-4 hover:bg-amber-500/10 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Gem className="h-4 w-4 text-amber-500" />
                    <span className="font-medium text-amber-500">Respostas Destaque</span>
                    <Badge className="bg-amber-500/20 text-amber-500 border-amber-500/30 text-xs">
                      {insights.gems.length}
                    </Badge>
                  </div>
                  {expandedSection === 'gems' ? (
                    <ChevronUp className="h-4 w-4 text-amber-500" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-amber-500" />
                  )}
                </button>

                {expandedSection === 'gems' && (
                  <ScrollArea className="max-h-[300px]">
                    <div className="p-4 pt-0 space-y-3">
                      {insights.gems.map((gem, idx) => (
                        <div
                          key={idx}
                          className="p-4 bg-amber-500/10 rounded-lg border border-amber-500/20"
                        >
                          <p className="text-sm text-foreground italic mb-2">
                            "{gem.response}"
                          </p>
                          <p className="text-xs text-amber-600 dark:text-amber-400">
                            💎 {gem.reason}
                          </p>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
