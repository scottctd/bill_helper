/**
 * CALLING SPEC:
 * - Purpose: render the `textarea` React UI module.
 * - Inputs: callers that import `frontend/src/components/ui/textarea.tsx` and pass module-defined arguments or framework events.
 * - Outputs: React components and UI helpers exported by `textarea`.
 * - Side effects: React rendering and user event wiring.
 */
import * as React from "react";

import { cn } from "../../lib/utils";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-28 w-full rounded-sm border border-input bg-background px-3 py-2.5 text-copy-14 text-foreground shadow-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] disabled:cursor-not-allowed disabled:bg-muted/50 disabled:opacity-60",
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
