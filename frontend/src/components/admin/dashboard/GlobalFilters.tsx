import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { CalendarIcon, X, Filter, RotateCcw, Search } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { DashboardFilters, DatePreset, Recorrencia } from '@/hooks/useDashboardFilters';
import type { QualificationSegment } from '@/hooks/useLeadQualification';

interface GlobalFiltersProps {
  filters: DashboardFilters;
  onUpdateFilters: (updates: Partial<DashboardFilters>) => void;
  onSetDatePreset: (preset: DatePreset) => void;
  onSetCustomDateRange: (from: Date | null, to: Date | null) => void;
  onResetFilters: () => void;
  activeFiltersCount: number;
  availableCampaigns: string[];
  availableCargos: string[];
  availableSources: string[];
  filteredCount?: number;
  totalCount?: number;
}

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'all', label: 'Todo período' },
  { value: 'today', label: 'Hoje' },
  { value: 'yesterday', label: 'Ontem' },
  { value: 'last7days', label: 'Últimos 7 dias' },
  { value: 'last30days', label: 'Últimos 30 dias' },
  { value: 'thisMonth', label: 'Este mês' },
  { value: 'custom', label: 'Personalizado' },
];

const RECORRENCIA_OPTIONS: { value: Recorrencia; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'novos', label: 'Novos' },
  { value: 'recorrentes', label: 'Recorrentes' },
];

const QUALIFICATION_OPTIONS: { value: QualificationSegment; label: string }[] = [
  { value: 'hot', label: 'Hot Lead' },
  { value: 'warm', label: 'Warm Lead' },
  { value: 'raw', label: 'Raw Lead' },
];

