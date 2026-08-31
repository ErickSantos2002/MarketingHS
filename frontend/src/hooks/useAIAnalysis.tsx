import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Lead } from './useLeads';

export interface AIAnalysisResult {
  summary: string;
  demographics: {
    cargos: { name: string; count: number; percentage: number }[];
    faturamentos: { name: string; count: number; percentage: number }[];
    funcionarios: { name: string; count: number; percentage: number }[];
  };
  patterns: {
    bestDays: string[];
    bestHours: string[];
    conversionInsights: string;
  };
  challenges: {
    mainThemes: string[];
    opportunities: string[];
  };
  recommendations: string[];
  icp: string;
}

export function useAIAnalysis() {
  const [analysis, setAnalysis] = useState<AIAnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyzeLeads = async (leads: Lead[]) => {
    if (leads.length === 0) {
      setError('Nenhum lead disponível para análise');
      return;
    }

    setIsAnalyzing(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('analyze-leads', {
        body: { leads }
      });

      if (fnError) {
        throw fnError;
      }

      if (data.error) {
        throw new Error(data.error);
      }

      setAnalysis(data.analysis);
    } catch (err) {
      console.error('Error analyzing leads:', err);
      setError(err instanceof Error ? err.message : 'Erro ao analisar leads');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const clearAnalysis = () => {
    setAnalysis(null);
    setError(null);
  };

  return { analysis, isAnalyzing, error, analyzeLeads, clearAnalysis };
}
