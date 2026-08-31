import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { X, CalendarIcon, RefreshCw, UserCheck, CalendarCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { STATUS_OPTIONS } from './StatusBadge';
import type { TagInfo, ContactsFilters } from '@/hooks/useContactsEnriched';
import type { DashboardFilters, DatePreset } from '@/hooks/useDashboardFilters';
import type { QualificationSegment } from '@/hooks/useLeadQualification';
import type { DeletedView } from '@/hooks/useLeads';

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'all', label: 'Todo período' },
  { value: 'today', label: 'Hoje' },
  { value: 'yesterday', label: 'Ontem' },
  { value: 'last7days', label: 'Últimos 7 dias' },
  { value: 'last30days', label: 'Últimos 30 dias' },
  { value: 'thisMonth', label: 'Este mês' },
  { value: 'custom', label: 'Personalizado' },
];

const QUALIFICATION_OPTIONS: { value: QualificationSegment; label: string }[] = [
  { value: 'hot', label: 'Hot Lead' },
  { value: 'warm', label: 'Warm Lead' },
  { value: 'raw', label: 'Raw Lead' },
];


interface UnifiedFilterPanelProps {
  // Local (contacts) filters
  contactsFilters: ContactsFilters;
  onContactsChange: (filters: ContactsFilters) => void;
  allTags: TagInfo[];
  // Global (dashboard) filters
  dashboardFilters: DashboardFilters;
  onDashboardUpdate: (updates: Partial<DashboardFilters>) => void;
  onSetDatePreset: (preset: DatePreset) => void;
  onSetCustomDateRange: (from: Date | null, to: Date | null) => void;
  onSetCreatedDatePreset: (preset: DatePreset) => void;
  onSetCustomCreatedDateRange: (from: Date | null, to: Date | null) => void;
  onResetAll: () => void;
  // Available options for multi-selects
  availableTipos: string[];
  availableCampaigns: string[];
  availableSources: string[];
  availableUtmContents: string[];
  availableFaturamentos: string[];
  availableCargos: string[];
  // Deleted view
  deletedView: DeletedView;
  onDeletedViewChange: (v: DeletedView) => void;
  // State
  open: boolean;
  onClose: () => void;
}

