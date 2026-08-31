import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import type { TagInfo } from '@/hooks/useContactsEnriched';

const TAG_COLORS: Record<string, string> = {
  purple: '#534AB7',
  blue: '#185FA5',
  green: '#3B6D11',
  amber: '#BA7517',
  red: '#A32D2D',
  teal: '#0F6E56',
};

export function getTagColor(color: string): string {
  return TAG_COLORS[color] || color;
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
            className="text-[10px] px-1.5 py-0 h-5 font-medium whitespace-nowrap"
            style={{
              borderColor: getTagColor(tag.color),
              color: getTagColor(tag.color),
              backgroundColor: `${getTagColor(tag.color)}15`,
            }}
          >
            {tag.name}
          </Badge>
        ))}
        {remaining > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="secondary" className="text-[10px] px-1 py-0 h-5">
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
