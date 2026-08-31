import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { CalendarIcon, X, Filter, RotateCcw, UserCheck, Search, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { DashboardFilters, DatePreset, InteresseFilter } from '@/hooks/useDashboardFilters';
import { CHALLENGE_THEMES } from '@/hooks/useLeadAnalytics';
import type { QualificationSegment } from '@/hooks/useLeadQualification';

interface GlobalFiltersProps {
  filters: DashboardFilters;
  onUpdateFilters: (updates: Partial<DashboardFilters>) => void;
  onSetDatePreset: (preset: DatePreset) => void;
  onSetCustomDateRange: (from: Date | null, to: Date | null) => void;
  onResetFilters: () => void;
  activeFiltersCount: number;
  availableTipos: string[];
  availableCampaigns: string[];
  availableFaturamentos: string[];
  availableCargos: string[];
  availableSources: string[];
  availablePresencas: string[];
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

const QUALIFICATION_OPTIONS: { value: QualificationSegment; label: string }[] = [
  { value: 'hot', label: 'Hot Lead' },
  { value: 'warm', label: 'Warm Lead' },
  { value: 'raw', label: 'Raw Lead' },
];

const INTERESSE_OPTIONS: { value: InteresseFilter; label: string }[] = [
  { value: 'mtia_e_formacao', label: 'MTIA + Formação' },
  { value: 'apenas_mtia', label: 'Apenas MTIA' },
  { value: 'apenas_formacao', label: 'Apenas Formação' },
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
  availableTipos,
  availableCampaigns,
  availableFaturamentos,
  availableCargos,
  availableSources,
  availablePresencas,
  filteredCount,
  totalCount,
}: GlobalFiltersProps) {
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const challengeThemeOptions = Object.keys(CHALLENGE_THEMES);

  return (
    <div className="glass-card p-4 mb-6 animate-fade-in">
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
            className="pl-10 h-9 bg-card/50 border-border/50"
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

        {/* Modal/Tipo Filter */}
        <MultiSelectDropdown
          label="Modal"
          options={availableTipos}
          selected={filters.tipos}
          onChange={(tipos) => onUpdateFilters({ tipos })}
        />

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

        {/* Faturamento Filter */}
        <MultiSelectDropdown
          label="Faturamento"
          options={availableFaturamentos}
          selected={filters.faturamentos}
          onChange={(faturamentos) => onUpdateFilters({ faturamentos })}
        />

        {/* Cargo Filter */}
        <MultiSelectDropdown
          label="Cargo"
          options={availableCargos}
          selected={filters.cargos}
          onChange={(cargos) => onUpdateFilters({ cargos })}
        />

        {/* Challenge Themes Filter */}
        <MultiSelectDropdown
          label="Tema de Desafio"
          options={challengeThemeOptions}
          selected={filters.challengeThemes}
          onChange={(challengeThemes) => onUpdateFilters({ challengeThemes })}
        />

        {/* Presença Filter */}
        <MultiSelectDropdown
          label="Presença"
          options={availablePresencas}
          selected={filters.presencas || []}
          onChange={(presencas) => onUpdateFilters({ presencas })}
        />

        {/* Interesse Ecossistema Filter */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-9 border-border/50 bg-card/50 hover:bg-card hover:border-primary/30 transition-all duration-200",
                filters.interesseEcossistema && "border-primary/50 bg-primary/5"
              )}
            >
              Interesse
              {filters.interesseEcossistema && (
                <Badge className="ml-2 bg-primary/20 text-primary hover:bg-primary/30 text-xs px-1.5">
                  1
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-2 bg-card border-border/50" align="start">
            <div className="space-y-1">
              {INTERESSE_OPTIONS.map(option => (
                <button
                  key={option.value}
                  onClick={() => {
                    onUpdateFilters({ 
                      interesseEcossistema: filters.interesseEcossistema === option.value ? null : option.value 
                    });
                  }}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-md text-sm transition-colors",
                    filters.interesseEcossistema === option.value
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

        {/* Hide Incomplete Leads Toggle */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border/50 bg-card/50">
          <Switch
            id="hide-incomplete"
            checked={!!filters.hideIncomplete}
            onCheckedChange={(checked) => onUpdateFilters({ hideIncomplete: !!checked })}
          />
          <Label 
            htmlFor="hide-incomplete" 
            className="text-sm text-muted-foreground cursor-pointer flex items-center gap-1.5"
          >
            <UserCheck className="h-3.5 w-3.5" />
            Só completos
          </Label>
        </div>

        {/* Only Reconversions Toggle */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border/50 bg-card/50">
          <Switch
            id="only-reconversions"
            checked={!!filters.onlyReconversions}
            onCheckedChange={(checked) => onUpdateFilters({ onlyReconversions: !!checked })}
          />
          <Label 
            htmlFor="only-reconversions" 
            className="text-sm text-muted-foreground cursor-pointer flex items-center gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Só reconversões
          </Label>
        </div>

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
              {tipo}
              <X className="ml-1 h-3 w-3" />
            </Badge>
          ))}
          {filters.campaigns.map(campaign => (
            <Badge
              key={`campaign-${campaign}`}
              variant="secondary"
              className="bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 cursor-pointer"
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
              className="bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 cursor-pointer"
              onClick={() => onUpdateFilters({ qualifications: filters.qualifications.filter(q => q !== qual) })}
            >
              {qual === 'hot' ? 'Hot' : qual === 'warm' ? 'Warm' : 'Raw'}
              <X className="ml-1 h-3 w-3" />
            </Badge>
          ))}
          {filters.faturamentos.map(fat => (
            <Badge
              key={`fat-${fat}`}
              variant="secondary"
              className="bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 cursor-pointer"
              onClick={() => onUpdateFilters({ faturamentos: filters.faturamentos.filter(f => f !== fat) })}
            >
              {fat}
              <X className="ml-1 h-3 w-3" />
            </Badge>
          ))}
          {filters.cargos.map(cargo => (
            <Badge
              key={`cargo-${cargo}`}
              variant="secondary"
              className="bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 cursor-pointer"
              onClick={() => onUpdateFilters({ cargos: filters.cargos.filter(c => c !== cargo) })}
            >
              {cargo}
              <X className="ml-1 h-3 w-3" />
            </Badge>
          ))}
          {filters.challengeThemes.map(theme => (
            <Badge
              key={`theme-${theme}`}
              variant="secondary"
              className="bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 cursor-pointer"
              onClick={() => onUpdateFilters({ challengeThemes: filters.challengeThemes.filter(t => t !== theme) })}
            >
              {theme}
              <X className="ml-1 h-3 w-3" />
            </Badge>
          ))}
          {(filters.sources || []).map(source => (
            <Badge
              key={`source-${source}`}
              variant="secondary"
              className="bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 cursor-pointer"
              onClick={() => onUpdateFilters({ sources: (filters.sources || []).filter(s => s !== source) })}
            >
              {source}
              <X className="ml-1 h-3 w-3" />
            </Badge>
          ))}
          {(filters.presencas || []).map(presenca => (
            <Badge
              key={`presenca-${presenca}`}
              variant="secondary"
              className="bg-green-500/10 text-green-400 hover:bg-green-500/20 cursor-pointer"
              onClick={() => onUpdateFilters({ presencas: (filters.presencas || []).filter(p => p !== presenca) })}
            >
              {presenca}
              <X className="ml-1 h-3 w-3" />
            </Badge>
          ))}
          {filters.interesseEcossistema && (
            <Badge
              variant="secondary"
              className="bg-pink-500/10 text-pink-400 hover:bg-pink-500/20 cursor-pointer"
              onClick={() => onUpdateFilters({ interesseEcossistema: null })}
            >
              {filters.interesseEcossistema === 'mtia_e_formacao' 
                ? 'MTIA + Formação' 
                : filters.interesseEcossistema === 'apenas_mtia'
                  ? 'Apenas MTIA'
                  : 'Apenas Formação'}
              <X className="ml-1 h-3 w-3" />
            </Badge>
          )}
          {filters.onlyReconversions && (
            <Badge
              variant="secondary"
              className="bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 cursor-pointer"
              onClick={() => onUpdateFilters({ onlyReconversions: false })}
            >
              Só reconversões
              <X className="ml-1 h-3 w-3" />
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