interface MultiSelectDropdownProps {
  label: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

function MultiSelectDropdown({ label, options, selected, onChange }: MultiSelectDropdownProps) {
  const toggleOption = (option: string) => {
    if (selected.includes(option)) {
      onChange(selected.filter(s => s !== option));
    } else {
      onChange([...selected, option]);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-9 border-border/50 bg-card/50 hover:bg-card hover:border-primary/30 transition-all duration-200",
            selected.length > 0 && "border-primary/50 bg-primary/5"
          )}
        >
          {label}
          {selected.length > 0 && (
            <Badge className="ml-2 bg-primary/20 text-primary hover:bg-primary/30 text-xs px-1.5">
              {selected.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2 bg-card border-border/50" align="start">
        <div className="max-h-60 overflow-y-auto space-y-1">
          {options.map(option => (
            <button
              key={option}
              onClick={() => toggleOption(option)}
              className={cn(
                "w-full text-left px-3 py-2 rounded-md text-sm transition-colors",
                selected.includes(option)
                  ? "bg-primary/20 text-primary"
                  : "hover:bg-muted text-foreground"
              )}
            >
              {option}
            </button>
          ))}
          {options.length === 0 && (
            <p className="text-sm text-muted-foreground px-3 py-2">Nenhuma opção disponível</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function GlobalFilters({
  filters,
  onUpdateFilters,
  onSetDatePreset,
  onSetCustomDateRange,
  onResetFilters,
  activeFiltersCount,
  availableCampaigns,
  availableCargos,
  availableSources,
  filteredCount,
  totalCount,
}: GlobalFiltersProps) {
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);

  return (
    // A faixa que envolve este componente (bg-surface/border-b) já vem do
    // AdminLayout — este wrapper não repete mais o visual de card avulso.
    <div>
      <div className="flex items-center gap-4 mb-3">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-foreground">Filtros</span>
          {activeFiltersCount > 0 && (
            <Badge className="bg-primary/20 text-primary hover:bg-primary/30 text-xs">
              {activeFiltersCount} ativo{activeFiltersCount > 1 ? 's' : ''}
            </Badge>
          )}
          {filteredCount !== undefined && totalCount !== undefined && (
            <span className="text-sm text-muted-foreground ml-2">
              •&nbsp;Exibindo <strong className="text-primary">{filteredCount.toLocaleString('pt-BR')}</strong> de {totalCount.toLocaleString('pt-BR')} leads
            </span>
          )}
        </div>
        
        {/* Search Input */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, email, telefone ou empresa..."
            value={filters.search || ''}
            onChange={(e) => onUpdateFilters({ search: e.target.value })}
            className="pl-10 bg-card/50 border-border/50"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {/* Date Preset Selector */}
        <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-9 border-border/50 bg-card/50 hover:bg-card hover:border-primary/30 transition-all duration-200",
                filters.datePreset !== 'all' && "border-primary/50 bg-primary/5"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {filters.datePreset === 'custom' && filters.dateFrom && filters.dateTo
                ? `${format(filters.dateFrom, 'dd/MM', { locale: ptBR })} - ${format(filters.dateTo, 'dd/MM', { locale: ptBR })}`
                : DATE_PRESETS.find(p => p.value === filters.datePreset)?.label
              }
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 bg-card border-border/50" align="start">
            <div className="flex">
              <div className="border-r border-border/30 p-2 space-y-1">
                {DATE_PRESETS.map(preset => (
                  <button
                    key={preset.value}
                    onClick={() => {
                      onSetDatePreset(preset.value);
                      if (preset.value !== 'custom') {
                        setDatePopoverOpen(false);
                      }
                    }}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-md text-sm transition-colors whitespace-nowrap",
                      filters.datePreset === preset.value
                        ? "bg-primary/20 text-primary"
                        : "hover:bg-muted text-foreground"
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              {filters.datePreset === 'custom' && (
                <div className="p-2">
                  <Calendar
                    mode="range"
                    selected={{
                      from: filters.dateFrom || undefined,
                      to: filters.dateTo || undefined,
                    }}
                    onSelect={(range) => {
                      onSetCustomDateRange(range?.from || null, range?.to || null);
                      if (range?.from && range?.to) {
                        setDatePopoverOpen(false);
                      }
                    }}
                    locale={ptBR}
                    className="rounded-md pointer-events-auto"
                  />
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>

        {/* Modal, Faturamento, Tema de Desafio e "Só completos" saíram em
            02/10/2026 (raio-x RD, R6): eram o funil de evento da dn.ia. Se
            Modal, Faturamento ou "Só completos" vierem ligados do painel de
            Contatos, o chip deles aparece abaixo — filtro nunca fica mudo. */}

        {/* Campaign Filter */}
        <MultiSelectDropdown
          label="Campanha"
          options={availableCampaigns}
          selected={filters.campaigns}
          onChange={(campaigns) => onUpdateFilters({ campaigns })}
        />

        {/* Source Filter */}
        <MultiSelectDropdown
          label="Origem"
          options={availableSources}
          selected={filters.sources || []}
          onChange={(sources) => onUpdateFilters({ sources })}
        />

        {/* Qualification Filter */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-9 border-border/50 bg-card/50 hover:bg-card hover:border-primary/30 transition-all duration-200",
                filters.qualifications.length > 0 && "border-primary/50 bg-primary/5"
              )}
            >
              Qualificação
              {filters.qualifications.length > 0 && (
                <Badge className="ml-2 bg-primary/20 text-primary hover:bg-primary/30 text-xs px-1.5">
                  {filters.qualifications.length}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-2 bg-card border-border/50" align="start">
            <div className="space-y-1">
              {QUALIFICATION_OPTIONS.map(option => (
                <button
                  key={option.value}
                  onClick={() => {
                    const current = filters.qualifications;
                    if (current.includes(option.value)) {
                      onUpdateFilters({ qualifications: current.filter(q => q !== option.value) });
                    } else {
                      onUpdateFilters({ qualifications: [...current, option.value] });
                    }
                  }}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-md text-sm transition-colors",
                    filters.qualifications.includes(option.value)
                      ? "bg-primary/20 text-primary"
                      : "hover:bg-muted text-foreground"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {/* Cargo Filter */}
        <MultiSelectDropdown
          label="Cargo"
          options={availableCargos}
          selected={filters.cargos}
          onChange={(cargos) => onUpdateFilters({ cargos })}
        />

        {/* Novos / Recorrentes / Todos (era o interruptor "Só reconversões") */}
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={filters.recorrencia}
          onValueChange={(v) => v && onUpdateFilters({ recorrencia: v as Recorrencia })}
          aria-label="Novos ou recorrentes"
        >
          {RECORRENCIA_OPTIONS.map(option => (
            <ToggleGroupItem key={option.value} value={option.value} className="h-9">
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        {/* Reset Button */}
        {activeFiltersCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onResetFilters}
            className="h-9 text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="h-4 w-4 mr-1" />
            Limpar
          </Button>
        )}
      </div>

      {/* Active Filter Tags */}
      {activeFiltersCount > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-border/30">
          {filters.tipos.map(tipo => (
            <Badge
              key={`tipo-${tipo}`}
              variant="secondary"
              className="bg-primary/10 text-primary/90 hover:bg-primary/20 cursor-pointer"
              onClick={() => onUpdateFilters({ tipos: filters.tipos.filter(t => t !== tipo) })}
            >
              Modal: {tipo}
              <X className="ml-1 h-3 w-3" />
            </Badge>
          ))}
          {filters.campaigns.map(campaign => (
            <Badge
              key={`campaign-${campaign}`}
              variant="info"
              className="cursor-pointer hover:bg-info/20"
              onClick={() => onUpdateFilters({ campaigns: filters.campaigns.filter(c => c !== campaign) })}
            >
              {campaign}
              <X className="ml-1 h-3 w-3" />
            </Badge>
          ))}
          {filters.qualifications.map(qual => (
            <Badge
              key={`qual-${qual}`}
              variant="secondary"
              className="cursor-pointer hover:bg-surface-elevated"
              onClick={() => onUpdateFilters({ qualifications: filters.qualifications.filter(q => q !== qual) })}
            >
              {qual === 'hot' ? 'Hot' : qual === 'warm' ? 'Warm' : 'Raw'}
              <X className="ml-1 h-3 w-3" />
            </Badge>
          ))}
          {filters.faturamentos.map(fat => (
            <Badge
              key={`fat-${fat}`}
              variant="warning"
              className="cursor-pointer hover:bg-warning/20"
              onClick={() => onUpdateFilters({ faturamentos: filters.faturamentos.filter(f => f !== fat) })}
            >
              Faturamento: {fat}
              <X className="ml-1 h-3 w-3" />
            </Badge>
          ))}
          {filters.cargos.map(cargo => (
            <Badge
              key={`cargo-${cargo}`}
              variant="default"
              className="cursor-pointer hover:bg-primary/20"
              onClick={() => onUpdateFilters({ cargos: filters.cargos.filter(c => c !== cargo) })}
            >
              {cargo}
              <X className="ml-1 h-3 w-3" />
            </Badge>
          ))}
          {(filters.sources || []).map(source => (
            <Badge
              key={`source-${source}`}
              variant="warning"
              className="cursor-pointer hover:bg-warning/20"
              onClick={() => onUpdateFilters({ sources: (filters.sources || []).filter(s => s !== source) })}
            >
              {source}
              <X className="ml-1 h-3 w-3" />
            </Badge>
          ))}
          {/* Cadastro e UTM Content só se ligam no painel de Contatos; o chip
              aqui é o que impede o filtro de agir sem aparecer. */}
          {filters.createdDatePreset !== 'all' && (
            <Badge
              variant="secondary"
              className="cursor-pointer hover:bg-surface-elevated"
              onClick={() => onUpdateFilters({ createdDatePreset: 'all', createdDateFrom: null, createdDateTo: null })}
            >
              Cadastro: {DATE_PRESETS.find(p => p.value === filters.createdDatePreset)?.label}
              <X className="ml-1 h-3 w-3" />
            </Badge>
          )}
          {(filters.utmContents || []).map(u => (
            <Badge
              key={`utm-content-${u}`}
              variant="secondary"
              className="cursor-pointer hover:bg-surface-elevated"
              onClick={() => onUpdateFilters({ utmContents: (filters.utmContents || []).filter(x => x !== u) })}
            >
              UTM Content: {u}
              <X className="ml-1 h-3 w-3" />
            </Badge>
          ))}
          {filters.hideIncomplete && (
            <Badge
              variant="secondary"
              className="cursor-pointer hover:bg-surface-elevated"
              onClick={() => onUpdateFilters({ hideIncomplete: false })}
            >
              Só completos
              <X className="ml-1 h-3 w-3" />
            </Badge>
          )}
          {filters.recorrencia !== 'todos' && (
            <Badge
              variant="info"
              className="cursor-pointer hover:bg-info/20"
              onClick={() => onUpdateFilters({ recorrencia: 'todos' })}
            >
              {filters.recorrencia === 'novos' ? 'Só novos' : 'Só recorrentes'}
              <X className="ml-1 h-3 w-3" />
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
