import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MessageSquare, CheckCircle, TrendingUp, Award } from 'lucide-react';
import type { ResponseQuality } from '@/hooks/useLeadAnalytics';

interface ResponseQualityCardsProps {
  quality: ResponseQuality;
}

export function ResponseQualityCards({ quality }: ResponseQualityCardsProps) {
  const getResponseRateColor = (rate: number) => {
    if (rate >= 60) return 'text-green-500';
    if (rate >= 40) return 'text-yellow-500';
    return 'text-red-500';
  };

  const getQualityScoreColor = (score: number) => {
    if (score >= 70) return 'text-green-500';
    if (score >= 40) return 'text-yellow-500';
    return 'text-red-500';
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Taxa de Resposta */}
      <Card className="bg-gradient-to-br from-background to-muted/30 border-border/50">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Taxa de Resposta
          </CardTitle>
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold ${getResponseRateColor(quality.responseRate)}`}>
            {quality.responseRate.toFixed(1)}%
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {quality.withResponse} de {quality.total} leads responderam
          </p>
          <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-primary to-primary/70 transition-all duration-500"
              style={{ width: `${Math.min(quality.responseRate, 100)}%` }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Taxa de Alta Qualidade */}
      <Card className="bg-gradient-to-br from-background to-muted/30 border-border/50">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Alta Qualidade
          </CardTitle>
          <Award className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold ${getQualityScoreColor(quality.highQualityRate)}`}>
            {quality.highQualityRate.toFixed(1)}%
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {quality.highQuality} respostas com 50+ caracteres
          </p>
          <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all duration-500"
              style={{ width: `${Math.min(quality.highQualityRate, 100)}%` }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Taxa de Aproveitabilidade */}
      <Card className="bg-gradient-to-br from-background to-muted/30 border-border/50">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Aproveitáveis
          </CardTitle>
          <CheckCircle className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold ${getQualityScoreColor(quality.approvalRate)}`}>
            {quality.approvalRate.toFixed(1)}%
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {quality.highQuality + quality.mediumQuality} respostas úteis
          </p>
          <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all duration-500"
              style={{ width: `${Math.min(quality.approvalRate, 100)}%` }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Score Médio de Qualidade */}
      <Card className="bg-gradient-to-br from-background to-muted/30 border-border/50">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Score Médio
          </CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold ${getQualityScoreColor(quality.qualityScore)}`}>
            {quality.qualityScore.toFixed(0)}/100
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Média: {quality.averageLength.toFixed(0)} caracteres/resposta
          </p>
          <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-purple-500 to-pink-400 transition-all duration-500"
              style={{ width: `${quality.qualityScore}%` }}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
