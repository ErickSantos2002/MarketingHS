import { useState } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { CampaignScore } from "@/hooks/useInsightsAnalytics";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface CampaignRankingTableProps {
  campaigns: CampaignScore[];
}

// As colunas Resposta, Score e Grade (A–F) saíram em 02/10/2026 (raio-x RD,
// R6): as três vinham do preenchimento do campo `desafios`, da dn.ia. O
// ranking agora é por volume, com a fatia hot pela etiqueta do banco.
type SortKey = 'campaign' | 'totalLeads' | 'hotLeads' | 'hotRate';

export function CampaignRankingTable({ campaigns }: CampaignRankingTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('totalLeads');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('desc');
    }
  };

  const sortedCampaigns = [...campaigns].sort((a, b) => {
    const aValue = a[sortKey];
    const bValue = b[sortKey];
    
    if (typeof aValue === 'string' && typeof bValue === 'string') {
      return sortDirection === 'asc' 
        ? aValue.localeCompare(bValue)
        : bValue.localeCompare(aValue);
    }
    
    return sortDirection === 'asc' 
      ? (aValue as number) - (bValue as number)
      : (bValue as number) - (aValue as number);
  });

  const SortIcon = ({ columnKey }: { columnKey: SortKey }) => {
    if (sortKey !== columnKey) {
      return <ArrowUpDown className="h-3 w-3 opacity-50" />;
    }
    return sortDirection === 'asc' 
      ? <ArrowUp className="h-3 w-3" />
      : <ArrowDown className="h-3 w-3" />;
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted-foreground">
        Ranking de Campanhas ({campaigns.length})
      </h3>

      <div className="rounded-lg border border-border/50 overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-border/50">
                <TableHead 
                  className="cursor-pointer select-none"
                  onClick={() => handleSort('campaign')}
                >
                  <div className="flex items-center gap-1.5">
                    Campanha
                    <SortIcon columnKey="campaign" />
                  </div>
                </TableHead>
                <TableHead 
                  className="cursor-pointer select-none text-right"
                  onClick={() => handleSort('totalLeads')}
                >
                  <div className="flex items-center justify-end gap-1.5">
                    Leads
                    <SortIcon columnKey="totalLeads" />
                  </div>
                </TableHead>
                <TableHead 
                  className="cursor-pointer select-none text-right"
                  onClick={() => handleSort('hotLeads')}
                >
                  <div className="flex items-center justify-end gap-1.5">
                    Hot
                    <SortIcon columnKey="hotLeads" />
                  </div>
                </TableHead>
                <TableHead 
                  className="cursor-pointer select-none text-right"
                  onClick={() => handleSort('hotRate')}
                >
                  <div className="flex items-center justify-end gap-1.5">
                    Hot Rate
                    <SortIcon columnKey="hotRate" />
                  </div>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedCampaigns.slice(0, 15).map((campaign) => (
                <TableRow key={campaign.campaign} className="border-border/30">
                  <TableCell className="font-medium max-w-[200px]">
                    <span 
                      className="truncate block" 
                      title={campaign.campaign}
                    >
                      {campaign.campaign}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {campaign.totalLeads}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {campaign.hotLeads}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {campaign.hotRate.toFixed(1)}%
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
