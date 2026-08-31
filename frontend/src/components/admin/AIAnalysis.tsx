import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Brain, Loader2, AlertCircle, Users, TrendingUp, Lightbulb, Target } from 'lucide-react';
import { useAIAnalysis, type AIAnalysisResult } from '@/hooks/useAIAnalysis';
import type { Lead } from '@/hooks/useLeads';

interface AIAnalysisProps {
  leads: Lead[];
}

export function AIAnalysis({ leads }: AIAnalysisProps) {
  const { analysis, isAnalyzing, error, analyzeLeads, clearAnalysis } = useAIAnalysis();

  const handleAnalyze = () => {
    analyzeLeads(leads);
  };

  if (error) {
    return (
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            Erro na Análise
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-4">{error}</p>
          <Button onClick={clearAnalysis} variant="outline">Tentar Novamente</Button>
        </CardContent>
      </Card>
    );
  }

  if (!analysis) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            Análise com IA
          </CardTitle>
          <CardDescription>
            Use inteligência artificial para obter insights sobre seus leads
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button 
            onClick={handleAnalyze} 
            disabled={isAnalyzing || leads.length === 0}
            className="w-full sm:w-auto"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Analisando {leads.length} leads...
              </>
            ) : (
              <>
                <Brain className="mr-2 h-4 w-4" />
                Gerar Análise ({leads.length} leads)
              </>
            )}
          </Button>
          {leads.length === 0 && (
            <p className="text-sm text-muted-foreground mt-2">
              Nenhum lead disponível para análise
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5" />
              Análise com IA
            </CardTitle>
            <CardDescription>
              Insights gerados a partir de {leads.length} leads
            </CardDescription>
          </div>
          <Button onClick={clearAnalysis} variant="outline" size="sm">
            Nova Análise
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary */}
        <div className="p-4 bg-muted rounded-lg">
          <p className="text-sm leading-relaxed">{analysis.summary}</p>
        </div>

        <Accordion type="multiple" className="w-full">
          {/* Demographics */}
          <AccordionItem value="demographics">
            <AccordionTrigger>
              <span className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                Análise Demográfica
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-4">
                <div>
                  <h4 className="font-medium mb-2">Distribuição por Cargo</h4>
                  <div className="space-y-2">
                    {analysis.demographics.cargos.map((item, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <div className="flex-1 bg-muted rounded-full h-2">
                          <div 
                            className="bg-primary h-2 rounded-full" 
                            style={{ width: `${item.percentage}%` }}
                          />
                        </div>
                        <span className="text-sm w-32">{item.name}</span>
                        <span className="text-sm text-muted-foreground w-16">{item.count} ({item.percentage}%)</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="font-medium mb-2">Faturamento</h4>
                  <div className="space-y-2">
                    {analysis.demographics.faturamentos.map((item, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <div className="flex-1 bg-muted rounded-full h-2">
                          <div 
                            className="bg-secondary h-2 rounded-full" 
                            style={{ width: `${item.percentage}%` }}
                          />
                        </div>
                        <span className="text-sm w-40">{item.name}</span>
                        <span className="text-sm text-muted-foreground w-16">{item.count} ({item.percentage}%)</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Patterns */}
          <AccordionItem value="patterns">
            <AccordionTrigger>
              <span className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Padrões de Conversão
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-4">
                <div>
                  <h4 className="font-medium mb-1">Melhores Dias</h4>
                  <p className="text-sm text-muted-foreground">
                    {analysis.patterns.bestDays.join(', ')}
                  </p>
                </div>
                <div>
                  <h4 className="font-medium mb-1">Melhores Horários</h4>
                  <p className="text-sm text-muted-foreground">
                    {analysis.patterns.bestHours.join(', ')}
                  </p>
                </div>
                <div>
                  <h4 className="font-medium mb-1">Insights de Conversão</h4>
                  <p className="text-sm text-muted-foreground">
                    {analysis.patterns.conversionInsights}
                  </p>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Challenges */}
          <AccordionItem value="challenges">
            <AccordionTrigger>
              <span className="flex items-center gap-2">
                <Lightbulb className="h-4 w-4" />
                Desafios e Oportunidades
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-4">
                <div>
                  <h4 className="font-medium mb-2">Principais Temas</h4>
                  <ul className="list-disc list-inside space-y-1">
                    {analysis.challenges.mainThemes.map((theme, i) => (
                      <li key={i} className="text-sm text-muted-foreground">{theme}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 className="font-medium mb-2">Oportunidades Identificadas</h4>
                  <ul className="list-disc list-inside space-y-1">
                    {analysis.challenges.opportunities.map((opp, i) => (
                      <li key={i} className="text-sm text-muted-foreground">{opp}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Recommendations */}
          <AccordionItem value="recommendations">
            <AccordionTrigger>
              <span className="flex items-center gap-2">
                <Target className="h-4 w-4" />
                Recomendações Estratégicas
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-4">
                <div>
                  <h4 className="font-medium mb-2">Perfil do Cliente Ideal (ICP)</h4>
                  <p className="text-sm text-muted-foreground p-3 bg-muted rounded-lg">
                    {analysis.icp}
                  </p>
                </div>
                <div>
                  <h4 className="font-medium mb-2">Recomendações</h4>
                  <ol className="list-decimal list-inside space-y-2">
                    {analysis.recommendations.map((rec, i) => (
                      <li key={i} className="text-sm text-muted-foreground">{rec}</li>
                    ))}
                  </ol>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}
