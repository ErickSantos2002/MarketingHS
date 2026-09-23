import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium leading-tight ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-action text-primary-foreground border border-action hover:bg-action-hover",
        destructive: "bg-danger text-destructive-foreground border border-danger hover:bg-danger/90",
        outline: "border border-borda bg-surface text-conteudo hover:bg-surface-elevated",
        secondary: "border border-borda bg-surface text-conteudo hover:bg-surface-elevated",
        ghost: "border border-transparent text-conteudo-muted hover:bg-surface-elevated",
        link: "border border-transparent text-[--text-link] underline-offset-4 hover:underline",
      },
      size: {
        default: "py-2 px-4 text-sm",
        sm: "py-1.5 px-3 text-xs",
        lg: "py-3 px-6 text-base",
        icon: "h-9 w-9 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
