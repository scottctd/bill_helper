/**
 * CALLING SPEC:
 * - Purpose: render the `button` React UI module.
 * - Inputs: callers that import `frontend/src/components/ui/button.tsx` and pass module-defined arguments or framework events.
 * - Outputs: React components and UI helpers exported by `button`.
 * - Side effects: React rendering and user event wiring.
 */
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border text-button-14 transition-colors focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] disabled:pointer-events-none disabled:bg-geist-gray-100 disabled:text-geist-gray-700 disabled:cursor-not-allowed",
  {
    variants: {
      variant: {
        default: "bg-geist-gray-1000 text-white border-transparent hover:bg-geist-gray-900 active:bg-geist-gray-800",
        destructive: "bg-geist-red-800 text-white border-transparent hover:bg-geist-red-900 active:bg-geist-red-1000",
        outline: "bg-background text-foreground border-geist-gray-alpha-400 hover:bg-geist-bg-200 active:bg-geist-gray-200",
        secondary: "bg-secondary text-secondary-foreground border-geist-gray-alpha-400 hover:bg-accent",
        ghost: "text-foreground border-transparent bg-transparent hover:bg-geist-gray-alpha-200 active:bg-geist-gray-alpha-300",
        link: "h-auto p-0 text-foreground underline-offset-4 hover:text-foreground/75 hover:underline border-transparent bg-transparent"
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 px-3",
        lg: "h-12 px-5",
        icon: "h-9 w-9"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
