import { useState } from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useSegments } from '@/hooks/useSegments';
import { cn } from '@/lib/utils';

// O shadcn não tem multi-select no registry (o mais próximo é o Combobox, que é
// esta mesma receita Popover + Command). Então o campo é montado aqui: os
// segmentos escolhidos são chips DENTRO do controle, não uma lista solta abaixo
// dele -- antes o gatilho dizia "1 segmento selecionado" e o nome vivia numa
// segunda linha, obrigando a ler dois lugares para saber uma coisa só.

interface SegmentMultiSelectProps {
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  // Ids que não podem ser escolhidos aqui porque já estão no outro campo -- o
  // mesmo segmento em inclusão e exclusão resultaria sempre em zero contatos.
  disabledIds?: string[];
  disabled?: boolean;
}

export function SegmentMultiSelect({
  value,
  onChange,
  placeholder = 'Selecione os segmentos',
  disabledIds = [],
  disabled = false,
}: SegmentMultiSelectProps) {
  const { segments, counts, loading } = useSegments();
  const [open, setOpen] = useState(false);

  const toggle = (id: string) => {
    onChange(value.includes(id) ? value.filter(v => v !== id) : [...value, id]);
  };

  const nameOf = (id: string) => {
    const found = segments.find(s => s.id === id);
    if (found) return found.name;
    // Enquanto os segmentos não chegaram não dá para distinguir "id apagado" de
    // "ainda não carregou" -- chamar de removido nesse intervalo assusta à toa.
    return loading ? 'Carregando…' : 'Segmento removido';
  };

  // undefined enquanto as contagens não chegam. Exibir 0 nesse meio-tempo diria
  // que o segmento está vazio, que é uma afirmação diferente de "não sei ainda".
  const countOf = (id: string): string | null => {
    const n = counts[id];
    return typeof n === 'number' ? n.toLocaleString('pt-BR') : null;
  };

  return (
    <div className="space-y-2">
      {/* `open && !disabled` em vez de repassar `disabled` ao PopoverTrigger:
          com asChild ele iria parar num <div>, onde `disabled` não é atributo
          válido. */}
      <Popover open={open && !disabled} onOpenChange={(o) => !disabled && setOpen(o)}>
        <PopoverTrigger asChild>
          {/* <div>, não <Button>: os chips têm o próprio <button> de remover, e
              button dentro de button é HTML inválido. Em troca, o papel de
              combobox e o teclado precisam ser declarados na mão. */}
          <div
            role="combobox"
            aria-expanded={open}
            aria-disabled={disabled || undefined}
            tabIndex={disabled ? -1 : 0}
            onKeyDown={(e) => {
              // Sem esta guarda, o Enter que aciona o "✕" de um chip subiria até
              // aqui e reabriria o popover logo após remover o segmento.
              if (e.target !== e.currentTarget) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (!disabled) setOpen(true);
              }
            }}
            className={cn(
              'flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-sm',
              'ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:border-muted-foreground/50',
            )}
          >
            {value.length === 0 ? (
              <span className="text-muted-foreground">{placeholder}</span>
            ) : (
              value.map(id => {
                const count = countOf(id);
                return (
                  <Badge key={id} variant="secondary" className="gap-1.5 pr-1 font-normal">
                    <span className="truncate max-w-[200px]">{nameOf(id)}</span>
                    {count && (
                      <span className="text-muted-foreground tabular-nums text-[11px]">{count}</span>
                    )}
                    {!disabled && (
                      <button
                        type="button"
                        // O clique no ✕ não pode abrir o popover. O Radix escuta
                        // pointerdown no gatilho, então parar só o onClick deixaria
                        // o painel abrir mesmo assim.
                        onPointerDown={e => e.stopPropagation()}
                        onClick={e => { e.stopPropagation(); toggle(id); }}
                        aria-label={`Remover ${nameOf(id)}`}
                        className="rounded-sm hover:bg-muted-foreground/20 p-0.5"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </Badge>
                );
              })
            )}

            {!disabled && value.length > 0 && (
              <span className="text-xs text-muted-foreground">+ adicionar</span>
            )}

            {/* Escondido em consulta: uma seta de "abrir" que não abre nada é
                uma promessa falsa. */}
            {!disabled && <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 opacity-50" />}
          </div>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Buscar segmento..." />
            <CommandList>
              <CommandEmpty>Nenhum segmento encontrado.</CommandEmpty>
              <CommandGroup>
                {segments.map(s => {
                  const isDisabled = disabledIds.includes(s.id);
                  return (
                    <CommandItem
                      key={s.id}
                      value={s.name}
                      disabled={isDisabled}
                      onSelect={() => !isDisabled && toggle(s.id)}
                      className={cn(isDisabled && 'opacity-40')}
                    >
                      <Check className={cn('mr-2 h-4 w-4', value.includes(s.id) ? 'opacity-100' : 'opacity-0')} />
                      <span className="flex-1 truncate">{s.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground shrink-0">
                        {s.type === 'dynamic' ? 'dinâmico' : 'estático'} · {counts[s.id] ?? 0}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
