import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertTriangle, AlertCircle, Zap, GitBranch, Play, Plus, Trash2 } from 'lucide-react';
import { listarTags } from '@/lib/contatos';
import { AUTOMACAO_NAO_LIGADA } from '@/lib/automacoes';
import type { AutomationRule, AutomationCondition } from '@/lib/automacoes';

interface Props {
  rule: AutomationRule | null;
  onSave: (rule: Partial<AutomationRule>) => Promise<void>;
  onCancel: () => void;
}

// Nomenclatura alinhada com /contacts, /segments e o builder de fluxos:
// "Etiqueta" = tag vinculada ao contato (lead_tags); "Qualificação" = coluna
// leads.etiqueta (hotlead/warm/raw). Só os RÓTULOS mudaram — os valores
// ('tag', 'etiqueta') continuam os mesmos que Automations.tsx avalia.
//
// ⚠️ Revisão final do 8D (I1): 'tag' ("Etiqueta") saiu das opções. O gatilho
// que avalia as regras não tem ramo para ela (nem a origem tinha) e adicionar
// tag grava `lead_tags`, não `leads` — a regra ficaria "ativa" sem nunca
// disparar. O backend recusa ao salvar; o mapa de operadores de 'tag' abaixo
// fica só para exibir regra antiga.
const CONDITION_TYPES = [
  { value: 'status', label: 'Status' },
  { value: 'etiqueta', label: 'Qualificação' },
  { value: 'score', label: 'Score' },
  { value: 'created_at', label: 'Período (data de criação)' },
];

const STATUS_VALUES = ['Lead', 'Lead Qualificado', 'MQL - Reunião agendada', 'SQL - Em negociação', 'Venda realizada', 'Em contrato', 'Iniciado'];
const ETIQUETA_VALUES = ['hotlead', 'warm', 'raw'];

const OPERATORS_MAP: Record<string, { value: string; label: string }[]> = {
  status: [
    { value: 'is', label: 'é' },
    { value: 'is_not', label: 'não é' },
  ],
  etiqueta: [
    { value: 'is', label: 'é' },
    { value: 'is_not', label: 'não é' },
  ],
  // Valores mantidos (Automations.tsx avalia `contains` como "tem a tag");
  // só o rótulo acompanha o vocabulário das outras telas.
  tag: [
    { value: 'contains', label: 'tem' },
    { value: 'is_not', label: 'não tem' },
  ],
  score: [
    { value: 'greater_than', label: 'maior que' },
    { value: 'less_than', label: 'menor que' },
  ],
  created_at: [
    { value: 'between', label: 'entre' },
    { value: 'after', label: 'depois de' },
    { value: 'before', label: 'antes de' },
    { value: 'last_n_days', label: 'últimos N dias' },
  ],
};

// ⚠️ Revisão final do 8D (I4): "Mover etapa" fica à vista, mas desabilitada —
// o contrato do GrowthHS não tem a rota, e o backend recusa ao salvar.
const ACTION_TYPES: { value: string; label: string; indisponivel?: string }[] = [
  { value: 'create_in_growthhs', label: 'Criar card no GrowthHS' },
  { value: 'move_stage_growthhs', label: 'Mover etapa no GrowthHS', indisponivel: AUTOMACAO_NAO_LIGADA },
  { value: 'block_growthhs', label: 'Não enviar ao GrowthHS (bloquear)' },
];

function buildInitialConditions(rule: AutomationRule | null): AutomationCondition[] {
  if (rule?.conditions && Array.isArray(rule.conditions) && rule.conditions.length > 0) {
    return rule.conditions;
  }
  if (rule) {
    return [{ type: rule.condition_type, operator: rule.condition_operator, value: rule.condition_value }];
  }
  return [{ type: 'status', operator: 'is', value: '' }];
}

