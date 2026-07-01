# CALLING SPEC:
# - Purpose: shared tenacity retry configuration for model completions and tool execution.
# - Inputs: runtime-settings retry fields or explicit model-client retry parameters.
# - Outputs: configured tenacity Retrying instances for callers to iterate.
# - Side effects: none; callers own attempt loops and exception handling.
from __future__ import annotations

from collections.abc import Callable

from tenacity import Retrying, retry_if_exception, retry_if_exception_type, stop_after_attempt, wait_exponential

from backend.services.crud_policy import PolicyViolation


def build_model_client_retrying(
    *,
    max_attempts: int,
    initial_wait_seconds: float,
    max_wait_seconds: float,
    backoff_multiplier: float,
    retry_exception_type: type[Exception],
) -> Retrying:
    return Retrying(
        stop=stop_after_attempt(max(1, max_attempts)),
        wait=wait_exponential(
            multiplier=max(0.0, initial_wait_seconds),
            max=max(0.0, max_wait_seconds),
            exp_base=max(1.0, backoff_multiplier),
        ),
        retry=retry_if_exception_type(retry_exception_type),
        reraise=True,
    )


def build_tool_execution_retrying(
    *,
    max_attempts: int,
    initial_wait_seconds: float,
    max_wait_seconds: float,
    backoff_multiplier: float,
    non_retryable: tuple[type[Exception], ...] = (PolicyViolation, ValueError),
) -> Retrying:
    return Retrying(
        stop=stop_after_attempt(max_attempts),
        wait=wait_exponential(
            multiplier=initial_wait_seconds,
            max=max_wait_seconds,
            exp_base=backoff_multiplier,
        ),
        retry=retry_if_exception(
            lambda exc, _non_retryable=non_retryable: not isinstance(exc, _non_retryable)
        ),
        reraise=True,
    )


def run_with_retrying(
    retrying: Retrying,
    operation: Callable[[], object],
) -> object | None:
    result = None
    for attempt in retrying:
        with attempt:
            result = operation()
    return result
