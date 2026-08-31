import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useTemplates } from '@/hooks/useTemplates';
import { useSegments } from '@/hooks/useSegments';
import { NODE_LABELS, EVENT_OPTIONS, isBranch, type JourneyNodeType } from '@/lib/journeys';

// Mesmo vocabulário field/operator/value que build_segment_condition
// (migration 20260713250000) mapeia -- evaluate_rules_for_lead (Task 6.4)
// reusa a MESMA função para o ramo de fluxo. Nada de um segundo dialeto:
// mudar aqui sem mudar lá é regra que a UI deixa salvar e o banco avalia
// diferente.
const ATTRIBUTE_FIELD_OPTIONS = [
  { value: 'tag', label: 'Etiqueta' },
  { value: 'qualificacao', label: 'Qualificação' },
  { value: 'status', label: 'Status' },
  { value: 'tipo', label: 'Modal' },
  { value: 'cargo', label: 'Cargo' },
  { value: 'faturamento', label: 'Faturamento' },
  { value: 'utm_source', label: 'Origem (utm)' },
  { value: 'page_slug', label: 'Página' },
  { value: 'created_at', label: 'Criado nos últimos' },
];

// Campo antigo `etiqueta` = coluna leads.etiqueta, o MESMO dado de
// 'qualificacao' (só muda o vocabulário: hotlead/warm/raw vs hot/warm/raw).
// Saiu da lista de campos novos — "Etiqueta" agora é a tag de lead_tags — mas
// continua avaliado pelo backend e só reaparece no seletor quando um fluxo já
// salvo o utiliza.
const LEGACY_ATTRIBUTE_FIELD_OPTIONS = [
  { value: 'etiqueta', label: 'Qualificação (legado)' },
];

const ATTRIBUTE_OPERATORS: Record<string, { value: string; label: string }[]> = {
  tag: [{ value: 'is', label: 'tem' }, { value: 'is_not', label: 'não tem' }],
  etiqueta: [{ value: 'is', label: 'é' }, { value: 'is_not', label: 'não é' }],
  qualificacao: [{ value: 'is', label: 'é' }, { value: 'is_not', label: 'não é' }],
  status: [{ value: 'is', label: 'é' }, { value: 'is_not', label: 'não é' }],
  tipo: [{ value: 'is', label: 'é' }, { value: 'is_not', label: 'não é' }],
  cargo: [{ value: 'contains', label: 'contém' }, { value: 'not_contains', label: 'não contém' }],
  faturamento: [{ value: 'gt', label: 'maior que' }, { value: 'lt', label: 'menor que' }],
  utm_source: [{ value: 'contains', label: 'contém' }, { value: 'exact', label: 'é exatamente' }],
  page_slug: [{ value: 'exact', label: 'é exatamente' }],
  created_at: [],
};

// Só usado pelo campo legado 'etiqueta' (coluna leads.etiqueta).
const ETIQUETA_VALUES = ['hotlead', 'warm', 'raw'];
const QUALIFICACAO_VALUES = [
  { value: 'hot', label: 'Hot Lead' },
  { value: 'warm', label: 'Warm Lead' },
  { value: 'raw', label: 'Sem qualificação' },
];
const DAYS_OPTIONS = ['7', '15', '30', '60', '90'];

type DurationUnit = 'minutos' | 'horas' | 'dias';
const UNIT_MINUTES: Record<DurationUnit, number> = { minutos: 1, horas: 60, dias: 1440 };

function minutesToQtyUnit(minutes: number | undefined): { qty: number; unit: DurationUnit } {
  const m = minutes || 0;
  if (m > 0 && m % 1440 === 0) return { qty: m / 1440, unit: 'dias' };
  if (m > 0 && m % 60 === 0) return { qty: m / 60, unit: 'horas' };
  return { qty: m || 1, unit: 'minutos' };
}

