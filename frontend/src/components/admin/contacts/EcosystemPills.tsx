import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';

interface EcosystemPillsProps {
  hasGrowthHS?: boolean;
  size?: number;
}

// Nexus (agendamento) e mentor.ia saíram da interface (decisão E2, 8E/4) —
// as pílulas eram do ecossistema dn.ia. Ficam só o próprio sistema e o CRM
// (GrowthHS), que é uma pílula à parte.
const PILLS = [
  { label: 'M', app: 'MarketingHS', color: 'var(--color-primary-600)', alwaysActive: true },
  { label: 'G', app: 'GrowthHS', color: 'var(--color-success-700)', key: 'hasGrowthHS' as const },
];

export function EcosystemPills({ hasGrowthHS, size = 14 }: EcosystemPillsProps) {
  const activeMap = {
    hasGrowthHS: !!hasGrowthHS,
  };

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
                    color: 'var(--text-on-primary)',
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
