import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { X, Plus, Search, Loader2, Users, Sparkles, Zap, CalendarIcon } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import type { DateRange } from 'react-day-picker';
import { supabase } from '@/integrations/supabase/client';
import { useSegments, type Segment, type SegmentRule } from '@/hooks/useSegments';
import { useCampaigns } from '@/hooks/useCampaigns';
import { STATUS_OPTIONS } from '@/components/admin/contacts/StatusBadge';

const FIELD_OPTIONS = [
  { value: 'tag', label: 'Etiqueta' },
  { value: 'qualificacao', label: 'Qualificação' },
  { value: 'status', label: 'Status' },
  { value: 'tipo', label: 'Modal' },
  { value: 'cargo', label: 'Cargo' },
  { value: 'faturamento', label: 'Faturamento' },
  { value: 'page_slug', label: 'Página' },
  { value: 'created_at', label: 'Criado nos últimos' },
  { value: 'last_conversion_date', label: 'Data de conversão' },
];

// Campo antigo `etiqueta` = coluna leads.etiqueta (hotlead/warm/raw), que é o
// MESMO dado do campo 'qualificacao'. Foi tirado da lista de campos novos (o
// rótulo "Etiqueta" agora significa as tags de lead_tags, igual à tela
// /contacts), mas continua suportado pelo backend e só aparece no seletor
// quando um segmento já salvo o utiliza — para não virar regra órfã.
const LEGACY_FIELD_OPTIONS = [
  { value: 'etiqueta', label: 'Qualificação (legado)' },
];

const UTM_FIELD_OPTIONS = [
  { value: 'utm_source', label: 'UTM Source' },
  { value: 'utm_medium', label: 'UTM Medium' },
  { value: 'utm_campaign', label: 'UTM Campaign' },
  { value: 'utm_content', label: 'UTM Content' },
  { value: 'utm_term', label: 'UTM Term' },
];

// Fase 5: grupo "Eventos de email" no seletor de campo. email_opened/
// email_clicked usam um select dependente de campanha (useCampaigns,
// filtrado a channel === 'email'); email_engagement usa dias, igual a
// created_at; event_type é genérico sobre contact_events (input livre).
const EVENT_FIELD_OPTIONS = [
  { value: 'email_opened', label: 'Abriu email da campanha' },
  { value: 'email_clicked', label: 'Clicou em link da campanha' },
  { value: 'email_engagement', label: 'Engajou com email nos últimos' },
];

// Filtro por histórico de interações (contact_events). O backend
// (build_segment_condition) já resolve `event_type` como
// EXISTS(... FROM contact_events WHERE lead_id = leads.id AND event_type = <valor>).
// Aqui expomos como grupo próprio com um select amigável dos eventos mais comuns.
const INTERACTION_FIELD_OPTIONS = [
  { value: 'event_type', label: 'Realizou o evento' },
];

const INTERACTION_EVENT_VALUES = [
  { value: 'activity_created', label: 'Atividade criada (Nexus)' },
  { value: 'activity_completed', label: 'Atividade concluída' },
  { value: 'activity_cancelled', label: 'Atividade cancelada' },
  { value: 'activity_no_show', label: 'Atividade no-show' },
  { value: 'activity_deleted', label: 'Atividade excluída' },
  { value: 'meeting_scheduled', label: 'Reunião agendada' },
  { value: 'scheduling_widget_booked', label: 'Agendou via widget' },
  { value: 'lead_qualified', label: 'Lead qualificado' },
  { value: 'deal_moved', label: 'Deal movido de etapa' },
  { value: 'deal_won', label: 'Deal ganho' },
  { value: 'deal_lost', label: 'Deal perdido' },
  { value: 'onboarding_started', label: 'Onboarding iniciado' },
  { value: 'conversion', label: 'Conversão em página' },
  { value: 'contact_updated', label: 'Contato atualizado' },
  { value: 'email_sent', label: 'Email enviado' },
  { value: 'email_bounced', label: 'Email retornou (bounce)' },
];

