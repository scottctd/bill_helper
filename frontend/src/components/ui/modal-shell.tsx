/**
 * CALLING SPEC:
 * - Purpose: shared Radix dialog shell with size variants, header, body, and footer slots.
 * - Inputs: open state, onOpenChange, optional title/description or custom header, body children, footer node, size variant.
 * - Outputs: ModalShell component wrapping Dialog + DialogContent + DialogHeader/Footer primitives.
 * - Side effects: React rendering; Radix focus trap and overlay when open.
 */

import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "../../lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "./dialog";

export type ModalShellSize = "sm" | "md" | "lg" | "wide" | "xl" | "fullscreen";

const SIZE_CLASS: Record<ModalShellSize, string> = {
  sm: "max-w-lg",
  md: "max-w-xl",
  lg: "max-w-2xl",
  wide: "max-w-4xl",
  xl: "max-w-6xl",
  fullscreen:
    "agent-review-modal-content h-[96vh] w-[96vw] max-w-none overflow-hidden bg-card p-0 sm:w-[94vw] md:w-[92vw] lg:h-[94vh] lg:w-[88vw] xl:w-[78rem]"
};

type DialogContentProps = ComponentPropsWithoutRef<typeof DialogContent>;

export interface ModalShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  size?: ModalShellSize;
  contentClassName?: string;
  title?: ReactNode;
  description?: ReactNode;
  header?: ReactNode;
  headerClassName?: string;
  footer?: ReactNode;
  footerClassName?: string;
  children?: ReactNode;
  onInteractOutside?: DialogContentProps["onInteractOutside"];
  onEscapeKeyDown?: DialogContentProps["onEscapeKeyDown"];
}

export function ModalShell({
  open,
  onOpenChange,
  size = "md",
  contentClassName,
  title,
  description,
  header,
  headerClassName,
  footer,
  footerClassName,
  children,
  onInteractOutside,
  onEscapeKeyDown
}: ModalShellProps) {
  const hasBuiltHeader = header !== undefined || title !== undefined || description !== undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(SIZE_CLASS[size], contentClassName)}
        onInteractOutside={onInteractOutside}
        onEscapeKeyDown={onEscapeKeyDown}
      >
        {hasBuiltHeader ? (
          header ?? (
            <DialogHeader className={headerClassName}>
              {title !== undefined ? <DialogTitle>{title}</DialogTitle> : null}
              {description !== undefined ? <DialogDescription>{description}</DialogDescription> : null}
            </DialogHeader>
          )
        ) : null}
        {children}
        {footer !== undefined ? <DialogFooter className={footerClassName}>{footer}</DialogFooter> : null}
      </DialogContent>
    </Dialog>
  );
}
