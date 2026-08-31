import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Hash } from 'lucide-react';

interface TopKeywordsChartProps {
  data: Array<{ keyword: string; count: number }>;
}

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-background/95 backdrop-blur-lg border border-border/50 rounded-xl px-4 py-3 shadow-xl">
        <p className="text-sm font-medium text-foreground">"{data.keyword}"</p>
        <p className="text-sm text-muted-foreground mt-1">
          <span className="text-primary font-semibold">{data.count}</span> menções
        </p>
      </div>
    );
  }
  return null;
};

export function TopKeywordsChart({ data }: TopKeywordsChartProps) {
  const maxCount = Math.max(...data.map(d => d.count), 1);

  return (
    <Card className="bg-gradient-to-br from-card via-card to-primary/10 border-border/50 shadow-lg overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <div className="p-2 rounded-lg bg-primary/20">
            <Hash className="h-5 w-5 text-primary" />
          </div>
          Top 15 Palavras-Chave
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[400px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.slice(0, 15)} layout="vertical" margin={{ top: 10, right: 30, left: 80, bottom: 10 }}>
              <defs>
                <linearGradient id="keywordGradient" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.6} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} horizontal={false} />
              <XAxis type="number" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis 
                dataKey="keyword" 
                type="category" 
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} 
                axisLine={false} 
                tickLine={false}
                width={70}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--accent))', opacity: 0.1 }} />
              <Bar dataKey="count" radius={[0, 6, 6, 0]} maxBarSize={20}>
                {data.slice(0, 15).map((entry, index) => {
                  const intensity = 0.4 + (entry.count / maxCount) * 0.6;
                  return (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={`rgba(222, 26, 17, ${intensity})`}
                    />
                  );
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
