import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';

interface EcosystemPillsProps {
  hasNexus: boolean;
  hasMentoria: boolean;
  hasNexusEvents?: boolean;
  hasMentoriaEvents?: boolean;
  size?: number;
}

const PILLS = [
  { label: 'D', app: 'dnMarketing', color: '#534AB7', alwaysActive: true },
  { label: 'N', app: 'Nexus', color: '#185FA5', key: 'hasNexus' as const, evKey: 'hasNexusEvents' as const },
  { label: 'M', app: 'mentor.ia', color: '#0F6E56', key: 'hasMentoria' as const, evKey: 'hasMentoriaEvents' as const },
];

export function EcosystemPills({ hasNexus, hasMentoria, hasNexusEvents, hasMentoriaEvents, size = 14 }: EcosystemPillsProps) {
  const activeMap = { hasNexus: hasNexus || !!hasNexusEvents, hasMentoria: hasMentoria || !!hasMentoriaEvents };

  return (
    <TooltipProvider>
      <div className="flex items-center gap-0.5">
        {PILLS.map(pill => {
          const isActive = pill.alwaysActive || (pill.key && activeMap[pill.key]);
          return (
            <Tooltip key={pill.label}>
              <TooltipTrigger asChild>
                <span
                  className="inline-flex items-center justify-center rounded-sm font-bold select-none"
                  style={{
                    width: size,
                    height: size,
                    fontSize: size * 0.65,
                    lineHeight: 1,
                    backgroundColor: pill.color,
                    color: '#fff',
                    opacity: isActive ? 1 : 0.3,
                  }}
                >
                  {pill.label}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                {isActive
                  ? `Presente no ${pill.app}`
                  : `Não está no ${pill.app}`}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
