/**
 * CALLING SPEC:
 * - Purpose: render a human-readable tag label for breakdown experiment views.
 * - Inputs: tag key and optional className.
 * - Outputs: formatted tag label element.
 * - Side effects: React rendering only.
 */

import { formatBreakdownTagLabel } from "../breakdownHelpers";
import { cn } from "../../../../lib/utils";

type BreakdownTagLabelProps = {
  tag: string;
  className?: string;
};

export function BreakdownTagLabel({ tag, className }: BreakdownTagLabelProps) {
  return <span className={cn("truncate", className)}>{formatBreakdownTagLabel(tag)}</span>;
}
