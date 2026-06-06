/**
 * CALLING SPEC:
 * - Purpose: format agent run error text as assistant-facing markdown.
 * - Inputs: callers that import `frontend/src/features/agent/formatRunError.ts`.
 * - Outputs: markdown strings with fenced code blocks for technical errors.
 * - Side effects: none.
 */

export function formatAgentRunErrorMarkdown(errorText: string): string {
  const trimmed = errorText.trim();
  if (!trimmed) {
    return "";
  }
  return `\`\`\`\n${trimmed}\n\`\`\``;
}