const OPERATORS: Record<string, { value: string; label: string }[]> = {
  tag: [{ value: 'is', label: 'tem' }, { value: 'is_not', label: 'não tem' }],
  etiqueta: [{ value: 'is', label: 'é' }, { value: 'is_not', label: 'não é' }],
  qualificacao: [{ value: 'is', label: 'é' }, { value: 'is_not', label: 'não é' }],
  status: [{ value: 'is', label: 'é' }, { value: 'is_not', label: 'não é' }],
  tipo: [{ value: 'is', label: 'é' }, { value: 'is_not', label: 'não é' }],
  cargo: [{ value: 'contains', label: 'contém' }, { value: 'not_contains', label: 'não contém' }],
  faturamento: [{ value: 'is', label: 'é' }, { value: 'is_not', label: 'não é' }],
  utm_source: [{ value: 'contains', label: 'contém' }, { value: 'exact', label: 'é exatamente' }],
  utm_medium: [{ value: 'contains', label: 'contém' }, { value: 'exact', label: 'é exatamente' }],
  utm_campaign: [{ value: 'contains', label: 'contém' }, { value: 'exact', label: 'é exatamente' }],
  utm_content: [{ value: 'contains', label: 'contém' }, { value: 'exact', label: 'é exatamente' }],
  utm_term: [{ value: 'contains', label: 'contém' }, { value: 'exact', label: 'é exatamente' }],
  page_slug: [{ value: 'exact', label: 'é exatamente' }],
  created_at: [],
  last_conversion_date: [],
  // Sem seletor de operador: build_segment_condition sempre gera um EXISTS
  // positivo para estes campos (mesmo padrão de page_slug/created_at).
  email_opened: [],
  email_clicked: [],
  email_engagement: [],
  event_type: [],
};

// Vocabulário que a RPC (build_segment_condition, migration
// 20260713250000) de fato mapeia: hot -> etiqueta = 'hotlead',
// warm -> etiqueta = 'warm', raw -> etiqueta IS NULL — combinado com o
// operador é/não é já existente em OPERATORS.qualificacao.
const QUALIFICACAO_VALUES = [
  { value: 'hot', label: 'Hot Lead' },
  { value: 'warm', label: 'Warm Lead' },
  { value: 'raw', label: 'Sem qualificação' },
];

// Só usado pelo campo legado 'etiqueta' (coluna leads.etiqueta).
const ETIQUETA_VALUES = ['hotlead', 'warm', 'raw'];
const TIPO_VALUES = [
  'convidado',
  'gratuito',
  'form_pago',
  'modal_pago',
  'modal_gratuito',
  'interesse_ecossistema',
  'Evento VIP',
  'Evento 14/04/26',
  'Lançamento 24 e 25Fev',
  'Programa IAficacao',
];
// Buckets canônicos de faturamento — cada valor mapeia (no backend, em
// build_segment_condition) para todas as variantes gravadas no banco
// (canônica, prosa antiga "Entre R$ ..." e slugs curtos).
const FATURAMENTO_VALUES = [
  { value: 'ate-100k', label: 'Até 100k/mês' },
  { value: '100k-500k', label: 'Entre 100k e 500k/mês' },
  { value: '500k-1mm', label: 'Entre 500k e 1MM/mês' },
  { value: '1mm-3mm', label: 'Entre 1MM e 3MM/mês' },
  { value: '3mm-5mm', label: 'Entre 3MM e 5MM/mês' },
  { value: 'acima-5mm', label: 'Acima de 5MM/mês' },
];
const DAYS_OPTIONS = ['7', '15', '30', '60', '90'];
const CUSTOM_RANGE = '__custom__';


interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  segment: Segment | null;
  onSaved?: () => void;
}

