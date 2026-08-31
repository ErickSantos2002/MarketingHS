import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ArrowUpDown, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { EnrichedLead } from '@/hooks/useLeadQualification';

interface CampaignPerformance {
  campaign: string;
  total: number;
  hot: number;
  hotRate: number;
  primarySource: string;
}

interface CampaignPerformanceTableProps {
  data: CampaignPerformance[];
  onCampaignClick?: (campaign: string, leads: EnrichedLead[]) => void;
  leads?: EnrichedLead[];
}

type SortKey = 'campaign' | 'total' | 'hot' | 'hotRate' | 'primarySource';
type SortOrder = 'asc' | 'desc';

export function CampaignPerformanceTable({ data, onCampaignClick, leads = [] }: CampaignPerformanceTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('total');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortOrder('desc');
    }
  };

  // Filter out null/empty campaigns
  const filteredData = data.filter(d => d.campaign && d.campaign !== 'null' && d.campaign.trim() !== '');

  const sortedData = [...filteredData].sort((a, b) => {
    const aVal = a[sortKey];
    const bVal = b[sortKey];
    
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return sortOrder === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    
    return sortOrder === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
  });

  const SortIcon = ({ columnKey }: { columnKey: SortKey }) => {
    if (sortKey !== columnKey) return <ArrowUpDown className="h-3 w-3 opacity-50" />;
    return sortOrder === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />;
  };

  const handleRowClick = (campaign: string) => {
    if (onCampaignClick) {
      const campaignLeads = leads.filter(l => l.utm_campaign === campaign);
      onCampaignClick(campaign, campaignLeads);
    }
  };

  return (
    <Card className="bg-card/50 backdrop-blur-sm border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          Performance por Campanha UTM
          <span className="text-xs text-muted-foreground font-normal">
            ({filteredData.length} campanhas)
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border/50 hover:bg-transparent">
                <TableHead>
                  <Button variant="ghost" size="sm" className="h-auto p-0 font-medium" onClick={() => handleSort('campaign')}>
                    Campanha <SortIcon columnKey="campaign" />
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
                  <Button variant="ghost" size="sm" className="h-auto p-0 font-medium" onClick={() => handleSort('hotRate')}>
                    Taxa Hot <SortIcon columnKey="hotRate" />
                  </Button>
                </TableHead>
                <TableHead>
                  <Button variant="ghost" size="sm" className="h-auto p-0 font-medium" onClick={() => handleSort('primarySource')}>
                    Source Principal <SortIcon columnKey="primarySource" />
                  </Button>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedData.slice(0, 15).map((row) => (
                <TableRow 
                  key={row.campaign} 
                  className="border-border/50 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => handleRowClick(row.campaign)}
                >
                  <TableCell className="font-medium max-w-[200px] truncate" title={row.campaign}>
                    {row.campaign}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.total}</TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-400">{row.hot}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{row.hotRate.toFixed(1)}%</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {row.primarySource}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {filteredData.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            Nenhuma campanha UTM disponível
          </div>
        )}
        {filteredData.length > 15 && (
          <p className="text-xs text-muted-foreground text-center mt-2">
            Mostrando 15 de {filteredData.length} campanhas
          </p>
        )}
      </CardContent>
    </Card>
  );
}
