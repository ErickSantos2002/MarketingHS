import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ArrowUpDown, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { EnrichedLead } from '@/hooks/useLeadQualification';

interface SourcePerformance {
  source: string;
  total: number;
  hot: number;
  warm: number;
  raw: number;
  hotRate: number;
}

interface SourcePerformanceTableProps {
  data: SourcePerformance[];
  onSourceClick?: (source: string, leads: EnrichedLead[]) => void;
  leads?: EnrichedLead[];
}

type SortKey = 'source' | 'total' | 'hot' | 'warm' | 'raw' | 'hotRate';
type SortOrder = 'asc' | 'desc';

export function SourcePerformanceTable({ data, onSourceClick, leads = [] }: SourcePerformanceTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('hotRate');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortOrder('desc');
    }
  };

  const sortedData = [...data].sort((a, b) => {
    const aVal = a[sortKey];
    const bVal = b[sortKey];
    
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return sortOrder === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    
    return sortOrder === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
  });

  const getScoreBadge = (hotRate: number) => {
    if (hotRate >= 30) return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Alto</Badge>;
    if (hotRate >= 15) return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Médio</Badge>;
    return <Badge className="bg-zinc-500/20 text-zinc-400 border-zinc-500/30">Baixo</Badge>;
  };

  const SortIcon = ({ columnKey }: { columnKey: SortKey }) => {
    if (sortKey !== columnKey) return <ArrowUpDown className="h-3 w-3 opacity-50" />;
    return sortOrder === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />;
  };

  const handleRowClick = (source: string) => {
    if (onSourceClick) {
      const sourceLeads = leads.filter(l => (l.source || 'Direto') === source);
      onSourceClick(source, sourceLeads);
    }
  };

  return (
    <Card className="bg-card/50 backdrop-blur-sm border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          Performance por Source
          <span className="text-xs text-muted-foreground font-normal">
            ({data.length} sources)
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border/50 hover:bg-transparent">
                <TableHead>
                  <Button variant="ghost" size="sm" className="h-auto p-0 font-medium" onClick={() => handleSort('source')}>
                    Source <SortIcon columnKey="source" />
                  </Button>
                </TableHead>
                <TableHead className="text-right">
                  <Button variant="ghost" size="sm" className="h-auto p-0 font-medium" onClick={() => handleSort('total')}>
                    Total <SortIcon columnKey="total" />
                  </Button>
                </TableHead>
                <TableHead className="text-right">
                  <Button variant="ghost" size="sm" className="h-auto p-0 font-medium text-emerald-400" onClick={() => handleSort('hot')}>
                    Hot <SortIcon columnKey="hot" />
                  </Button>
                </TableHead>
                <TableHead className="text-right">
                  <Button variant="ghost" size="sm" className="h-auto p-0 font-medium text-yellow-400" onClick={() => handleSort('warm')}>
                    Warm <SortIcon columnKey="warm" />
                  </Button>
                </TableHead>
                <TableHead className="text-right">
                  <Button variant="ghost" size="sm" className="h-auto p-0 font-medium text-zinc-400" onClick={() => handleSort('raw')}>
                    Raw <SortIcon columnKey="raw" />
                  </Button>
                </TableHead>
                <TableHead className="text-right">
                  <Button variant="ghost" size="sm" className="h-auto p-0 font-medium" onClick={() => handleSort('hotRate')}>
                    Taxa Hot <SortIcon columnKey="hotRate" />
                  </Button>
                </TableHead>
                <TableHead className="text-center">Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedData.map((row) => (
                <TableRow 
                  key={row.source} 
                  className="border-border/50 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => handleRowClick(row.source)}
                >
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {row.source}
                      <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground" />
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.total}</TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-400">{row.hot}</TableCell>
                  <TableCell className="text-right tabular-nums text-yellow-400">{row.warm}</TableCell>
                  <TableCell className="text-right tabular-nums text-zinc-400">{row.raw}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{row.hotRate.toFixed(1)}%</TableCell>
                  <TableCell className="text-center">{getScoreBadge(row.hotRate)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {data.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            Nenhum dado de source disponível
          </div>
        )}
      </CardContent>
    </Card>
  );
}