export function ContactsFilterPanel({
  contactsFilters, onContactsChange, allTags,
  dashboardFilters, onDashboardUpdate, onSetDatePreset, onSetCustomDateRange,
  onSetCreatedDatePreset, onSetCustomCreatedDateRange, onResetAll,
  availableTipos, availableCampaigns, availableSources, availableUtmContents, availableFaturamentos, availableCargos,
  deletedView, onDeletedViewChange,
  open, onClose,
}: UnifiedFilterPanelProps) {
  const [localContacts, setLocalContacts] = useState(contactsFilters);
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [createdDatePopoverOpen, setCreatedDatePopoverOpen] = useState(false);

  useEffect(() => {
    setLocalContacts(contactsFilters);
  }, [contactsFilters, open]);

  if (!open) return null;

  const platformValue = localContacts.hasNexus && localContacts.hasMentoria
    ? 'both'
    : localContacts.hasNexus ? 'nexus'
    : localContacts.hasMentoria ? 'mentoria'
    : 'all';

  const handlePlatformChange = (val: string) => {
    setLocalContacts({
      ...localContacts,
      hasNexus: val === 'nexus' || val === 'both',
      hasMentoria: val === 'mentoria' || val === 'both',
    });
  };

  const handleApply = () => {
    onContactsChange(localContacts);
    onClose();
  };

  const handleClearAll = () => {
    setLocalContacts({ statuses: [], tagIds: [], hasNexus: false, hasMentoria: false, hasScheduled: false });
    onContactsChange({ statuses: [], tagIds: [], hasNexus: false, hasMentoria: false, hasScheduled: false });
    onResetAll();
  };

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4 animate-in slide-in-from-top-2 duration-200">
      {/* Row 1: Última conversão + Data de cadastro + Modal + Campanha */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Última conversão */}
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Última conversão</Label>
          <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn("h-9 w-full justify-between", dashboardFilters.datePreset !== 'all' && "border-primary/50 bg-primary/5 text-primary")}
              >
                <span className="flex items-center min-w-0 truncate">
                  <CalendarIcon className="mr-2 h-4 w-4 flex-shrink-0" />
                  <span className="truncate">
                    {dashboardFilters.datePreset === 'custom' && dashboardFilters.dateFrom && dashboardFilters.dateTo
                      ? `${format(dashboardFilters.dateFrom, 'dd/MM', { locale: ptBR })} - ${format(dashboardFilters.dateTo, 'dd/MM', { locale: ptBR })}`
                      : DATE_PRESETS.find(p => p.value === dashboardFilters.datePreset)?.label}
                  </span>
                </span>
                {dashboardFilters.datePreset !== 'all' && (
                  <Badge className="ml-1 bg-primary/20 text-primary text-[10px] px-1.5 h-4">1</Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <div className="flex">
                <div className="border-r p-2 space-y-1">
                  {DATE_PRESETS.map(preset => (
                    <button
                      key={preset.value}
                      onClick={() => {
                        onSetDatePreset(preset.value);
                        if (preset.value !== 'custom') setDatePopoverOpen(false);
                      }}
                      className={cn(
                        "w-full text-left px-3 py-2 rounded-md text-sm transition-colors whitespace-nowrap",
                        dashboardFilters.datePreset === preset.value ? "bg-primary/20 text-primary" : "hover:bg-muted"
                      )}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                {dashboardFilters.datePreset === 'custom' && (
                  <div className="p-2">
                    <Calendar
                      mode="range"
                      selected={{ from: dashboardFilters.dateFrom || undefined, to: dashboardFilters.dateTo || undefined }}
                      onSelect={(range) => {
                        onSetCustomDateRange(range?.from || null, range?.to || null);
                        if (range?.from && range?.to) setDatePopoverOpen(false);
                      }}
                      locale={ptBR}
                      className="rounded-md pointer-events-auto"
                    />
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Data de cadastro */}
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Data de cadastro</Label>
          <Popover open={createdDatePopoverOpen} onOpenChange={setCreatedDatePopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn("h-9 w-full justify-between", dashboardFilters.createdDatePreset !== 'all' && "border-primary/50 bg-primary/5 text-primary")}
              >
                <span className="flex items-center min-w-0 truncate">
                  <CalendarIcon className="mr-2 h-4 w-4 flex-shrink-0" />
                  <span className="truncate">
                    {dashboardFilters.createdDatePreset === 'custom' && dashboardFilters.createdDateFrom && dashboardFilters.createdDateTo
                      ? `${format(dashboardFilters.createdDateFrom, 'dd/MM', { locale: ptBR })} - ${format(dashboardFilters.createdDateTo, 'dd/MM', { locale: ptBR })}`
                      : DATE_PRESETS.find(p => p.value === dashboardFilters.createdDatePreset)?.label}
                  </span>
                </span>
                {dashboardFilters.createdDatePreset !== 'all' && (
                  <Badge className="ml-1 bg-primary/20 text-primary text-[10px] px-1.5 h-4">1</Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <div className="flex">
                <div className="border-r p-2 space-y-1">
                  {DATE_PRESETS.map(preset => (
                    <button
                      key={preset.value}
                      onClick={() => {
                        onSetCreatedDatePreset(preset.value);
                        if (preset.value !== 'custom') setCreatedDatePopoverOpen(false);
                      }}
                      className={cn(
                        "w-full text-left px-3 py-2 rounded-md text-sm transition-colors whitespace-nowrap",
                        dashboardFilters.createdDatePreset === preset.value ? "bg-primary/20 text-primary" : "hover:bg-muted"
                      )}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                {dashboardFilters.createdDatePreset === 'custom' && (
                  <div className="p-2">
                    <Calendar
                      mode="range"
                      selected={{ from: dashboardFilters.createdDateFrom || undefined, to: dashboardFilters.createdDateTo || undefined }}
                      onSelect={(range) => {
                        onSetCustomCreatedDateRange(range?.from || null, range?.to || null);
                        if (range?.from && range?.to) setCreatedDatePopoverOpen(false);
                      }}
                      locale={ptBR}
                      className="rounded-md pointer-events-auto"
                    />
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Modal / Tipo */}
        <MultiSelectField
          label="MODAL"
          options={availableTipos}
          selected={dashboardFilters.tipos}
          onChange={(tipos) => onDashboardUpdate({ tipos })}
        />

        {/* Campaign */}
        <MultiSelectField
          label="CAMPANHA"
          options={availableCampaigns}
          selected={dashboardFilters.campaigns}
          onChange={(campaigns) => onDashboardUpdate({ campaigns })}
        />
      </div>

      {/* Row 2: Status + Etiqueta + Faturamento + Cargo */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MultiSelectField
          label="STATUS"
          options={STATUS_OPTIONS as unknown as string[]}
          selected={localContacts.statuses}
          onChange={(statuses) => setLocalContacts({ ...localContacts, statuses })}
        />

        <MultiSelectIdField
          label="ETIQUETA"
          options={allTags.map(t => ({ value: t.id, label: t.name }))}
          selected={localContacts.tagIds}
          onChange={(tagIds) => setLocalContacts({ ...localContacts, tagIds })}
        />

        <MultiSelectField
          label="FATURAMENTO"
          options={availableFaturamentos}
          selected={dashboardFilters.faturamentos}
          onChange={(faturamentos) => onDashboardUpdate({ faturamentos })}
        />

        <MultiSelectField
          label="CARGO"
          options={availableCargos}
          selected={dashboardFilters.cargos}
          onChange={(cargos) => onDashboardUpdate({ cargos })}
        />
      </div>

      {/* Row 3: Origem + Plataforma + Qualificação */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MultiSelectField
          label="ORIGEM"
          options={availableSources}
          selected={dashboardFilters.sources || []}
          onChange={(sources) => onDashboardUpdate({ sources })}
        />

        <FilterSelect
          label="PLATAFORMA"
          value={platformValue}
          onValueChange={handlePlatformChange}
          options={[
            { value: 'all', label: 'Todas' },
            { value: 'nexus', label: 'No Nexus' },
            { value: 'mentoria', label: 'No mentor.ia' },
            { value: 'both', label: 'Nos dois' },
          ]}
        />

        <QualificationField
          label="QUALIFICAÇÃO"
          qualifications={dashboardFilters.qualifications}
          onChange={(qualifications) => onDashboardUpdate({ qualifications })}
          hasScheduled={localContacts.hasScheduled}
          onScheduledChange={(hasScheduled) => setLocalContacts({ ...localContacts, hasScheduled })}
        />
      </div>

      {/* Row 4: UTM Content + Visualização + Toggles */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <MultiSelectField
          label="UTM CONTENT"
          options={availableUtmContents}
          selected={dashboardFilters.utmContents || []}
          onChange={(utmContents) => onDashboardUpdate({ utmContents })}
        />


        <FilterSelect
          label="VISUALIZAÇÃO"
          value={deletedView}
          onValueChange={(v) => onDeletedViewChange(v as DeletedView)}
          options={[
            { value: 'active', label: 'Ativos' },
            { value: 'deleted', label: 'Apenas apagados' },
            { value: 'all', label: 'Todos (inclui apagados)' },
          ]}
        />

        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Opções</Label>
          <div className="flex flex-col gap-2 pt-1">
            <div className="flex items-center gap-2">
              <Checkbox
                id="hide-incomplete-panel"
                checked={!!dashboardFilters.hideIncomplete}
                onCheckedChange={(checked) => onDashboardUpdate({ hideIncomplete: !!checked })}
              />
              <Label htmlFor="hide-incomplete-panel" className="text-xs text-muted-foreground cursor-pointer flex items-center gap-1">
                <UserCheck className="h-3 w-3" /> Só completos
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="only-reconversions-panel"
                checked={!!dashboardFilters.onlyReconversions}
                onCheckedChange={(checked) => onDashboardUpdate({ onlyReconversions: !!checked })}
              />
              <Label htmlFor="only-reconversions-panel" className="text-xs text-muted-foreground cursor-pointer flex items-center gap-1">
                <RefreshCw className="h-3 w-3" /> Só reconversões
              </Label>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/50">
        <Button variant="ghost" size="sm" onClick={handleClearAll} className="text-muted-foreground">
          Limpar tudo
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancelar
        </Button>
        <Button size="sm" onClick={handleApply} style={{ backgroundColor: '#534AB7' }} className="text-white">
          Aplicar filtros →
        </Button>
      </div>
    </div>
  );
}

/* ── Filter Select ── */
function FilterSelect({
  label, value, onValueChange, options,
}: {
  label: string;
  value: string;
  onValueChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(opt => (
            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/* ── Multi-select field (popover with checkmarks) ── */
function MultiSelectField({
  label, options, selected, onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
}) {
  const toggle = (opt: string) => {
    onChange(selected.includes(opt) ? selected.filter(s => s !== opt) : [...selected, opt]);
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className={cn("h-9 w-full justify-between", selected.length > 0 && "border-primary/50 bg-primary/5")}>
            <span className="truncate text-left">
              {selected.length > 0 ? `${selected.length} selecionado${selected.length > 1 ? 's' : ''}` : 'Todos'}
            </span>
            {selected.length > 0 && (
              <Badge className="ml-1 bg-primary/20 text-primary text-[10px] px-1.5 h-4">{selected.length}</Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2" align="start">
          <div className="max-h-60 overflow-y-auto space-y-0.5">
            {options.map(opt => (
              <button
                key={opt}
                onClick={() => toggle(opt)}
                className={cn(
                  "w-full text-left px-3 py-1.5 rounded-md text-sm transition-colors",
                  selected.includes(opt) ? "bg-primary/20 text-primary" : "hover:bg-muted"
                )}
              >
                {opt}
              </button>
            ))}
            {options.length === 0 && <p className="text-sm text-muted-foreground px-3 py-2">Nenhuma opção</p>}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function MultiSelectIdField({
  label, options, selected, onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (selected: string[]) => void;
}) {
  const toggle = (v: string) => {
    onChange(selected.includes(v) ? selected.filter(s => s !== v) : [...selected, v]);
  };
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className={cn("h-9 w-full justify-between", selected.length > 0 && "border-primary/50 bg-primary/5")}>
            <span className="truncate text-left">
              {selected.length > 0 ? `${selected.length} selecionado${selected.length > 1 ? 's' : ''}` : 'Todas'}
            </span>
            {selected.length > 0 && (
              <Badge className="ml-1 bg-primary/20 text-primary text-[10px] px-1.5 h-4">{selected.length}</Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2" align="start">
          <div className="max-h-60 overflow-y-auto space-y-0.5">
            {options.map(opt => (
              <button
                key={opt.value}
                onClick={() => toggle(opt.value)}
                className={cn(
                  "w-full text-left px-3 py-1.5 rounded-md text-sm transition-colors",
                  selected.includes(opt.value) ? "bg-primary/20 text-primary" : "hover:bg-muted"
                )}
              >
                {opt.label}
              </button>
            ))}
            {options.length === 0 && <p className="text-sm text-muted-foreground px-3 py-2">Nenhuma etiqueta</p>}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/* ── Qualification field ── */
function QualificationField({
  label, qualifications, onChange, hasScheduled, onScheduledChange,
}: {
  label: string;
  qualifications: QualificationSegment[];
  onChange: (q: QualificationSegment[]) => void;
  hasScheduled?: boolean;
  onScheduledChange?: (v: boolean) => void;
}) {
  const toggle = (val: QualificationSegment) => {
    onChange(qualifications.includes(val) ? qualifications.filter(q => q !== val) : [...qualifications, val]);
  };

  const buttonLabel = (() => {
    const parts: string[] = [];
    qualifications.forEach(q => parts.push(q === 'hot' ? 'Hot' : q === 'warm' ? 'Warm' : 'Raw'));
    if (hasScheduled) parts.push('Agendados');
    return parts.length > 0 ? parts.join(', ') : 'Todos';
  })();

  const activeCount = qualifications.length + (hasScheduled ? 1 : 0);

  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className={cn("h-9 w-full justify-between", activeCount > 0 && "border-primary/50 bg-primary/5")}>
            <span className="truncate text-left">{buttonLabel}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-2" align="start">
          <div className="space-y-0.5">
            {QUALIFICATION_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => toggle(opt.value)}
                className={cn(
                  "w-full text-left px-3 py-1.5 rounded-md text-sm transition-colors",
                  qualifications.includes(opt.value) ? "bg-primary/20 text-primary" : "hover:bg-muted"
                )}
              >
                {opt.label}
              </button>
            ))}
            {onScheduledChange && (
              <button
                onClick={() => onScheduledChange(!hasScheduled)}
                className={cn(
                  "w-full text-left px-3 py-1.5 rounded-md text-sm transition-colors flex items-center gap-2",
                  hasScheduled ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400" : "hover:bg-muted"
                )}
              >
                <CalendarCheck className="h-3.5 w-3.5" />
                Agendados
              </button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/* ── Active filter chips ── */
export function ActiveFilterChips({
  filters,
  allTags,
  onChange,
  dashboardFilters,
  onDashboardUpdate,
}: {
  filters: ContactsFilters;
  allTags: TagInfo[];
  onChange: (filters: ContactsFilters) => void;
  dashboardFilters?: DashboardFilters;
  onDashboardUpdate?: (updates: Partial<DashboardFilters>) => void;
}) {
  const chips: { label: string; onRemove: () => void }[] = [];

  // Local filters
  for (const s of filters.statuses) {
    chips.push({ label: `Status: ${s}`, onRemove: () => onChange({ ...filters, statuses: filters.statuses.filter(x => x !== s) }) });
  }
  for (const tagId of filters.tagIds) {
    const tag = allTags.find(t => t.id === tagId);
    chips.push({ label: `Tag: ${tag?.name || tagId}`, onRemove: () => onChange({ ...filters, tagIds: filters.tagIds.filter(x => x !== tagId) }) });
  }
  if (filters.hasNexus) {
    chips.push({ label: 'Plataforma: Nexus', onRemove: () => onChange({ ...filters, hasNexus: false }) });
  }
  if (filters.hasMentoria) {
    chips.push({ label: 'Plataforma: mentor.ia', onRemove: () => onChange({ ...filters, hasMentoria: false }) });
  }
  if (filters.hasScheduled) {
    chips.push({ label: 'Qualificação: Agendados', onRemove: () => onChange({ ...filters, hasScheduled: false }) });
  }

  // Global filters
  if (dashboardFilters && onDashboardUpdate) {
    if (dashboardFilters.datePreset !== 'all') {
      const presetLabel = DATE_PRESETS.find(p => p.value === dashboardFilters.datePreset)?.label || dashboardFilters.datePreset;
      chips.push({ label: `Última conversão: ${presetLabel}`, onRemove: () => onDashboardUpdate({ datePreset: 'all', dateFrom: null, dateTo: null }) });
    }
    if (dashboardFilters.createdDatePreset !== 'all') {
      const presetLabel = DATE_PRESETS.find(p => p.value === dashboardFilters.createdDatePreset)?.label || dashboardFilters.createdDatePreset;
      chips.push({ label: `Cadastro: ${presetLabel}`, onRemove: () => onDashboardUpdate({ createdDatePreset: 'all', createdDateFrom: null, createdDateTo: null }) });
    }
    for (const t of dashboardFilters.tipos) {
      chips.push({ label: `Modal: ${t}`, onRemove: () => onDashboardUpdate({ tipos: dashboardFilters.tipos.filter(x => x !== t) }) });
    }
    for (const c of dashboardFilters.campaigns) {
      chips.push({ label: `Campanha: ${c}`, onRemove: () => onDashboardUpdate({ campaigns: dashboardFilters.campaigns.filter(x => x !== c) }) });
    }
    for (const s of (dashboardFilters.sources || [])) {
      chips.push({ label: `Origem: ${s}`, onRemove: () => onDashboardUpdate({ sources: (dashboardFilters.sources || []).filter(x => x !== s) }) });
    }
    for (const u of (dashboardFilters.utmContents || [])) {
      chips.push({ label: `UTM Content: ${u}`, onRemove: () => onDashboardUpdate({ utmContents: (dashboardFilters.utmContents || []).filter(x => x !== u) }) });
    }
    for (const q of dashboardFilters.qualifications) {
      chips.push({ label: `Qualificação: ${q === 'hot' ? 'Hot' : q === 'warm' ? 'Warm' : 'Raw'}`, onRemove: () => onDashboardUpdate({ qualifications: dashboardFilters.qualifications.filter(x => x !== q) }) });
    }
    for (const f of dashboardFilters.faturamentos) {
      chips.push({ label: `Faturamento: ${f}`, onRemove: () => onDashboardUpdate({ faturamentos: dashboardFilters.faturamentos.filter(x => x !== f) }) });
    }
    for (const c of dashboardFilters.cargos) {
      chips.push({ label: `Cargo: ${c}`, onRemove: () => onDashboardUpdate({ cargos: dashboardFilters.cargos.filter(x => x !== c) }) });
    }
    if (dashboardFilters.hideIncomplete) {
      chips.push({ label: 'Só completos', onRemove: () => onDashboardUpdate({ hideIncomplete: false }) });
    }
    if (dashboardFilters.onlyReconversions) {
      chips.push({ label: 'Só reconversões', onRemove: () => onDashboardUpdate({ onlyReconversions: false }) });
    }
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium cursor-default"
          style={{ backgroundColor: '#EEEDFE', color: '#3C3489' }}
        >
          {chip.label}
          <button onClick={chip.onRemove} className="hover:opacity-70 transition-opacity">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
