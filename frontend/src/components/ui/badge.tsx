import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  {
    variants: {
      variant: {
        default: "bg-[--tint-primary] text-[--on-tint-primary] border-[--action-tint-border]",
        secondary: "bg-[--tint-neutral] text-[--on-tint-neutral] border-border",
        destructive: "bg-[--tint-danger] text-[--on-tint-danger] border-danger/30",
        outline: "bg-transparent text-conteudo border-border",
        success: "bg-[--tint-success] text-[--on-tint-success] border-success/30",
        warning: "bg-[--tint-warning] text-[--on-tint-warning] border-warning/30",
        info: "bg-[--tint-info] text-[--on-tint-info] border-info/30",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
