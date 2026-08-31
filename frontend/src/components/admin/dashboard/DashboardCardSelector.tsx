import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { LayoutGrid, RotateCcw } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { CardConfig } from '@/hooks/useDashboardCardSettings';

interface DashboardCardSelectorProps {
  cards: CardConfig[];
  visibleCards: string[];
  onToggle: (key: string) => void;
  onReset: () => void;
}

export function DashboardCardSelector({ cards, visibleCards, onToggle, onReset }: DashboardCardSelectorProps) {
  const hiddenCount = cards.length - visibleCards.length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <LayoutGrid className="h-4 w-4" />
          <span className="hidden sm:inline">Cards</span>
          {hiddenCount > 0 && (
            <span className="ml-1 rounded-full bg-primary/20 text-primary text-xs px-1.5 py-0.5">
              {hiddenCount} oculto{hiddenCount > 1 ? 's' : ''}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="end">
        <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-border/50">
          <span className="text-sm font-medium">Visibilidade</span>
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={onReset}>
            <RotateCcw className="h-3 w-3" />
            Resetar
          </Button>
        </div>
        <ScrollArea className="max-h-[300px]">
          <div className="p-2 space-y-1">
            {cards.map(card => (
              <label
                key={card.key}
                className="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
              >
                <Checkbox
                  checked={visibleCards.includes(card.key)}
                  onCheckedChange={() => onToggle(card.key)}
                />
                <span className="text-sm">{card.label}</span>
              </label>
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
