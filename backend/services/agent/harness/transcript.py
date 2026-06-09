# CALLING SPEC:
# - Purpose: pure transcript validation and assembly helpers.
# - Inputs: TranscriptMessage lists and RunState snapshots.
# - Outputs: validated transcript messages and model-visible transcript slices.
# - Side effects: none.
from __future__ import annotations

from backend.services.agent.harness.contracts import (
    AssistantMessage,
    SystemMessage,
    TranscriptMessage,
    TranscriptMessageRecord,
    UserMessage,
)
from backend.services.agent.harness.errors import HarnessValidationError


def validate_transcript_message(message: TranscriptMessage) -> None:
    if isinstance(message, AssistantMessage):
        if message.tool_requests:
            seen_ids: set[str] = set()
            for request in message.tool_requests:
                if request.tool_request_id in seen_ids:
                    raise HarnessValidationError(
                        f"duplicate tool_request_id: {request.tool_request_id}"
                    )
                seen_ids.add(request.tool_request_id)
                if not request.tool_name.strip():
                    raise HarnessValidationError("tool_name must not be empty")
    if isinstance(message, UserMessage):
        if isinstance(message.content, str) and not message.content.strip():
            if not isinstance(message.content, list):
                pass  # empty user text is allowed when multimodal parts follow


def validate_initial_transcript(transcript: list[TranscriptMessage]) -> None:
    if not transcript:
        raise HarnessValidationError("initial_transcript must not be empty")
    for message in transcript:
        validate_transcript_message(message)


def transcript_messages_from_records(
    records: list[TranscriptMessageRecord],
) -> list[TranscriptMessage]:
    ordered = sorted(records, key=lambda record: record.sequence_index)
    return [record.message for record in ordered]


def model_visible_transcript(
    records: list[TranscriptMessageRecord],
    *,
    include_system_from_current_run_only: bool = True,
) -> list[TranscriptMessage]:
    ordered = sorted(records, key=lambda record: record.sequence_index)
    if not include_system_from_current_run_only:
        return [record.message for record in ordered]

    result: list[TranscriptMessage] = []
    for record in ordered:
        if isinstance(record.message, SystemMessage):
            result = [record.message]
            continue
        result.append(record.message)
    return result


def next_sequence_index(records: list[TranscriptMessageRecord]) -> int:
    if not records:
        return 0
    return max(record.sequence_index for record in records) + 1
