import { useState } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown, Info, ChevronDown, ChevronUp } from "lucide-react";
import { CampaignScore } from "@/hooks/useInsightsAnalytics";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface CampaignRankingTableProps {
  campaigns: CampaignScore[];
}

type SortKey = 'campaign' | 'totalLeads' | 'responseRate' | 'hotRate' | 'score';

const gradeColors = {
  A: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  B: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  C: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  D: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  F: 'bg-red-500/20 text-red-400 border-red-500/30'
};

export function CampaignRankingTable({ campaigns }: CampaignRankingTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [legendOpen, setLegendOpen] = useState(false);
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

      {/* Legenda Explicativa */}
      <Collapsible open={legendOpen} onOpenChange={setLegendOpen}>
        <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full p-3 bg-muted/30 rounded-lg border border-border/50">
          <Info className="h-4 w-4" />
          <span>Como interpretar este ranking?</span>
          {legendOpen ? <ChevronUp className="h-4 w-4 ml-auto" /> : <ChevronDown className="h-4 w-4 ml-auto" />}
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 p-3 bg-muted/20 rounded-lg border border-border/50 text-xs text-muted-foreground space-y-2">
          <p><strong className="text-foreground">Score</strong> = (Taxa Resposta × 0.4) + (Hot Rate × 1.5) + Bônus de Volume</p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-2">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-medium">A</span>
              <span>80+ Excelente</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 font-medium">B</span>
              <span>60-79 Bom</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 font-medium">C</span>
              <span>40-59 Regular</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-orange-500/20 text-orange-400 font-medium">D</span>
              <span>20-39 Ruim</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-400 font-medium">F</span>
              <span>&lt;20 Crítico</span>
            </div>
          </div>
          <div className="pt-2 border-t border-border/50 mt-2 space-y-1">
            <p><span className="text-red-400">⚠️ Vermelho na Resposta:</span> &lt;50% — leads não estão completando o formulário</p>
            <p><span className="text-amber-400">⚠️ Amarelo no Hot Rate:</span> &lt;15% — leads fora do perfil ideal (ICP)</p>
          </div>
          <div className="pt-2 border-t border-border/50 mt-2">
            <p><strong className="text-foreground">O que fazer:</strong></p>
            <ul className="list-disc list-inside mt-1 space-y-0.5">
              <li><strong>Grade A:</strong> Aumentar investimento nesta campanha</li>
              <li><strong>Grade B:</strong> Manter e buscar otimizações incrementais</li>
              <li><strong>Grade C:</strong> Revisar segmentação e criativos</li>
              <li><strong>Grade D/F:</strong> Considerar pausar e realocar budget</li>
            </ul>
          </div>
        </CollapsibleContent>
      </Collapsible>
      
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
                  onClick={() => handleSort('responseRate')}
                >
                  <div className="flex items-center justify-end gap-1.5">
                    Resposta
                    <SortIcon columnKey="responseRate" />
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
                <TableHead 
                  className="cursor-pointer select-none text-right"
                  onClick={() => handleSort('score')}
                >
                  <div className="flex items-center justify-end gap-1.5">
                    Score
                    <SortIcon columnKey="score" />
                  </div>
                </TableHead>
                <TableHead className="text-center">Grade</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedCampaigns.slice(0, 15).map((campaign, index) => (
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
                    <span className={campaign.responseRate < 50 ? 'text-red-400' : campaign.responseRate > 70 ? 'text-emerald-400' : ''}>
                      {campaign.responseRate.toFixed(1)}%
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className={campaign.hotRate < 15 ? 'text-amber-400' : campaign.hotRate > 25 ? 'text-emerald-400' : ''}>
                      {campaign.hotRate.toFixed(1)}%
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">
                    {campaign.score}
                  </TableCell>
                  <TableCell className="text-center">
                    <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold border ${gradeColors[campaign.grade]}`}>
                      {campaign.grade}
                    </span>
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
