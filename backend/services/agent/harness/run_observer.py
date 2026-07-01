# CALLING SPEC:
# - Purpose: RunObserver protocol for post-terminal harness side effects.
# - Inputs: SQLAlchemy session and terminal RunResult after persistence.
# - Outputs: none; observers perform product-specific reactions.
# - Side effects: defined by concrete observer implementations composed at runtime.
from __future__ import annotations

from typing import Protocol

from sqlalchemy.orm import Session

from backend.services.agent.harness.contracts import RunResult


class RunObserver(Protocol):
    def on_run_terminal(
        self,
        db: Session,
        run_result: RunResult,
        *,
        publish_run_finished_sse: bool = False,
    ) -> None: ...