export function SegmentFormModal({ open, onOpenChange, segment, onSaved }: Props) {
  const { createSegment, updateSegment } = useSegments();
  const { campaigns } = useCampaigns();
  const emailCampaigns = campaigns.filter(c => c.channel === 'email');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<'dynamic' | 'static'>('dynamic');
  const [rules, setRules] = useState<SegmentRule[]>([]);
  // 'and' | 'or' (minúsculo) para casar com segments.logic / o parâmetro
  // p_logic da RPC preview_segment_rules — evita conversão de caixa em cada uso.
  const [logicOperator, setLogicOperator] = useState<'and' | 'or'>('and');
  const [saving, setSaving] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedLeads, setSelectedLeads] = useState<any[]>([]);

  // Etiquetas reais vinculadas aos contatos (tabela `tags`, ligada por
  // lead_tags) — as mesmas que a tela /contacts lista no filtro ETIQUETA.
  const [tags, setTags] = useState<{ id: string; name: string }[]>([]);

  const [previewLeads, setPreviewLeads] = useState<any[]>([]);
  const [previewCount, setPreviewCount] = useState(0);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    if (open) {
      if (segment) {
        setName(segment.name);
        setDescription(segment.description || '');
        setType(segment.type);
        setRules(segment.rules || []);
        setLogicOperator(segment.logic || 'and');
      } else {
        setName('');
        setDescription('');
        setType('dynamic');
        setRules([]);
        setLogicOperator('and');
        setSelectedLeads([]);
        setPreviewLeads([]);
        setPreviewCount(0);
      }
      setSearchQuery('');
      setSearchResults([]);
    }
  }, [open, segment]);

  useEffect(() => {
    if (!open) return;
    supabase
      .from('tags')
      .select('id, name')
      .order('name')
      .then(({ data }) => setTags(data || []));
  }, [open]);

  useEffect(() => {
    if (type !== 'static' || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      const q = `%${searchQuery}%`;
      const { data } = await supabase
        .from('leads')
        .select('id, nome, email, whatsapp, cargo, etiqueta')
        .or(`nome.ilike.${q},email.ilike.${q},whatsapp.ilike.${q}`)
        .limit(20);
      setSearchResults(data || []);
      setSearching(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery, type]);

  const isValidRule = (r: SegmentRule) => {
    if (!r.field || !r.value) return false;
    // Range parcial (ex.: "..2026-01-01" ou "2026-01-01..") não deve ser
    // enviado ao backend — build_segment_condition regeneraria SQL inválido.
    if ((r.field === 'created_at' || r.field === 'last_conversion_date') && r.value.includes('..')) {
      const [a, b] = r.value.split('..');
      if (!a || !b) return false;
    }
    return true;
  };

  const runPreview = useCallback(async () => {
    const validRules = rules.filter(isValidRule);

    if (type !== 'dynamic' || validRules.length === 0) {
      setPreviewLeads([]);
      setPreviewCount(0);
      return;
    }
    setPreviewing(true);

    // Fase 5: caminho ÚNICO de preview, tanto para segmentos novos quanto
    // salvos — elimina a reimplementação client-side que existia aqui e que
    // divergia da lógica real do backend (era a causa raiz do bug do campo
    // 'qualificacao': a versão antiga do backend caía em "ELSE NULL" / nenhum
    // filtro para qualquer valor fora de 'hotlead'/'not_hotlead', enquanto o
    // preview client-side aplicava um filtro diferente). preview_segment_rules
    // reusa o MESMO helper (build_segment_condition) que evaluate_segment_rules,
    // então o preview agora é exatamente o que o envio (send-campaign) resolve.
    // RPC ainda não está em types.ts (Fase 5) — cast sancionado.
    const { data, error } = await (supabase.rpc as any)('preview_segment_rules', {
      p_rules: validRules,
      p_logic: logicOperator,
    });

    if (error) {
      console.error('preview_segment_rules error:', error);
      setPreviewLeads([]);
      setPreviewCount(0);
      setPreviewing(false);
      return;
    }

    // A RPC devolve só os lead_ids (é deles que sai a contagem exata, mesmo
    // padrão de evaluate_segment_rules em useSegments). Só as 5 primeiras
    // linhas de `leads` são de fato buscadas — a lista completa de leads nunca
    // trafega, nem em segmentos grandes.
    const rows = (data || []) as { lead_id: string }[];
    const ids = rows.map(r => r.lead_id).slice(0, 5);
    if (ids.length > 0) {
      const { data: leads } = await supabase.from('leads').select('id, nome, etiqueta').in('id', ids);
      setPreviewLeads(leads || []);
    } else {
      setPreviewLeads([]);
    }
    setPreviewCount(rows.length);
    setPreviewing(false);
  }, [type, rules, logicOperator]);

  useEffect(() => {
    const timer = setTimeout(runPreview, 800);
    return () => clearTimeout(timer);
  }, [runPreview]);

  const addRule = () => setRules([...rules, { field: '', operator: '', value: '' }]);
  const removeRule = (i: number) => setRules(rules.filter((_, idx) => idx !== i));
  const updateRule = (i: number, patch: Partial<SegmentRule>) => {
    const updated = [...rules];
    updated[i] = { ...updated[i], ...patch };
    if (patch.field) {
      updated[i].operator = OPERATORS[patch.field]?.[0]?.value || '';
      updated[i].value = '';
    }
    setRules(updated);
  };

  const toggleLead = (lead: any) => {
    if (selectedLeads.find(l => l.id === lead.id)) {
      setSelectedLeads(selectedLeads.filter(l => l.id !== lead.id));
    } else {
      setSelectedLeads([...selectedLeads, lead]);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    // Descarta regras incompletas (sem campo ou sem valor) — o MESMO filtro que
    // runPreview aplica. Sem isso, uma regra pela metade era persistida: o
    // preview a ignorava (mostrando N contatos), mas no envio o backend a
    // avaliava e ela resolvia para zero — preview e envio discordavam.
    const cleanRules = rules.filter(isValidRule);
    if (segment) {
      await updateSegment(segment.id, name, description, type, cleanRules, selectedLeads.map(l => l.id), logicOperator);
    } else {
      await createSegment(name, description, type, cleanRules, selectedLeads.map(l => l.id), logicOperator);
    }
    setSaving(false);
    onOpenChange(false);
    onSaved?.();
  };

  const renderValueInput = (rule: SegmentRule, index: number) => {
    if (rule.field === 'tag') {
      // Guarda o id da tag (não o nome): renomear a etiqueta não quebra o
      // segmento. build_segment_condition aceita id ou nome no ramo 'tag'.
      return (
        <Select value={rule.value} onValueChange={v => updateRule(index, { value: v })}>
          <SelectTrigger className="flex-1 min-w-[160px] "><SelectValue placeholder="Etiqueta" /></SelectTrigger>
          <SelectContent>
            {tags.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground">Nenhuma etiqueta cadastrada</p>
            )}
            {tags.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    }
    if (rule.field === 'etiqueta') {
      return (
        <Select value={rule.value} onValueChange={v => updateRule(index, { value: v })}>
          <SelectTrigger className="flex-1 min-w-[120px] "><SelectValue placeholder="Valor" /></SelectTrigger>
          <SelectContent>
            {ETIQUETA_VALUES.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    }
    if (rule.field === 'status') {
      return (
        <Select value={rule.value} onValueChange={v => updateRule(index, { value: v })}>
          <SelectTrigger className="flex-1 min-w-[120px] "><SelectValue placeholder="Valor" /></SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    }
    if (rule.field === 'qualificacao') {
      return (
        <Select value={rule.value} onValueChange={v => updateRule(index, { value: v })}>
          <SelectTrigger className="flex-1 min-w-[140px] "><SelectValue placeholder="Qualificação" /></SelectTrigger>
          <SelectContent>
            {QUALIFICACAO_VALUES.map(v => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    }
    if (rule.field === 'tipo') {
      return (
        <Select value={rule.value} onValueChange={v => updateRule(index, { value: v })}>
          <SelectTrigger className="flex-1 min-w-[140px] "><SelectValue placeholder="Modal" /></SelectTrigger>
          <SelectContent>
            {TIPO_VALUES.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    }
    if (rule.field === 'faturamento') {
      return (
        <Select value={rule.value} onValueChange={v => updateRule(index, { value: v })}>
          <SelectTrigger className="flex-1 min-w-[180px] "><SelectValue placeholder="Faixa" /></SelectTrigger>
          <SelectContent>
            {FATURAMENTO_VALUES.map(v => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    }
    if (rule.field === 'created_at' || rule.field === 'last_conversion_date') {
      // Reconhece range gravado como "YYYY-MM-DD..YYYY-MM-DD"
      const isCustom = (rule.value || '').includes('..');
      const [rFrom, rTo] = isCustom ? (rule.value || '..').split('..') : ['', ''];
      const selectValue = isCustom
        ? CUSTOM_RANGE
        : (DAYS_OPTIONS.includes(rule.value) ? rule.value : '');
      return (
        <div className="flex-1 flex items-center gap-1.5 flex-wrap min-w-[220px]">
          <Select
            value={selectValue}
            onValueChange={v => updateRule(index, { value: v === CUSTOM_RANGE ? '..' : v })}
          >
            <SelectTrigger className="w-[130px] text-xs h-8"><SelectValue placeholder="Período" /></SelectTrigger>
            <SelectContent>
              {DAYS_OPTIONS.map(v => <SelectItem key={v} value={v}>Últimos {v} dias</SelectItem>)}
              <SelectSeparator />
              <SelectItem value={CUSTOM_RANGE}>Personalizado</SelectItem>
            </SelectContent>
          </Select>
          {isCustom && (() => {
            const parseDay = (s: string) => {
              if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
              try { return parseISO(s); } catch { return undefined; }
            };
            const range: DateRange = {
              from: parseDay(rFrom),
              to: parseDay(rTo),
            };
            const label = range.from && range.to
              ? `${format(range.from, "dd/MM/yy", { locale: ptBR })} — ${format(range.to, "dd/MM/yy", { locale: ptBR })}`
              : range.from
                ? `${format(range.from, "dd/MM/yy", { locale: ptBR })} — ...`
                : 'Selecione o período';
            return (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "h-8 text-xs justify-start gap-1.5 font-normal",
                      !range.from && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="h-3.5 w-3.5" />
                    {label}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 pointer-events-auto" align="start">
                  <Calendar
                    mode="range"
                    numberOfMonths={2}
                    selected={range}
                    onSelect={(r) => {
                      const f = r?.from ? format(r.from, 'yyyy-MM-dd') : '';
                      const t = r?.to ? format(r.to, 'yyyy-MM-dd') : '';
                      updateRule(index, { value: `${f}..${t}` });
                    }}
                    initialFocus
                    locale={ptBR}
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            );
          })()}
        </div>
      );
    }
    if (rule.field === 'email_engagement') {
      return (
        <Select value={rule.value} onValueChange={v => updateRule(index, { value: v })}>
          <SelectTrigger className="flex-1 min-w-[120px] "><SelectValue placeholder="Dias" /></SelectTrigger>
          <SelectContent>
            {DAYS_OPTIONS.map(v => <SelectItem key={v} value={v}>{v} dias</SelectItem>)}
          </SelectContent>
        </Select>
      );
    }

    if (rule.field === 'email_opened' || rule.field === 'email_clicked') {
      return (
        <Select value={rule.value} onValueChange={v => updateRule(index, { value: v })}>
          <SelectTrigger className="flex-1 min-w-[140px] "><SelectValue placeholder="Campanha" /></SelectTrigger>
          <SelectContent>
            {emailCampaigns.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground">Nenhuma campanha de email</p>
            )}
            {emailCampaigns.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    }
    if (rule.field === 'event_type') {
      return (
        <Select value={rule.value} onValueChange={v => updateRule(index, { value: v })}>
          <SelectTrigger className="flex-1 min-w-[180px]"><SelectValue placeholder="Evento" /></SelectTrigger>
          <SelectContent>
            {INTERACTION_EVENT_VALUES.map(v => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    }
    return (
      <Input
        value={rule.value}
        onChange={e => updateRule(index, { value: e.target.value })}
        placeholder="Valor"
        className="flex-1 min-w-[120px] "
      />
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[1140px] max-h-[88vh] overflow-hidden p-0 border-border bg-card backdrop-blur-2xl shadow-[0_0_80px_-20px_hsl(var(--primary)/0.15)]">
        {/* Aurora glow effects */}
        <div className="pointer-events-none absolute -top-40 -right-40 w-80 h-80 rounded-full bg-primary/5 blur-[100px]" />
        <div className="pointer-events-none absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-accent/5 blur-[100px]" />

        <DialogHeader className="relative p-6 pb-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 border border-border/70 flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-lg font-semibold font-[Rajdhani]">{segment ? 'Editar segmento' : 'Novo segmento'}</DialogTitle>
              <DialogDescription className="text-xs">
                {segment ? 'Atualize as configurações do segmento' : 'Defina regras para agrupar contatos'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-[55%_45%] gap-0 border-t border-border/70 overflow-y-auto max-h-[calc(88vh-160px)]">
          {/* Left column — Form */}
          <div className="p-6 space-y-5 border-r border-border/70">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Nome *</Label>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Ex: Hot leads últimos 30 dias"
                className="transition-colors"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Descrição</Label>
              <Textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Opcional"
                rows={2}
                className="transition-colors resize-none"
              />
            </div>

            {/* Type toggle — glass pills */}
            <div className="flex gap-1 p-1 bg-background/60 border border-border/70 rounded-lg w-fit">
              <button
                onClick={() => setType('dynamic')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  type === 'dynamic'
                    ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/20'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Zap className="h-3 w-3" /> Dinâmico
              </button>
              <button
                onClick={() => setType('static')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  type === 'static'
                    ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/20'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Users className="h-3 w-3" /> Estático
              </button>
            </div>

            {type === 'dynamic' ? (
              <div className="space-y-3">
                {/* Operador — só faz sentido a partir da 2ª regra */}
                {rules.length >= 2 && (
                  <div className="flex items-center gap-2">
                    <div className="flex gap-0.5 p-0.5 bg-background/60 border border-border/70 rounded-md">
                      <button
                        onClick={() => setLogicOperator('and')}
                        className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-all ${
                          logicOperator === 'and'
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        E
                      </button>
                      <button
                        onClick={() => setLogicOperator('or')}
                        className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-all ${
                          logicOperator === 'or'
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        OU
                      </button>
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      {logicOperator === 'and'
                        ? 'o contato precisa atender a todas as regras'
                        : 'basta atender a qualquer uma das regras'}
                    </span>
                  </div>
                )}

                {/* Rules */}
                <div className="space-y-2">
                  {rules.map((rule, i) => (
                    <div key={i} className="flex items-center gap-1.5 p-2 rounded-lg bg-background/40 border border-border/70">
                      <Select value={rule.field} onValueChange={v => updateRule(i, { field: v })}>
                        <SelectTrigger className="w-[120px] text-xs h-8">
                          <SelectValue placeholder="Campo" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {FIELD_OPTIONS.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                            {rules.some(r => r.field === 'etiqueta') &&
                              LEGACY_FIELD_OPTIONS.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                          </SelectGroup>
                          <SelectSeparator />
                          <SelectGroup>
                            <SelectLabel>UTMs</SelectLabel>
                            {UTM_FIELD_OPTIONS.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                          </SelectGroup>
                          <SelectSeparator />
                          <SelectGroup>
                            <SelectLabel>Histórico de interações</SelectLabel>
                            {INTERACTION_FIELD_OPTIONS.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                          </SelectGroup>
                          <SelectSeparator />
                          <SelectGroup>
                            <SelectLabel>Eventos de email</SelectLabel>
                            {EVENT_FIELD_OPTIONS.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                          </SelectGroup>
                        </SelectContent>
                      </Select>

                      {rule.field && OPERATORS[rule.field]?.length > 0 && (
                        <Select value={rule.operator} onValueChange={v => updateRule(i, { operator: v })}>
                          <SelectTrigger className="w-[100px] text-xs h-8">
                            <SelectValue placeholder="Op" />
                          </SelectTrigger>
                          <SelectContent>
                            {OPERATORS[rule.field].map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}

                      {rule.field && renderValueInput(rule, i)}

                      <button
                        onClick={() => removeRule(i)}
                        className="shrink-0 p-1 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  onClick={addRule}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-dashed border-border text-xs font-medium text-muted-foreground hover:border-primary/50 hover:text-primary hover:bg-primary/5 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {rules.length === 0 ? 'Adicionar a primeira regra' : 'Adicionar regra'}
                </button>

                {rules.length === 0 && (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Um segmento dinâmico se atualiza sozinho: quem passar a atender às
                    regras entra, quem deixar de atender sai. Combine atributos do
                    contato (etiqueta, cargo, origem) com eventos de email (abriu ou
                    clicou numa campanha).
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Buscar por nome, email ou telefone..."
                    className="pl-9 "
                  />
                </div>

                {searching && <p className="text-xs text-muted-foreground animate-pulse">Buscando...</p>}

                {searchResults.length > 0 && (
                  <div className="border border-border/70 rounded-lg max-h-40 overflow-y-auto divide-y divide-border/70 bg-background/30">
                    {searchResults.map(lead => {
                      const isSelected = selectedLeads.some(l => l.id === lead.id);
                      return (
                        <label key={lead.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/30 cursor-pointer text-sm transition-colors">
                          <Checkbox checked={isSelected} onCheckedChange={() => toggleLead(lead)} />
                          <span className="truncate">{lead.nome || lead.email || 'Sem nome'}</span>
                          {lead.etiqueta && <Badge variant="secondary" className="text-[10px] shrink-0">{lead.etiqueta}</Badge>}
                        </label>
                      );
                    })}
                  </div>
                )}

                {selectedLeads.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">{selectedLeads.length} contatos selecionados</p>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedLeads.map(lead => (
                        <Badge key={lead.id} variant="secondary" className="gap-1 pr-1 bg-primary/10 border-primary/20 text-foreground">
                          {lead.nome || lead.email || 'Lead'}
                          <button onClick={() => toggleLead(lead)} className="hover:bg-destructive/20 rounded-full p-0.5 transition-colors">
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right column — Preview with aurora glow */}
          <div className="relative p-6 overflow-hidden">
            {/* Subtle radial glow behind count */}
            <div className="pointer-events-none absolute top-10 right-10 w-40 h-40 rounded-full bg-primary/5 blur-[60px]" />

            <h4 className="text-[10px] uppercase tracking-widest text-muted-foreground mb-4 font-semibold">Preview</h4>

            {type === 'dynamic' ? (
              previewing ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" /> Calculando...
                </div>
              ) : rules.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <div className="w-12 h-12 rounded-full bg-muted/30 flex items-center justify-center mb-3">
                    <Users className="h-5 w-5 text-muted-foreground/50" />
                  </div>
                  <p className="text-sm text-muted-foreground">Adicione regras para ver o preview</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Big count */}
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-bold font-[Rajdhani] bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                      {previewCount}
                    </span>
                    <span className="text-xs text-muted-foreground">contatos correspondem</span>
                  </div>

                  {/* Contact list */}
                  {previewLeads.length > 0 && (
                    <div className="space-y-1 border-t border-border/70 pt-3">
                      {previewLeads.map(l => (
                        <div key={l.id} className="flex items-center gap-2 text-sm py-1.5 px-2 rounded-md hover:bg-muted/20 transition-colors">
                          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                            {(l.nome || '?')[0]?.toUpperCase()}
                          </div>
                          <span className="truncate flex-1">{l.nome || 'Sem nome'}</span>
                          {l.etiqueta && (
                            <Badge variant="secondary" className="text-[9px] bg-primary/10 border-primary/20">{l.etiqueta}</Badge>
                          )}
                        </div>
                      ))}
                      {previewCount > 5 && (
                        <p className="text-xs text-muted-foreground pl-2 pt-1">e mais {previewCount - 5} contatos...</p>
                      )}
                    </div>
                  )}
                  {previewCount === 0 && (
                    <p className="text-sm text-muted-foreground">Nenhum contato corresponde a estas regras</p>
                  )}
                </div>
              )
            ) : (
              <div className="space-y-4">
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-bold font-[Rajdhani] bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                    {selectedLeads.length}
                  </span>
                  <span className="text-xs text-muted-foreground">contatos selecionados</span>
                </div>
                {selectedLeads.length > 0 && (
                  <div className="space-y-1 border-t border-border/70 pt-3">
                    {selectedLeads.slice(0, 5).map(l => (
                      <div key={l.id} className="flex items-center gap-2 text-sm py-1.5 px-2 rounded-md">
                        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                          {(l.nome || l.email || '?')[0]?.toUpperCase()}
                        </div>
                        <span className="truncate">{l.nome || l.email || 'Lead'}</span>
                      </div>
                    ))}
                    {selectedLeads.length > 5 && (
                      <p className="text-xs text-muted-foreground pl-2 pt-1">e mais {selectedLeads.length - 5}...</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-border/70">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-muted-foreground">Cancelar</Button>
          <Button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 shadow-lg shadow-primary/10"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Salvar segmento
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
