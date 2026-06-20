/**
 * CALLING SPEC:
 * - Purpose: render the `input` React UI module.
 * - Inputs: callers that import `frontend/src/components/ui/input.tsx` and pass module-defined arguments or framework events.
 * - Outputs: React components and UI helpers exported by `input`.
 * - Side effects: React rendering and user event wiring.
 */
import * as React from "react";

import { cn } from "../../lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        "flex h-10 w-full rounded-sm border border-input bg-background px-3 py-2 text-copy-14 text-foreground shadow-none transition-colors file:border-0 file:bg-transparent file:text-copy-14 file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] disabled:cursor-not-allowed disabled:bg-muted/50 disabled:opacity-60",
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Input.displayName = "Input";

export { Input };
