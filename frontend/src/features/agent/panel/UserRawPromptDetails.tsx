/**
 * CALLING SPEC:
 * - Purpose: collapsible raw model prompt disclosure for user chat bubbles.
 * - Inputs: full raw prompt text when it differs from the displayed user message.
 * - Outputs: collapsed `<details>` with monospace prompt body.
 * - Side effects: none.
 */
interface UserRawPromptDetailsProps {
  rawPromptMarkdown: string;
}

export function UserRawPromptDetails({ rawPromptMarkdown }: UserRawPromptDetailsProps) {
  return (
    <details className="agent-user-raw-prompt">
      <summary className="agent-user-raw-prompt-summary">Raw prompt</summary>
      <pre className="agent-user-raw-prompt-text">{rawPromptMarkdown}</pre>
    </details>
  );
}
