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
    <Card className={`overflow-hidden ${
      isClean
        ? 'bg-[--tint-success] border-success/30'
        : 'bg-[--tint-warning] border-warning/30'
    }`}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <div className={`p-2 rounded-lg ${isClean ? 'bg-[--tint-success]' : 'bg-[--tint-warning]'}`}>
            {isClean ? (
              <Copy className="h-5 w-5 text-[--on-tint-success]" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-[--on-tint-warning]" />
            )}
          </div>
          Duplicatas de E-mail
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-center py-4">
          <div className={`text-4xl font-bold ${isClean ? 'text-[--on-tint-success]' : 'text-[--on-tint-warning]'}`}>
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
                  <span className="text-[--on-tint-warning] font-medium">×{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