// ---------- Condition Row Component ----------
function ConditionRow({
  condition,
  index,
  tags,
  onChange,
  onRemove,
  canRemove,
}: {
  condition: AutomationCondition;
  index: number;
  tags: { id: string; name: string }[];
  onChange: (index: number, cond: AutomationCondition) => void;
  onRemove: (index: number) => void;
  canRemove: boolean;
}) {
  const operators = OPERATORS_MAP[condition.type] || [];

  // Ensure operator is valid for the type
  useEffect(() => {
    if (operators.length > 0 && !operators.find(o => o.value === condition.operator)) {
      onChange(index, { ...condition, operator: operators[0].value, value: '' });
    }
  }, [condition.type]);

  const updateField = (field: keyof AutomationCondition, val: string) => {
    const updated = { ...condition, [field]: val };
    // Reset downstream when type changes
    if (field === 'type') {
      const ops = OPERATORS_MAP[val] || [];
      updated.operator = ops[0]?.value || 'is';
      updated.value = '';
    }
    onChange(index, updated);
  };

  const renderValue = () => {
    if (condition.type === 'created_at') {
      if (condition.operator === 'between') {
        const parts = condition.value.split('|');
        const start = parts[0] || '';
        const end = parts[1] || '';
        return (
          <div className="grid grid-cols-2 gap-2">
            <Input type="date" value={start} onChange={(e) => onChange(index, { ...condition, value: `${e.target.value}|${end}` })} />
            <Input type="date" value={end} onChange={(e) => onChange(index, { ...condition, value: `${start}|${e.target.value}` })} />
          </div>
        );
      }
      if (condition.operator === 'last_n_days') {
        return <Input type="number" min={1} max={365} placeholder="ex: 7" value={condition.value} onChange={(e) => updateField('value', e.target.value)} />;
      }
      return <Input type="date" value={condition.value} onChange={(e) => updateField('value', e.target.value)} />;
    }

    if (condition.type === 'score') {
      return <Input type="number" min={0} max={100} placeholder="0-100" value={condition.value} onChange={(e) => updateField('value', e.target.value)} />;
    }

    const values =
      condition.type === 'status' ? STATUS_VALUES :
      condition.type === 'etiqueta' ? ETIQUETA_VALUES :
      condition.type === 'tag' ? tags.map(t => t.name) :
      [];

    return (
      <Select value={condition.value} onValueChange={(v) => updateField('value', v)}>
        <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
        <SelectContent>
          {values.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
        </SelectContent>
      </Select>
    );
  };

  return (
    <div className="flex items-start gap-2 p-3 rounded-lg border border-border/40 bg-muted/20">
      <div className="flex-1 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Select value={condition.type} onValueChange={(v) => updateField('type', v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CONDITION_TYPES.map(ct => <SelectItem key={ct.value} value={ct.value}>{ct.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={condition.operator} onValueChange={(v) => updateField('operator', v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {operators.map(op => <SelectItem key={op.value} value={op.value}>{op.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {renderValue()}
      </div>
      {canRemove && (
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 mt-0.5 text-destructive/60 hover:text-destructive" onClick={() => onRemove(index)}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

// ---------- Main Form ----------
export function AutomationRuleForm({ rule, onSave, onCancel }: Props) {
  const [name, setName] = useState(rule?.name || '');
  const [priority, setPriority] = useState(rule?.priority || 1);
  const [conditions, setConditions] = useState<AutomationCondition[]>(() => buildInitialConditions(rule));
  const [conditionLogic, setConditionLogic] = useState<'and' | 'or'>((rule as any)?.condition_logic || 'and');
  const [actionType, setActionType] = useState(rule?.action_type || 'create_in_growthhs');
  const [actionValue, setActionValue] = useState(rule?.action_value || '');
  const [actionMetadata, setActionMetadata] = useState<Record<string, any>>(rule?.action_metadata || {});
  const [isActive, setIsActive] = useState(rule?.is_active ?? true);
  const [saving, setSaving] = useState(false);

  // Etapas do GrowthHS — o contrato não tem rota de leitura para listá-las
  // (decisão 10 do plano), então o campo é texto livre, só para
  // `move_stage_growthhs` (a única ação que ainda pede uma etapa: criar e
  // bloquear não usam `action_value` — ver Step 1 do plano).

  // Tags
  const [tags, setTags] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    // A API devolve {id, nome, cor}; o formulário fala {id, name}.
    listarTags()
      .then((lista) => setTags(lista.map((t) => ({ id: t.id, name: t.nome }))))
      .catch(() => setTags([]));
  }, []);

  const updateCondition = (index: number, cond: AutomationCondition) => {
    setConditions(prev => prev.map((c, i) => i === index ? cond : c));
  };

  const removeCondition = (index: number) => {
    setConditions(prev => prev.filter((_, i) => i !== index));
  };

  const addCondition = () => {
    setConditions(prev => [...prev, { type: 'status', operator: 'is', value: '' }]);
  };

  const isConditionComplete = (c: AutomationCondition) => {
    if (c.type === 'created_at' && c.operator === 'between') {
      const parts = c.value.split('|');
      return !!(parts[0] && parts[1]);
    }
    return !!c.value;
  };

  const allConditionsValid = conditions.length > 0 && conditions.every(isConditionComplete);

  const handleSubmit = async () => {
    if (!name.trim() || !allConditionsValid) return;
    setSaving(true);

    // Use the first condition for legacy columns
    const first = conditions[0];

    await onSave({
      ...(rule?.id ? { id: rule.id } : {}),
      name: name.trim(),
      priority,
      condition_type: first.type,
      condition_operator: first.operator,
      condition_value: first.value,
      conditions,
      condition_logic: conditionLogic,
      action_type: actionType,
      // Só `move_stage_growthhs` usa `action_value`: o card de criar entra
      // sempre na etapa de entrada do funil configurado, e bloquear não tem
      // etapa nenhuma.
      action_value: actionType === 'move_stage_growthhs' ? (actionValue || null) : null,
      action_metadata: actionType === 'move_stage_growthhs' ? actionMetadata : {},
      is_active: isActive,
    });
    setSaving(false);
  };

  const needsStageSelect = actionType === 'move_stage_growthhs';

  return (
    <div className="space-y-6">
      {/* Identity */}
      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Nome da regra</Label>
          <Input placeholder='ex: "Hotleads → Diagnóstico"' value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Prioridade (1-10)</Label>
            <Input type="number" min={1} max={10} value={priority} onChange={(e) => setPriority(Math.min(10, Math.max(1, Number(e.target.value))))} />
          </div>
          <div className="flex items-end pb-1">
            <p className="text-xs text-muted-foreground leading-tight">Regras com maior prioridade são avaliadas primeiro.</p>
          </div>
        </div>
      </div>

      <div className="h-px bg-border" />

      {/* Conditions */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-[--tint-primary]">
              <GitBranch className="h-3.5 w-3.5 text-primary" />
            </div>
            <Label className="text-sm font-semibold">Condições — SE...</Label>
          </div>
          {conditions.length > 1 && (
            <div className="flex items-center gap-1 bg-muted/40 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => setConditionLogic('and')}
                className={`px-2.5 py-1 text-xs font-bold rounded-md transition-colors ${
                  conditionLogic === 'and' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                E (AND)
              </button>
              <button
                type="button"
                onClick={() => setConditionLogic('or')}
                className={`px-2.5 py-1 text-xs font-bold rounded-md transition-colors ${
                  conditionLogic === 'or' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                OU (OR)
              </button>
            </div>
          )}
        </div>

        <div className="space-y-2 pl-1">
          {conditions.map((cond, i) => (
            <div key={i}>
              {i > 0 && (
                <div className="flex items-center justify-center py-1">
                  <Badge variant="outline" className="text-xs px-2 py-0 border-primary/30 text-[--on-tint-primary]">
                    {conditionLogic === 'and' ? 'E' : 'OU'}
                  </Badge>
                </div>
              )}
              <ConditionRow
                condition={cond}
                index={i}
                tags={tags}
                onChange={updateCondition}
                onRemove={removeCondition}
                canRemove={conditions.length > 1}
              />
            </div>
          ))}
        </div>

        <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-muted-foreground" onClick={addCondition}>
          <Plus className="h-3 w-3" /> Adicionar condição
        </Button>
      </div>

      <div className="h-px bg-border" />

      {/* Action */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-info/10">
            <Play className="h-3.5 w-3.5 text-info" />
          </div>
          <Label className="text-sm font-semibold">Ação — ENTÃO...</Label>
        </div>

        <div className="space-y-3 pl-1">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Tipo de ação</Label>
            <Select value={actionType} onValueChange={(v) => { setActionType(v); setActionValue(''); setActionMetadata({}); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ACTION_TYPES.map(at => (
                  <SelectItem key={at.value} value={at.value} disabled={!!at.indisponivel}>
                    <span className="block">{at.label}</span>
                    {at.indisponivel && (
                      <span className="block text-xs text-muted-foreground leading-snug max-w-xs whitespace-normal">
                        {at.indisponivel}
                      </span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {actionType === 'block_growthhs' && (
            <p className="text-xs text-muted-foreground leading-relaxed">
              Bloqueia o envio ao GrowthHS mesmo que outras regras se apliquem.
            </p>
          )}

          {actionType === 'create_in_growthhs' && (
            <p className="text-xs text-muted-foreground leading-relaxed">
              O card entra na etapa de entrada do funil configurado em
              Configurações → GrowthHS.
            </p>
          )}

          {actionType === 'move_stage_growthhs' && (
            <div className="flex gap-2 text-xs text-[--on-tint-warning] bg-[--tint-warning] border border-warning/30 rounded-md p-2.5 leading-relaxed">
              <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
              <p>{AUTOMACAO_NAO_LIGADA}</p>
            </div>
          )}

          {needsStageSelect && (
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Estágio do pipeline</Label>
              <Input
                placeholder="ID da etapa no GrowthHS"
                value={actionValue}
                onChange={(e) => { setActionValue(e.target.value); setActionMetadata({ stage_id: e.target.value, stage_name: e.target.value }); }}
              />
              <p className="text-xs text-muted-foreground leading-relaxed">
                O contrato ainda não tem rota para mover card de etapa — ver o
                aviso acima.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="h-px bg-border" />

      {/* Active toggle */}
      <div className="flex items-center gap-3 py-1">
        <Switch checked={isActive} onCheckedChange={setIsActive} />
        <div>
          <Label className="text-sm">Ativa esta regra imediatamente</Label>
          <p className="text-xs text-muted-foreground">Regra ativa dispara na primeira mudança de etiqueta, status ou pontuação que casar com ela.</p>
        </div>
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-3 pt-3 border-t border-border">
        <Button variant="ghost" size="sm" onClick={onCancel} className="px-4">Cancelar</Button>
        <Button size="sm" onClick={handleSubmit} disabled={saving || !name.trim() || !allConditionsValid} className="px-5">
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
          <Zap className="h-3.5 w-3.5 mr-1.5" />
          Salvar regra
        </Button>
      </div>
    </div>
  );
}
