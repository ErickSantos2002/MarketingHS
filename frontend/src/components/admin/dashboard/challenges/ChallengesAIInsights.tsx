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
  Trash2,
} from 'lucide-react';
import { api, ErroApi } from '@/lib/api';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Collapsible,
  CollapsibleContent,
} from '@/components/ui/collapsible';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
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
  // Tamanho real da amostra que o SERVIDOR analisou (até 50 — ver
  // `desafios_frequentes` no backend), nunca o `leads.length` do navegador.
  // A rota sempre preenche este campo.
  sampleSize: number;
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
      // ⚠️ `leads_analyzed` vem de `newInsights.sampleSize` — o tamanho real
      // da amostra que o servidor analisou —, nunca de
      // `leadsWithChallenges.length`. Esse é o `length` da lista carregada no
      // navegador, que pode ser muito maior que a amostra (o servidor limita
      // a 50); mandar esse número fazia o card afirmar "1.243 leads
      // analisados" quando o modelo só viu 50.
      const savedData = await api.post<StoredInsight>('/ia/insights-de-desafios', {
        insights: newInsights,
        leads_analyzed: newInsights.sampleSize,
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

  const deleteInsight = async (id: string) => {
    try {
      await api.delete(`/ia/insights-de-desafios/${id}`);

      // If deleted the current one, load the next one or clear
      if (id === currentInsightId) {
        const remaining = storedInsights.filter(s => s.id !== id);
        if (remaining.length > 0) {
          setInsights(remaining[0].insights);
          setCurrentInsightId(remaining[0].id);
        } else {
          setInsights(null);
          setCurrentInsightId(null);
        }
      }

      await loadStoredInsights();
      toast.success('Insight excluído com sucesso!');
    } catch (error) {
      console.error('Error deleting insight:', error);
      toast.error('Erro ao excluir insight', {
        description: error instanceof ErroApi ? error.message : undefined,
      });
    }
  };

  const loadInsight = (stored: StoredInsight) => {
    setInsights(stored.insights);
    setCurrentInsightId(stored.id);
    setShowHistory(false);
  };

  const sections = [
    { id: 'patterns', label: 'Padrões Identificados', icon: Target, color: 'text-info', data: insights?.patterns },
    { id: 'copy', label: 'Sugestões de Copy', icon: FileText, color: 'text-primary', data: insights?.copyRecommendations },
    { id: 'content', label: 'Recomendações de Conteúdo', icon: Lightbulb, color: 'text-warning', data: insights?.contentSuggestions },
    { id: 'opportunities', label: 'Oportunidades', icon: Target, color: 'text-success', data: insights?.opportunities },
  ];

  if (isLoadingHistory) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <span className="text-conteudo-heading">
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
                        ? 'bg-[--tint-primary] border-primary'
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
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Excluir insight?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Esta ação não pode ser desfeita. O insight será permanentemente excluído.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteInsight(stored.id)}
                            className="bg-danger text-destructive-foreground border border-danger hover:bg-danger/90"
                          >
                            Excluir
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
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
              {/* Sem número aqui de propósito: o tamanho real da amostra só
                  é conhecido quando a resposta volta (o servidor limita a
                  50, não `leadsWithChallenges.length`). */}
              Analisando os desafios relatados...
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
              <div className="border border-warning/30 rounded-lg overflow-hidden bg-[--tint-warning]">
                <button
                  onClick={() => setExpandedSection(expandedSection === 'gems' ? null : 'gems')}
                  className="w-full flex items-center justify-between p-4 hover:bg-warning/20 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Gem className="h-4 w-4 text-warning" />
                    <span className="font-medium text-[--on-tint-warning]">Respostas Destaque</span>
                    <Badge variant="warning" className="text-xs">
                      {insights.gems.length}
                    </Badge>
                  </div>
                  {expandedSection === 'gems' ? (
                    <ChevronUp className="h-4 w-4 text-warning" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-warning" />
                  )}
                </button>

                {expandedSection === 'gems' && (
                  <ScrollArea className="max-h-[300px]">
                    <div className="p-4 pt-0 space-y-3">
                      {insights.gems.map((gem, idx) => (
                        <div
                          key={idx}
                          className="p-4 bg-[--tint-warning] rounded-lg border border-warning/30"
                        >
                          <p className="text-sm text-foreground italic mb-2">
                            "{gem.response}"
                          </p>
                          <p className="text-xs text-[--on-tint-warning]">
                            <Gem className="inline h-3.5 w-3.5" /> {gem.reason}
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
