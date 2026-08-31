import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Filter, X } from 'lucide-react';
import { STATUS_OPTIONS, STATUS_COLORS } from './StatusBadge';
import type { TagInfo } from '@/hooks/useContactsEnriched';
import type { ContactsFilters } from '@/hooks/useContactsEnriched';
import { getTagColor } from './TagsCell';

interface ContactsFiltersBarProps {
  filters: ContactsFilters;
  onChange: (filters: ContactsFilters) => void;
  allTags: TagInfo[];
}

export function ContactsFiltersBar({ filters, onChange, allTags }: ContactsFiltersBarProps) {
  const activeCount =
    filters.statuses.length +
    filters.tagIds.length +
    (filters.hasNexus ? 1 : 0) +
    (filters.hasMentoria ? 1 : 0) +
    (filters.hasScheduled ? 1 : 0);

  const clearAll = () =>
    onChange({ statuses: [], tagIds: [], hasNexus: false, hasMentoria: false, hasScheduled: false });

  const toggleStatus = (s: string) => {
    const next = filters.statuses.includes(s)
      ? filters.statuses.filter(x => x !== s)
      : [...filters.statuses, s];
    onChange({ ...filters, statuses: next });
  };

  const toggleTag = (id: string) => {
    const next = filters.tagIds.includes(id)
      ? filters.tagIds.filter(x => x !== id)
      : [...filters.tagIds, id];
    onChange({ ...filters, tagIds: next });
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Status filter */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
            <Filter className="h-3 w-3" />
            Status
            {filters.statuses.length > 0 && (
              <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                {filters.statuses.length}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-52 p-2" align="start">
          <div className="space-y-1">
            {STATUS_OPTIONS.map(s => (
              <label key={s} className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted/50 rounded cursor-pointer text-sm">
                <Checkbox
                  checked={filters.statuses.includes(s)}
                  onCheckedChange={() => toggleStatus(s)}
                />
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: STATUS_COLORS[s] }} />
                {s}
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Tags filter */}
      {allTags.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
              <Filter className="h-3 w-3" />
              Tags
              {filters.tagIds.length > 0 && (
                <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                  {filters.tagIds.length}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-52 p-2" align="start">
            <div className="space-y-1">
              {allTags.map(tag => (
                <label key={tag.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted/50 rounded cursor-pointer text-sm">
                  <Checkbox
                    checked={filters.tagIds.includes(tag.id)}
                    onCheckedChange={() => toggleTag(tag.id)}
                  />
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getTagColor(tag.color) }} />
                  {tag.name}
                </label>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}

      {/* Platform filter */}
      <div className="flex items-center gap-2 text-xs">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <Checkbox
            checked={filters.hasNexus}
            onCheckedChange={(v) => onChange({ ...filters, hasNexus: !!v })}
          />
          <span className="font-medium" style={{ color: '#185FA5' }}>No Nexus</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <Checkbox
            checked={filters.hasMentoria}
            onCheckedChange={(v) => onChange({ ...filters, hasMentoria: !!v })}
          />
          <span className="font-medium" style={{ color: '#0F6E56' }}>No mentor.ia</span>
        </label>
      </div>

      {activeCount > 0 && (
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground" onClick={clearAll}>
          <X className="h-3 w-3" />
          Limpar ({activeCount})
        </Button>
      )}
    </div>
  );
}
