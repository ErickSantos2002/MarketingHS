import { cn } from '@/lib/utils';
import dniaLogo from '@/assets/dnia-logo.png';

interface DniaLogoProps {
  className?: string;
}

export function DniaLogo({ className }: DniaLogoProps) {
  return (
    <img
      src={dniaLogo}
      alt="dn.ia"
      className={cn("h-5", className)}
    />
  );
}
