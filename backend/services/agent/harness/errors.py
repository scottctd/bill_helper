# CALLING SPEC:
# - Purpose: typed harness errors with stable codes for run terminal states.
# - Inputs: harness layers raise these on validation, provider, or persistence failures.
# - Outputs: HarnessError subclasses with code and detail fields.
# - Side effects: none.
from __future__ import annotations


class HarnessError(Exception):
    code: str = "harness_error"

    def __init__(self, detail: str, *, code: str | None = None) -> None:
        self.detail = detail
        if code is not None:
            self.code = code
        super().__init__(detail)


class HarnessValidationError(HarnessError):
    code = "validation_error"


class HarnessProviderError(HarnessError):
    code = "provider_error"


class HarnessPersistenceError(HarnessError):
    code = "persistence_error"


class HarnessStopRequested(HarnessError):
    code = "interrupted"


class HarnessMaxStepsReached(HarnessError):
    code = "max_steps"
