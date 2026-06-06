/**
 * CALLING SPEC:
 * - Purpose: copy plain text to the system clipboard.
 * - Inputs: callers that import `frontend/src/lib/copyToClipboard.ts` with a text string.
 * - Outputs: `copyTextToClipboard` promise resolving to success boolean.
 * - Side effects: writes to the clipboard when permitted.
 */

export async function copyTextToClipboard(text: string): Promise<boolean> {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(normalized);
      return true;
    } catch {
      // Fall through to the legacy copy path.
    }
  }

  if (typeof document === "undefined") {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = normalized;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    document.body.removeChild(textarea);
  }
  return copied;
}
