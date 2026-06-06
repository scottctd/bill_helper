/**
 * CALLING SPEC:
 * - Purpose: render agent message metadata footer with optional copy action.
 * - Inputs: callers that import `frontend/src/features/agent/panel/AgentMessageHeader.tsx`.
 * - Outputs: `AgentMessageHeader` React component.
 * - Side effects: clipboard writes through nested `CopyButton`.
 */
import { CopyButton } from "../../../components/ui/CopyButton";
import { cn } from "../../../lib/utils";
import { prettyDateTime } from "./format";

interface AgentMessageHeaderProps {
  createdAt: string;
  copyText?: string | null;
  className?: string;
}

export function AgentMessageHeader({ createdAt, copyText, className }: AgentMessageHeaderProps) {
  const normalizedCopyText = copyText?.trim() ?? "";

  return (
    <footer className={cn("agent-message-meta-row", className)}>
      {normalizedCopyText ? (
        <span className="agent-message-meta-actions">
          <CopyButton text={normalizedCopyText} label="Copy message" copiedLabel="Message copied" />
        </span>
      ) : null}
      <span className="muted">{prettyDateTime(createdAt)}</span>
    </footer>
  );
}
