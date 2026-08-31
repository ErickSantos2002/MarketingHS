import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle } from 'lucide-react';
import { SegmentMultiSelect } from '@/components/admin/segments/SegmentMultiSelect';
import { EVENT_OPTIONS, type Journey } from '@/lib/journeys';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreate: (payload: Partial<Journey>) => Promise<Journey | null>;
  onCreated: (j: Journey) => void;
}

export function JourneyCreateDialog({ open, onOpenChange, onCreate, onCreated }: Props) {
  const [name, setName] = useState('');
  const [entryType, setEntryType] = useState<'segment' | 'event'>('segment');
  const [segmentIds, setSegmentIds] = useState<string[]>([]);
  const [excludedSegmentIds, setExcludedSegmentIds] = useState<string[]>([]);
  const [eventType, setEventType] = useState('');
  const [reentry, setReentry] = useState<'once' | 'allowed'>('once');
  // C1: cooldown em DIAS na UI (mais legível que horas); convertido para
  // reentry_cooldown_hours no envio. 7 dias casa com o DEFAULT do banco.
  const [cooldownDays, setCooldownDays] = useState(7);
  const [saving, setSaving] = useState(false);

  const canSave = name.trim() && (entryType === 'segment' ? segmentIds.length > 0 : !!eventType);
  const showReentryWarning = entryType === 'segment' && reentry === 'allowed';

  const handleSave = async () => {
    setSaving(true);
    const j = await onCreate({
      name: name.trim(),
      entry_type: entryType,
      entry_config: entryType === 'segment'
        ? { segment_ids: segmentIds, excluded_segment_ids: excludedSegmentIds }
        : { event_type: eventType },
      reentry,
      reentry_cooldown_hours: Math.max(1, Math.round(cooldownDays * 24)),
      nodes: [],
    });
    setSaving(false);
    if (j) { onOpenChange(false); onCreated(j); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Novo fluxo</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Nutrição de hot leads" />
          </div>

          <div className="space-y-1.5">
            <Label>Quando o contato entra no fluxo</Label>
            <Select value={entryType} onValueChange={(v) => setEntryType(v as 'segment' | 'event')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="segment">Quando está em um segmento</SelectItem>
                <SelectItem value="event">Quando acontece um evento</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {entryType === 'segment' ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Segmentos de entrada</Label>
                <SegmentMultiSelect
                  value={segmentIds}
                  onChange={setSegmentIds}
                  placeholder="Selecione ao menos um"
                  disabledIds={excludedSegmentIds}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Não inscrever quem estiver em (opcional)</Label>
                <SegmentMultiSelect
                  value={excludedSegmentIds}
                  onChange={setExcludedSegmentIds}
                  placeholder="Nenhuma exclusão"
                  disabledIds={segmentIds}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Entram <strong>todos que já estão em algum dos segmentos agora</strong> e{' '}
                <strong>todos que entrarem depois</strong>, menos quem estiver em algum
                segmento de exclusão. Os segmentos são reavaliados a cada minuto; quem
                passar a atender às regras é inscrito no fluxo (respeitando a reentrada
                abaixo).
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Evento</Label>
              <Select value={eventType} onValueChange={setEventType}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {EVENT_OPTIONS.map((e) => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Reentrada</Label>
            <Select value={reentry} onValueChange={(v) => setReentry(v as 'once' | 'allowed')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="once">Uma vez por contato</SelectItem>
                <SelectItem value="allowed">Pode entrar de novo</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {reentry === 'allowed' && (
            <div className="space-y-1.5">
              <Label>Intervalo mínimo antes de reentrar</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number" min={1} className="w-24"
                  value={cooldownDays}
                  onChange={(e) => setCooldownDays(Math.max(1, Number(e.target.value)))}
                />
                <span className="text-sm text-muted-foreground">dia(s)</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Depois que o contato terminar o fluxo, ele só pode entrar de novo depois desse tempo — mesmo que
                continue no critério de entrada. Sem esse intervalo, o mesmo contato reentraria a cada verificação
                (até a cada 1 minuto) e receberia os mesmos emails repetidamente.
              </p>
            </div>
          )}

          {showReentryWarning && (
            <div className="flex gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-md p-2.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <p>
                Este fluxo entra por <strong>segmento</strong> e permite <strong>reentrada</strong>. Se o segmento for
                permanente (ex.: "etiqueta = hotlead"), contatos que continuam atendendo à regra voltarão a entrar no
                fluxo — e a receber os mesmos emails — a cada intervalo configurado acima, indefinidamente.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>Criar e montar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
