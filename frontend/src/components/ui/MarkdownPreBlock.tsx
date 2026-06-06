/**
 * CALLING SPEC:
 * - Purpose: render markdown fenced code blocks with a copy affordance.
 * - Inputs: callers that import `frontend/src/components/ui/MarkdownPreBlock.tsx`.
 * - Outputs: `MarkdownPreBlock` React component.
 * - Side effects: clipboard writes through nested `CopyButton`.
 */
import type { ReactNode } from "react";

import { CopyButton } from "./CopyButton";

function extractNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(extractNodeText).join("");
  }
  if (node && typeof node === "object" && "props" in node) {
    const props = node.props as { children?: ReactNode };
    return extractNodeText(props.children);
  }
  return "";
}

interface MarkdownPreBlockProps {
  children?: ReactNode;
}

export function MarkdownPreBlock({ children, ...props }: MarkdownPreBlockProps & Record<string, unknown>) {
  const codeText = extractNodeText(children).replace(/\n$/, "");

  return (
    <div className="agent-markdown-pre-shell">
      <CopyButton text={codeText} label="Copy code" copiedLabel="Code copied" className="agent-markdown-pre-copy" />
      <pre {...props}>{children}</pre>
    </div>
  );
}
