import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { ExternalLink } from 'lucide-react';

export function QualifiedBanner({ status }: { status: string | null }) {
  if (status !== 'Lead Qualificado') return null;

  return (
    <div className="mx-6 mt-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-between gap-3">
      <p className="text-sm text-blue-400 font-medium">
        Este lead está pronto para o Nexus
      </p>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-blue-500/30 text-blue-400" disabled>
              <ExternalLink className="h-3 w-3" />
              Criar oportunidade no Nexus
            </Button>
          </TooltipTrigger>
          <TooltipContent>Integração com Nexus em breve</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
