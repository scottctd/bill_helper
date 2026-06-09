# CALLING SPEC:
# - Purpose: normalize persisted assistant reply text for API projection.
# - Inputs: raw assistant markdown from canonical transcript rows.
# - Outputs: user-facing assistant content with empty operational footers removed.
# - Side effects: none.
from __future__ import annotations

import re

EMPTY_PENDING_REVIEW_FOOTER_PATTERN = re.compile(
    r"^\s*Tools used \(high level\):.*Pending review item ids:\s*\[\s*\]\s*$",
    re.IGNORECASE | re.MULTILINE,
)


def final_assistant_content(content: str | None) -> str | None:
    if content is None:
        return None
    normalized = content.strip()
    if not normalized:
        return None
    cleaned = EMPTY_PENDING_REVIEW_FOOTER_PATTERN.sub("", normalized)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    return cleaned or None