interface AttrRule { field: string; operator: string; value: string }

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  type: JourneyNodeType | null;
  initialConfig: Record<string, any>;
  sendEmailNodes: { id: string; label: string }[];
  // resolvedType: quando o nó é uma "Condição", o subtipo real (branch_attribute
  // / branch_segment / branch_email_event) escolhido dentro do diálogo. Para os
  // demais tipos vem undefined (o chamador usa o type original).
  onSave: (config: Record<string, any>, resolvedType?: JourneyNodeType) => void;
}

export function NodeConfigDialog({ open, onOpenChange, type, initialConfig, sendEmailNodes, onSave }: Props) {
  const { templates } = useTemplates();
  const { segments } = useSegments();

  // send_email
  const [templateId, setTemplateId] = useState('');
  const [subject, setSubject] = useState('');

  // delay
  const [delayQty, setDelayQty] = useState(1);
  const [delayUnit, setDelayUnit] = useState<DurationUnit>('dias');

  // wait_for_event
  const [eventType, setEventType] = useState('');
  const [timeoutQty, setTimeoutQty] = useState(3);
  const [timeoutUnit, setTimeoutUnit] = useState<DurationUnit>('dias');
  const [sourceNodeId, setSourceNodeId] = useState('');

  // branch_attribute
  const [rules, setRules] = useState<AttrRule[]>([{ field: '', operator: '', value: '' }]);
  const [logic, setLogic] = useState<'and' | 'or'>('and');

  // branch_segment
  const [segmentId, setSegmentId] = useState('');

  // branch_email_event (reusa sourceNodeId para o email de origem)
  const [emailCheck, setEmailCheck] = useState('');

  // Subtipo da "Condição" unificada. Só relevante quando o type recebido é um
  // branch_*; o menu do builder abre sempre com branch_attribute como padrão e o
  // usuário troca aqui. effType (abaixo) é o tipo REAL usado para render/validação/save.
  const [condType, setCondType] = useState<JourneyNodeType>('branch_attribute');
  const effType: JourneyNodeType | null = type && isBranch(type) ? condType : type;

  // apply_tag
  const [tagName, setTagName] = useState('');

  // Etiquetas vinculadas aos contatos (tabela `tags`, ligada por lead_tags) —
  // as mesmas do filtro ETIQUETA de /contacts e do campo Etiqueta dos segmentos.
  const [tags, setTags] = useState<{ id: string; name: string }[]>([]);

  // handoff_nexus
  const [stages, setStages] = useState<{ id: string; name: string; is_won?: boolean; is_lost?: boolean }[]>([]);
  const [stagesLoading, setStagesLoading] = useState(false);
  const [stageId, setStageId] = useState('');

  useEffect(() => {
    if (!open || !type) return;
    const cfg = initialConfig || {};
    setTemplateId(cfg.template_id || '');
    setSubject(cfg.subject || '');
    const d = minutesToQtyUnit(cfg.minutes);
    setDelayQty(d.qty);
    setDelayUnit(d.unit);
    setEventType(cfg.event_type || '');
    const t = minutesToQtyUnit(cfg.timeout_minutes);
    setTimeoutQty(t.qty);
    setTimeoutUnit(t.unit);
    setSourceNodeId(cfg.source_node_id || '');
    setRules(Array.isArray(cfg.rules) && cfg.rules.length > 0 ? cfg.rules : [{ field: '', operator: '', value: '' }]);
    setLogic(cfg.logic === 'or' ? 'or' : 'and');
    setSegmentId(cfg.segment_id || '');
    setEmailCheck(cfg.check || '');
    if (type && isBranch(type)) setCondType(type);
    setTagName(cfg.tag_name || '');
    setStageId(cfg.stage_id || '');

    if (type === 'handoff_nexus') {
      setStagesLoading(true);
      supabase.functions.invoke('get-nexus-stages')
        .then(({ data }) => setStages(data?.stages || []))
        .catch(() => setStages([]))
        .finally(() => setStagesLoading(false));
    }
  }, [open, type, initialConfig]);

  useEffect(() => {
    if (!open) return;
    supabase
      .from('tags')
      .select('id, name')
      .order('name')
      .then(({ data }) => setTags(data || []));
  }, [open]);

  const addRule = () => setRules((r) => [...r, { field: '', operator: '', value: '' }]);
  const removeRule = (i: number) => setRules((r) => r.filter((_, idx) => idx !== i));
  const updateRule = (i: number, patch: Partial<AttrRule>) => {
    setRules((r) => {
      const next = [...r];
      next[i] = { ...next[i], ...patch };
      if (patch.field) {
        next[i].operator = ATTRIBUTE_OPERATORS[patch.field]?.[0]?.value || '';
        next[i].value = '';
      }
      return next;
    });
  };

  const normalizedTag = tagName.replace(/^\/+/, '').trim().toLowerCase();

  const isValid = (): boolean => {
    switch (effType) {
      case 'send_email': return !!templateId && !!subject.trim();
      case 'delay': return delayQty > 0;
      case 'wait_for_event': return !!eventType && timeoutQty > 0;
      case 'branch_attribute': return rules.some((r) => r.field && (r.value || ATTRIBUTE_OPERATORS[r.field]?.length === 0));
      case 'branch_segment': return !!segmentId;
      case 'branch_email_event': return !!sourceNodeId && ['delivered', 'opened', 'clicked'].includes(emailCheck);
      case 'apply_tag': return !!normalizedTag;
      case 'handoff_nexus': return !!stageId;
      default: return false;
    }
  };

  const handleSave = () => {
    if (!type || !isValid()) return;
    let config: Record<string, any> = {};
    switch (effType) {
      case 'send_email':
        config = { template_id: templateId, subject: subject.trim() };
        break;
      case 'delay':
        config = { minutes: delayQty * UNIT_MINUTES[delayUnit] };
        break;
      case 'wait_for_event':
        config = {
          event_type: eventType,
          timeout_minutes: timeoutQty * UNIT_MINUTES[timeoutUnit],
          ...(sourceNodeId ? { source_node_id: sourceNodeId } : {}),
        };
        break;
      case 'branch_attribute':
        config = { rules: rules.filter((r) => r.field && (r.value || ATTRIBUTE_OPERATORS[r.field]?.length === 0)), logic };
        break;
      case 'branch_segment':
        config = { segment_id: segmentId };
        break;
      case 'branch_email_event':
        config = { check: emailCheck, source_node_id: sourceNodeId };
        break;
      case 'apply_tag':
        config = { tag_name: normalizedTag };
        break;
      case 'handoff_nexus': {
        const stage = stages.find((s) => s.id === stageId);
        config = { stage_id: stageId, stage_name: stage?.name || '' };
        break;
      }
    }
    // Passa o subtipo real quando é uma Condição; o chamador persiste esse type.
    onSave(config, type && isBranch(type) ? (effType ?? undefined) : undefined);
  };

  const renderRuleValue = (rule: AttrRule, i: number) => {
    if (rule.field === 'tag') {
      // Guarda o id da tag (não o nome): renomear a etiqueta não quebra o fluxo.
      // build_segment_condition aceita id ou nome no ramo 'tag'.
      return (
        <Select value={rule.value} onValueChange={(v) => updateRule(i, { value: v })}>
          <SelectTrigger className="flex-1"><SelectValue placeholder="Etiqueta" /></SelectTrigger>
          <SelectContent>
            {tags.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground">Nenhuma etiqueta cadastrada</p>
            )}
            {tags.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    }
    if (rule.field === 'etiqueta') {
      return (
        <Select value={rule.value} onValueChange={(v) => updateRule(i, { value: v })}>
          <SelectTrigger className="flex-1"><SelectValue placeholder="Valor" /></SelectTrigger>
          <SelectContent>{ETIQUETA_VALUES.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
        </Select>
      );
    }
    if (rule.field === 'qualificacao') {
      return (
        <Select value={rule.value} onValueChange={(v) => updateRule(i, { value: v })}>
          <SelectTrigger className="flex-1"><SelectValue placeholder="Qualificação" /></SelectTrigger>
          <SelectContent>{QUALIFICACAO_VALUES.map((v) => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}</SelectContent>
        </Select>
      );
    }
    if (rule.field === 'created_at') {
      return (
        <Select value={rule.value} onValueChange={(v) => updateRule(i, { value: v })}>
          <SelectTrigger className="flex-1"><SelectValue placeholder="Dias" /></SelectTrigger>
          <SelectContent>{DAYS_OPTIONS.map((v) => <SelectItem key={v} value={v}>{v} dias</SelectItem>)}</SelectContent>
        </Select>
      );
    }
    return <Input className="flex-1" value={rule.value} onChange={(e) => updateRule(i, { value: e.target.value })} placeholder="Valor" />;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{type && isBranch(type) ? 'Condição' : type ? NODE_LABELS[type] : 'Passo'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {type && isBranch(type) && (
            <div className="space-y-1.5">
              <Label>Tipo de condição</Label>
              <Select value={condType} onValueChange={(v) => setCondType(v as JourneyNodeType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="branch_attribute">Atributo do contato</SelectItem>
                  <SelectItem value="branch_segment">Está num segmento</SelectItem>
                  <SelectItem value="branch_email_event">Interação com email do fluxo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {type === 'send_email' && (
            <>
              <div className="space-y-1.5">
                <Label>Template</Label>
                <Select value={templateId} onValueChange={setTemplateId}>
                  <SelectTrigger><SelectValue placeholder="Selecione um template" /></SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Assunto</Label>
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Assunto do email" />
              </div>
              <div className="flex gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-md p-2.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <p>O template é lido no momento do envio — editar o template depois muda os emails ainda não enviados deste fluxo.</p>
              </div>
            </>
          )}

          {type === 'delay' && (
            <div className="space-y-1.5">
              <Label>Esperar</Label>
              <div className="flex gap-2">
                <Input type="number" min={1} className="w-24" value={delayQty} onChange={(e) => setDelayQty(Math.max(1, Number(e.target.value)))} />
                <Select value={delayUnit} onValueChange={(v) => setDelayUnit(v as DurationUnit)}>
                  <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minutos">Minutos</SelectItem>
                    <SelectItem value="horas">Horas</SelectItem>
                    <SelectItem value="dias">Dias</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {type === 'wait_for_event' && (
            <>
              <div className="space-y-1.5">
                <Label>Evento a aguardar</Label>
                <Select value={eventType} onValueChange={setEventType}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {EVENT_OPTIONS.map((e) => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {(eventType === 'email_delivered' || eventType === 'email_opened' || eventType === 'email_clicked') && sendEmailNodes.length > 0 && (
                <div className="space-y-1.5">
                  <Label>De qual email deste fluxo (opcional)</Label>
                  <Select value={sourceNodeId || '__any__'} onValueChange={(v) => setSourceNodeId(v === '__any__' ? '' : v)}>
                    <SelectTrigger><SelectValue placeholder="Qualquer email" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__any__">Qualquer email do fluxo</SelectItem>
                      {sendEmailNodes.map((n) => <SelectItem key={n.id} value={n.id}>{n.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">Sem escolher, o passo casa com a abertura/clique de qualquer email deste fluxo.</p>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Tempo limite (timeout)</Label>
                <div className="flex gap-2">
                  <Input type="number" min={1} className="w-24" value={timeoutQty} onChange={(e) => setTimeoutQty(Math.max(1, Number(e.target.value)))} />
                  <Select value={timeoutUnit} onValueChange={(v) => setTimeoutUnit(v as DurationUnit)}>
                    <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="minutos">Minutos</SelectItem>
                      <SelectItem value="horas">Horas</SelectItem>
                      <SelectItem value="dias">Dias</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {(eventType === 'email_opened') && (
                <div className="flex gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-md p-2.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <p>Aberturas de email são infladas por proteção de privacidade (Apple Mail pré-carrega o pixel). Para decisões críticas, prefira ramificar por <strong>clique</strong>.</p>
                </div>
              )}
            </>
          )}

          {effType === 'branch_attribute' && (
            <>
              <div className="flex items-center justify-between">
                <Label>Condições</Label>
                {rules.length > 1 && (
                  <div className="flex gap-0.5 p-0.5 bg-muted/40 rounded-md">
                    <button type="button" onClick={() => setLogic('and')} className={`px-2 py-0.5 rounded text-[10px] font-bold ${logic === 'and' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>E (AND)</button>
                    <button type="button" onClick={() => setLogic('or')} className={`px-2 py-0.5 rounded text-[10px] font-bold ${logic === 'or' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>OU (OR)</button>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                {rules.map((rule, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <Select value={rule.field} onValueChange={(v) => updateRule(i, { field: v })}>
                      <SelectTrigger className="w-[130px]"><SelectValue placeholder="Campo" /></SelectTrigger>
                      <SelectContent>
                        {ATTRIBUTE_FIELD_OPTIONS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                        {rules.some((r) => r.field === 'etiqueta') &&
                          LEGACY_ATTRIBUTE_FIELD_OPTIONS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {rule.field && ATTRIBUTE_OPERATORS[rule.field]?.length > 0 && (
                      <Select value={rule.operator} onValueChange={(v) => updateRule(i, { operator: v })}>
                        <SelectTrigger className="w-[100px]"><SelectValue placeholder="Op" /></SelectTrigger>
                        <SelectContent>{ATTRIBUTE_OPERATORS[rule.field].map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                      </Select>
                    )}
                    {rule.field && renderRuleValue(rule, i)}
                    <button onClick={() => removeRule(i)} className="shrink-0 p-1 text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={addRule}>
                <Plus className="h-3 w-3" /> Adicionar condição
              </Button>
            </>
          )}

          {effType === 'branch_segment' && (
            <div className="space-y-1.5">
              <Label>Segmento</Label>
              <Select value={segmentId} onValueChange={setSegmentId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {segments.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {effType === 'branch_email_event' && (
            <>
              <div className="space-y-1.5">
                <Label>O contato...</Label>
                <Select value={emailCheck} onValueChange={setEmailCheck}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="delivered">Recebeu o email</SelectItem>
                    <SelectItem value="opened">Abriu o email</SelectItem>
                    <SelectItem value="clicked">Clicou no email</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>De qual email deste fluxo</Label>
                <Select value={sourceNodeId} onValueChange={setSourceNodeId}>
                  <SelectTrigger><SelectValue placeholder="Selecione o email" /></SelectTrigger>
                  <SelectContent>
                    {sendEmailNodes.map((n) => <SelectItem key={n.id} value={n.id}>{n.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                {sendEmailNodes.length === 0 && (
                  <p className="text-[11px] text-muted-foreground">Adicione um nó "Enviar email" antes desta condição.</p>
                )}
                <p className="text-[11px] text-muted-foreground">
                  A condição checa o estado AGORA e segue por Sim/Não. Ponha uma "espera" antes se
                  quiser dar tempo do contato receber/abrir/clicar.
                </p>
              </div>
              {emailCheck === 'opened' && (
                <div className="flex gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-md p-2.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <p>Aberturas são infladas por proteção de privacidade (Apple Mail pré-carrega o pixel). Para decisões críticas, prefira ramificar por <strong>clique</strong>.</p>
                </div>
              )}
            </>
          )}

          {type === 'apply_tag' && (
            <div className="space-y-1.5">
              <Label>Nome da tag</Label>
              <Input value={tagName} onChange={(e) => setTagName(e.target.value)} placeholder="ex: frio" />
              {normalizedTag && normalizedTag !== tagName && (
                <p className="text-[11px] text-muted-foreground">Será salva como "{normalizedTag}"</p>
              )}
            </div>
          )}

          {type === 'handoff_nexus' && (
            <div className="space-y-1.5">
              <Label>Estágio do pipeline no Nexus</Label>
              {stagesLoading ? (
                <p className="text-xs text-muted-foreground">Carregando estágios...</p>
              ) : (
                <Select value={stageId} onValueChange={setStageId}>
                  <SelectTrigger><SelectValue placeholder="Selecione o estágio" /></SelectTrigger>
                  <SelectContent>
                    {stages.filter((s) => !s.is_won && !s.is_lost).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={!isValid()}>Salvar passo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
