import { useState } from 'react';
import { api, ErroApi } from '@/lib/api';

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

  // ⚠️ Sem corpo: o servidor busca os leads sozinho, pelas mesmas ferramentas
  // do analista. Mandar a base inteira daqui era caminho longo e vazava dado
  // que o navegador nem precisava ter.
  const analyzeLeads = async () => {
    setIsAnalyzing(true);
    setError(null);

    try {
      const data = await api.post<AIAnalysisResult>('/ia/analisar-leads');
      setAnalysis(data);
    } catch (err) {
      console.error('Error analyzing leads:', err);
      setError(err instanceof ErroApi ? err.message : 'Erro ao analisar leads');
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
