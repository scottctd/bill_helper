/**
 * CALLING SPEC:
 * - Purpose: render a compact icon button that copies text to the clipboard.
 * - Inputs: callers that import `frontend/src/components/ui/CopyButton.tsx`.
 * - Outputs: `CopyButton` React component.
 * - Side effects: clipboard writes on click.
 */
import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

import { copyTextToClipboard } from "../../lib/copyToClipboard";
import { cn } from "../../lib/utils";
import { Button, type ButtonProps } from "./button";

interface CopyButtonProps extends Omit<ButtonProps, "children" | "onClick"> {
  text: string;
  label?: string;
  copiedLabel?: string;
  showLabel?: boolean;
}

export function CopyButton({
  text,
  label = "Copy",
  copiedLabel = "Copied",
  showLabel = false,
  className,
  type = "button",
  variant = "ghost",
  size,
  disabled,
  ...buttonProps
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const resetTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimeoutRef.current !== null) {
        window.clearTimeout(resetTimeoutRef.current);
      }
    };
  }, []);

  async function handleCopy() {
    const didCopy = await copyTextToClipboard(text);
    if (!didCopy) {
      return;
    }
    setCopied(true);
    if (resetTimeoutRef.current !== null) {
      window.clearTimeout(resetTimeoutRef.current);
    }
    resetTimeoutRef.current = window.setTimeout(() => {
      setCopied(false);
      resetTimeoutRef.current = null;
    }, 2000);
  }

  const activeLabel = copied ? copiedLabel : label;

  return (
    <Button
      type={type}
      variant={variant}
      size={size ?? (showLabel ? "sm" : "icon")}
      className={cn(
        showLabel
          ? "h-8 w-auto shrink-0 gap-1.5 rounded-sm px-2.5 text-muted-foreground shadow-none hover:bg-secondary hover:text-foreground"
          : "h-7 w-7 shrink-0 rounded-md p-0 text-muted-foreground shadow-none hover:bg-secondary hover:text-foreground",
        className
      )}
      aria-label={activeLabel}
      title={activeLabel}
      disabled={disabled || !text.trim()}
      onClick={() => {
        void handleCopy();
      }}
      {...buttonProps}
    >
      {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      {showLabel ? <span>{activeLabel}</span> : null}
    </Button>
  );
}
