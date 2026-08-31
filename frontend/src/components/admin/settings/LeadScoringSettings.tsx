import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Loader2, Save, RefreshCw, Flame, Thermometer, Minus } from 'lucide-react';
import { toast } from 'sonner';
import { useScoringConfig } from '@/hooks/useScoringConfig';
import type { ScoringCriteria, ScoringThresholds } from '@/lib/leadScoring';
import { Skeleton } from '@/components/ui/skeleton';

export default function LeadScoringSettings() {
  const { config, loading, saving, save, recalculateAll } = useScoringConfig();
  const [criteria, setCriteria] = useState<ScoringCriteria | null>(null);
  const [thresholds, setThresholds] = useState<ScoringThresholds>({ hotlead: 70, warm: 40 });
  const [recalculating, setRecalculating] = useState(false);
  const [showRecalcModal, setShowRecalcModal] = useState(false);

  useEffect(() => {
    if (config) {
      setCriteria(config.criteria);
      setThresholds(config.thresholds);
    }
  }, [config]);

  const totalPoints = useMemo(() => {
    if (!criteria) return 0;
    let t = 0;
    if (criteria.cargo_decisor.enabled) t += criteria.cargo_decisor.points;
    if (criteria.faturamento.enabled) t += criteria.faturamento.points;
    if (criteria.funcionarios?.enabled) t += criteria.funcionarios.points;
    if (criteria.tem_desafios.enabled) t += criteria.tem_desafios.points;
    if (criteria.origem.enabled) t += criteria.origem.points;
    if (criteria.reconversao.enabled) t += criteria.reconversao.points;
    if (criteria.tem_whatsapp.enabled) t += criteria.tem_whatsapp.points;
    return t;
  }, [criteria]);

  const handleSave = async () => {
    if (!criteria) return;
    await save(criteria, thresholds);
    setShowRecalcModal(true);
  };

  const handleRecalculate = async () => {
    setRecalculating(true);
    setShowRecalcModal(false);
    try {
      const result = await recalculateAll();
      toast.success(`Score recalculado para ${result.updated} leads!`);
    } catch {
      toast.error('Erro ao recalcular scores');
    } finally {
      setRecalculating(false);
    }
  };

  if (loading || !criteria) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const updateCriteria = (key: keyof ScoringCriteria, field: string, value: any) => {
    setCriteria(prev => {
      if (!prev) return prev;
      return { ...prev, [key]: { ...prev[key], [field]: value } };
    });
  };

  const isOverLimit = totalPoints > 100;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold">Lead Scoring</h2>
        <p className="text-sm text-muted-foreground">Configure os pesos de cada critério (total: 100 pontos)</p>
      </div>

      {/* Total indicator */}
      <Card className="border-border/40">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Total configurado</span>
            <span className={`text-sm font-bold ${isOverLimit ? 'text-destructive' : 'text-foreground'}`}>
              {totalPoints}/100 pts
            </span>
          </div>
          <Progress
            value={Math.min(totalPoints, 100)}
            className={`h-2 ${isOverLimit ? '[&>div]:bg-destructive' : ''}`}
          />
          {isOverLimit && (
            <p className="text-xs text-destructive mt-1">⚠ O total excede 100 pontos. Reduza os pesos.</p>
          )}
        </CardContent>
      </Card>

      {/* Criteria */}
      <Card className="border-border/40">
        <CardHeader>
          <CardTitle className="text-base">Critérios e pesos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Cargo decisor */}
          <CriterionRow
            enabled={criteria.cargo_decisor.enabled}
            onToggle={(v) => updateCriteria('cargo_decisor', 'enabled', v)}
            label="Cargo decisor"
            description="CEO, Fundador, Diretor, Sócio, COO, CFO, CTO"
            points={criteria.cargo_decisor.points}
            maxPoints={50}
            onPointsChange={(v) => updateCriteria('cargo_decisor', 'points', v)}
          >
            <Textarea
              className="text-xs mt-2"
              placeholder="Um cargo por linha"
              rows={3}
              value={(criteria.cargo_decisor.cargos || []).join('\n')}
              onChange={(e) => updateCriteria('cargo_decisor', 'cargos', e.target.value.split('\n').filter(Boolean))}
            />
          </CriterionRow>

          {/* Faturamento */}
          <CriterionRow
            enabled={criteria.faturamento.enabled}
            onToggle={(v) => updateCriteria('faturamento', 'enabled', v)}
            label="Faturamento"
            description="Lead informa faturamento acima do mínimo"
            points={criteria.faturamento.points}
            maxPoints={50}
            onPointsChange={(v) => updateCriteria('faturamento', 'points', v)}
          >
            <div className="mt-2">
              <label className="text-[10px] text-muted-foreground">Faturamento mínimo (R$/mês)</label>
              <Input
                type="number"
                className="text-xs mt-1 w-48"
                value={criteria.faturamento.min_value || 100000}
                onChange={(e) => updateCriteria('faturamento', 'min_value', Number(e.target.value))}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Mapeamento: "100k-500k" = 100.000 · "500k-1M" = 500.000 · "acima de 1M" = 1.000.000
              </p>
            </div>
          </CriterionRow>

          {/* Funcionários */}
          <CriterionRow
            enabled={criteria.funcionarios?.enabled ?? false}
            onToggle={(v) => updateCriteria('funcionarios', 'enabled', v)}
            label="Nº de funcionários"
            description="Lead informa número de funcionários acima do mínimo"
            points={criteria.funcionarios?.points ?? 0}
            maxPoints={30}
            onPointsChange={(v) => updateCriteria('funcionarios', 'points', v)}
          >
            <div className="mt-2">
              <label className="text-[10px] text-muted-foreground">Mínimo de funcionários</label>
              <Input
                type="number"
                className="text-xs mt-1 w-48"
                value={criteria.funcionarios?.min_value || 10}
                onChange={(e) => updateCriteria('funcionarios', 'min_value', Number(e.target.value))}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Mapeamento: "Individual" = 1 · "2-10" = 2 · "11-25" = 11 · "26-49" = 26 · "Acima de 50" = 50
              </p>
            </div>
          </CriterionRow>

          {/* Desafios */}
          <CriterionRow
            enabled={criteria.tem_desafios.enabled}
            onToggle={(v) => updateCriteria('tem_desafios', 'enabled', v)}
            label="Respondeu o campo desafios"
            description="Preencheu o campo com pelo menos 20 caracteres"
            points={criteria.tem_desafios.points}
            maxPoints={30}
            onPointsChange={(v) => updateCriteria('tem_desafios', 'points', v)}
          />

          {/* Origem */}
          <CriterionRow
            enabled={criteria.origem.enabled}
            onToggle={(v) => updateCriteria('origem', 'enabled', v)}
            label="Origem qualificada"
            description="Lead veio de uma origem de alto valor"
            points={criteria.origem.points}
            maxPoints={30}
            onPointsChange={(v) => updateCriteria('origem', 'points', v)}
          >
            <div className="mt-2">
              <label className="text-[10px] text-muted-foreground">Sources qualificadas (separadas por vírgula)</label>
              <Input
                className="text-xs mt-1"
                placeholder="programadeiaficacao, instagram, google"
                value={(criteria.origem.sources || []).join(', ')}
                onChange={(e) => updateCriteria('origem', 'sources', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
              />
            </div>
          </CriterionRow>

          {/* Reconversão */}
          <CriterionRow
            enabled={criteria.reconversao.enabled}
            onToggle={(v) => updateCriteria('reconversao', 'enabled', v)}
            label="Já converteu antes"
            description="Lead tem mais de uma conversão no histórico"
            points={criteria.reconversao.points}
            maxPoints={20}
            onPointsChange={(v) => updateCriteria('reconversao', 'points', v)}
          />

          {/* WhatsApp */}
          <CriterionRow
            enabled={criteria.tem_whatsapp.enabled}
            onToggle={(v) => updateCriteria('tem_whatsapp', 'enabled', v)}
            label="WhatsApp preenchido"
            description="Campo whatsapp não está vazio"
            points={criteria.tem_whatsapp.points}
            maxPoints={20}
            onPointsChange={(v) => updateCriteria('tem_whatsapp', 'points', v)}
          />
        </CardContent>
      </Card>

      {/* Thresholds */}
      <Card className="border-border/40">
        <CardHeader>
          <CardTitle className="text-base">Thresholds de classificação</CardTitle>
          <CardDescription className="text-xs">Define as faixas de pontuação para cada etiqueta</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Visual bar */}
          <div className="flex h-6 rounded-md overflow-hidden text-[10px] font-medium">
            <div className="bg-muted flex items-center justify-center" style={{ width: `${thresholds.warm}%` }}>
              <Minus className="h-3 w-3 mr-0.5" /> Raw
            </div>
            <div className="bg-amber-500/30 text-amber-700 dark:text-amber-400 flex items-center justify-center" style={{ width: `${thresholds.hotlead - thresholds.warm}%` }}>
              <Thermometer className="h-3 w-3 mr-0.5" /> Warm
            </div>
            <div className="bg-red-500/30 text-red-700 dark:text-red-400 flex items-center justify-center" style={{ width: `${100 - thresholds.hotlead}%` }}>
              <Flame className="h-3 w-3 mr-0.5" /> Hotlead
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted-foreground font-medium">Warm a partir de</label>
              <Input
                type="number"
                min={0}
                max={thresholds.hotlead - 1}
                className="text-xs mt-1 w-24"
                value={thresholds.warm}
                onChange={(e) => setThresholds(t => ({ ...t, warm: Math.min(Number(e.target.value), t.hotlead - 1) }))}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium">Hotlead a partir de</label>
              <Input
                type="number"
                min={thresholds.warm + 1}
                max={100}
                className="text-xs mt-1 w-24"
                value={thresholds.hotlead}
                onChange={(e) => setThresholds(t => ({ ...t, hotlead: Math.max(Number(e.target.value), t.warm + 1) }))}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Save */}
      <div className="flex gap-3">
        <Button onClick={handleSave} disabled={saving || isOverLimit} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar configuração
        </Button>
        <Button variant="outline" onClick={() => setShowRecalcModal(true)} disabled={recalculating} className="gap-2">
          {recalculating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {recalculating ? 'Recalculando...' : 'Recalcular todos'}
        </Button>
      </div>

      {/* Recalculate modal */}
      <Dialog open={showRecalcModal} onOpenChange={setShowRecalcModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Recalcular score de todos os leads?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Isso vai recalcular o score e a etiqueta de todos os leads existentes com base na nova configuração. Pode levar alguns segundos.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRecalcModal(false)}>Deixar para depois</Button>
            <Button onClick={handleRecalculate} disabled={recalculating}>
              {recalculating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Recalcular agora
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CriterionRow({
  enabled, onToggle, label, description, points, maxPoints, onPointsChange, children,
}: {
  enabled: boolean;
  onToggle: (v: boolean) => void;
  label: string;
  description: string;
  points: number;
  maxPoints: number;
  onPointsChange: (v: number) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className={`p-4 rounded-lg border border-border/40 ${!enabled ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-3">
        <Switch checked={enabled} onCheckedChange={onToggle} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{label}</span>
            <Badge variant="secondary" className="text-[10px]">{points} pts</Badge>
          </div>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <div className="w-32 flex-shrink-0">
          <Slider
            min={0}
            max={maxPoints}
            step={5}
            value={[points]}
            onValueChange={([v]) => onPointsChange(v)}
            disabled={!enabled}
          />
        </div>
      </div>
      {enabled && children}
    </div>
  );
}
