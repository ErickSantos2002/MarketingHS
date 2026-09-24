import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import type { TagInfo } from '@/hooks/useContactsEnriched';
import { resolverCorDeDado, estiloDeCorDeDado } from '@/lib/corDeDado';

export function getTagColor(color: string): string {
  return resolverCorDeDado(color);
}

export function TagsCell({ tags }: { tags: TagInfo[] }) {
  if (!tags || tags.length === 0) return <span className="text-muted-foreground text-xs">—</span>;

  const visible = tags.slice(0, 2);
  const remaining = tags.length - 2;

  return (
    <TooltipProvider>
      <div className="flex items-center gap-1 flex-wrap">
        {visible.map(tag => (
          <Badge
            key={tag.id}
            variant="outline"
            className="text-xs px-1.5 py-0 h-5 font-medium whitespace-nowrap text-conteudo-heading"
            style={estiloDeCorDeDado(tag.color)}
          >
            {tag.name}
          </Badge>
        ))}
        {remaining > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="secondary" className="text-xs px-1 py-0 h-5">
                +{remaining}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {tags.slice(2).map(t => t.name).join(', ')}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}
