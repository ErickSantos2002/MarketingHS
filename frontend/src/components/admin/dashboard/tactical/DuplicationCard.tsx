import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, Copy } from 'lucide-react';

interface DuplicationCardProps {
  data: {
    count: number;
    percentage: number;
    duplicateEmails: Array<{ email: string; count: number }>;
  };
}

export function DuplicationCard({ data }: DuplicationCardProps) {
  const isClean = data.count === 0;

  return (
    <Card className={`border-border/50 shadow-lg overflow-hidden ${
      isClean 
        ? 'bg-gradient-to-br from-card via-card to-emerald-950/10' 
        : 'bg-gradient-to-br from-card via-card to-yellow-950/10'
    }`}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <div className={`p-2 rounded-lg ${isClean ? 'bg-emerald-500/20' : 'bg-yellow-500/20'}`}>
            {isClean ? (
              <Copy className="h-5 w-5 text-emerald-400" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-yellow-400" />
            )}
          </div>
          Duplicatas de E-mail
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-center py-4">
          <div className={`text-4xl font-bold ${isClean ? 'text-emerald-400' : 'text-yellow-400'}`}>
            {data.count}
          </div>
          <div className="text-sm text-muted-foreground mt-1">
            {isClean ? 'Base limpa!' : `${data.percentage.toFixed(1)}% duplicados`}
          </div>
        </div>

        {!isClean && data.duplicateEmails.length > 0 && (
          <div className="border-t border-border/50 pt-4 mt-4">
            <div className="text-xs text-muted-foreground mb-2">Top duplicatas:</div>
            <div className="space-y-2 max-h-[150px] overflow-y-auto">
              {data.duplicateEmails.slice(0, 5).map(({ email, count }) => (
                <div 
                  key={email} 
                  className="flex items-center justify-between text-sm p-2 rounded bg-muted/10"
                >
                  <span className="truncate text-muted-foreground max-w-[180px]" title={email}>
                    {email}
                  </span>
                  <span className="text-yellow-400 font-medium">×{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
