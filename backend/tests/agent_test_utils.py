from __future__ import annotations

import json
import time
from typing import Any

import pymupdf


def patch_model(monkeypatch, handler: Any) -> None:
    from backend.services.agent import runtime
    from backend.services.agent.model_gateway import LiteLLMModelGateway, StreamingLiteLLMModelGateway
    from backend.services.agent.model_gateway_support.conversion import (
        canonical_transcript_to_provider,
        provider_response_to_decision,
    )

    def wrapped(messages, **_kwargs):
        return handler(messages)

    def wrapped_stream(messages, **_kwargs):
        message = handler(messages)
        reasoning = str(message.get("reasoning") or "").strip()
        if reasoning:
            yield {"type": "reasoning_delta", "delta": reasoning}
        content = str(message.get("content") or "")
        if content:
            yield {"type": "text_delta", "delta": content}
        yield {"type": "done", "message": message}

    def hydrated_transcript(gateway_self, request):
        from backend.services.agent.model_gateway_support.transcript_hydration import (
            hydrate_transcript_user_attachments,
        )

        transcript = request.transcript
        run_id = str(request.trace_metadata.get("run_id") or getattr(gateway_self, "_run_id", "") or "")
        if run_id:
            transcript = hydrate_transcript_user_attachments(
                gateway_self._db,
                run_id=run_id,
                transcript=transcript,
                attachments_use_ocr=False,
            )
        return transcript

    def gateway_complete(self, request, **_kwargs):
        response = wrapped(canonical_transcript_to_provider(hydrated_transcript(self, request)))
        decision = provider_response_to_decision(
            response,
            provider_model=request.model_params.model_name,
        )
        return self._normalize_decision_for_thread(decision, thread=self._resolve_thread(request))

    def gateway_stream_complete(self, request, **_kwargs):
        from backend.services.agent.harness.contracts import ModelDeltaEvent

        step_index = int(request.trace_metadata.get("step_index") or self._step_index)
        final_message: dict[str, Any] | None = None
        for chunk in wrapped_stream(canonical_transcript_to_provider(hydrated_transcript(self, request))):
            chunk_type = chunk.get("type")
            if chunk_type == "reasoning_delta":
                self._event_sink.publish(
                    ModelDeltaEvent(
                        run_id=self._run_id,
                        step_index=step_index,
                        delta_type="reasoning",
                        text=str(chunk.get("delta") or ""),
                    )
                )
            elif chunk_type == "text_delta":
                self._event_sink.publish(
                    ModelDeltaEvent(
                        run_id=self._run_id,
                        step_index=step_index,
                        delta_type="content",
                        text=str(chunk.get("delta") or ""),
                    )
                )
            elif chunk_type == "done":
                final_message = chunk.get("message") or {}
        if final_message is None:
            raise RuntimeError("streaming model response ended without done event")
        decision = provider_response_to_decision(
            final_message,
            provider_model=request.model_params.model_name,
        )
        return self._normalize_decision_for_thread(decision, thread=self._resolve_thread(request))

    monkeypatch.setattr(LiteLLMModelGateway, "complete", gateway_complete)
    monkeypatch.setattr(StreamingLiteLLMModelGateway, "complete", gateway_stream_complete)
    monkeypatch.setattr(runtime, "call_model", lambda messages, _db, **kwargs: wrapped(messages, **kwargs))
    monkeypatch.setattr(
        runtime,
        "call_model_stream",
        lambda messages, _db, **kwargs: wrapped_stream(messages, **kwargs),
    )
    for target in (
        "backend.services.agent.model_client_support.client.LiteLLMModelClient",
    ):
        monkeypatch.setattr(f"{target}.complete", lambda self, messages, **kwargs: wrapped(messages, **kwargs))
        monkeypatch.setattr(
            f"{target}.complete_stream",
            lambda self, messages, **kwargs: wrapped_stream(messages, **kwargs),
        )


def sse_text_deltas(events: list[dict]) -> str:
    return "".join(
        event.get("text", "")
        for event in events
        if event.get("type") == "model_delta" and event.get("delta_type") == "content"
    )


def sse_reasoning_deltas(events: list[dict]) -> list[str]:
    return [
        event.get("text", "")
        for event in events
        if event.get("type") == "model_delta" and event.get("delta_type") == "reasoning"
    ]


def create_thread(client) -> dict:
    response = client.post("/api/v1/agent/threads", json={})
    response.raise_for_status()
    return response.json()


def wait_for_run_completion(
    client,
    run_id: str,
    *,
    timeout_seconds: float = 2.0,
) -> dict:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        run_response = client.get(f"/api/v1/agent/runs/{run_id}")
        run_response.raise_for_status()
        run = run_response.json()
        if run.get("status") != "running":
            return run
        time.sleep(0.01)

    raise AssertionError("Timed out waiting for agent run to complete")


def send_message(
    client,
    thread_id: str,
    content: str,
    *,
    surface: str = "app",
    files: list[tuple[str, bytes, str]] | None = None,
    attachment_ids: list[str] | None = None,
    attachments_use_ocr: bool = True,
    model_name: str | None = None,
    approval_policy: str | None = None,
    wait_for_completion: bool = True,
    timeout_seconds: float = 2.0,
) -> dict:
    request_files = [
        ("files", (filename, file_bytes, mime_type))
        for filename, file_bytes, mime_type in files or []
    ]
    request_files.extend(
        ("attachment_ids", (None, attachment_id))
        for attachment_id in attachment_ids or []
    )
    request_data = {
        "content": content,
        "surface": surface,
        "attachments_use_ocr": str(attachments_use_ocr).lower(),
        "model_name": model_name or "",
    }
    if approval_policy is not None:
        request_data["approval_policy"] = approval_policy
    response = client.post(
        f"/api/v1/agent/threads/{thread_id}/messages",
        data=request_data,
        files=request_files or None,
    )
    response.raise_for_status()
    run = response.json()
    if not wait_for_completion or run.get("status") != "running":
        return run

    return wait_for_run_completion(client, run["id"], timeout_seconds=timeout_seconds)


def build_pdf_bytes(page_texts: list[str]) -> bytes:
    document = pymupdf.open()
    for text in page_texts:
        page = document.new_page()
        page.insert_text((72, 72), text)
    pdf_bytes = document.tobytes()
    document.close()
    return pdf_bytes


def create_entity(client, name: str, category: str | None = None) -> dict:
    payload = {"name": name}
    if category is not None:
        payload["category"] = category
    response = client.post("/api/v1/entities", json=payload)
    response.raise_for_status()
    return response.json()


def create_tag(
    client,
    name: str,
    *,
    type_name: str | None = None,
    description: str | None = None,
) -> dict:
    payload: dict[str, str] = {"name": name}
    if type_name is not None:
        payload["type"] = type_name
    if description is not None:
        payload["description"] = description
    response = client.post("/api/v1/tags", json=payload)
    response.raise_for_status()
    return response.json()


def turn_message_roles(detail: dict) -> list[str]:
    roles: list[str] = []
    for turn in detail.get("turns", []):
        roles.append(turn["user_message"]["role"])
        assistant = turn.get("assistant_message")
        if assistant is not None:
            roles.append(assistant["role"])
    return roles


def flatten_turn_messages(detail: dict) -> list[dict]:
    messages: list[dict] = []
    for turn in detail.get("turns", []):
        messages.append(turn["user_message"])
        assistant = turn.get("assistant_message")
        if assistant is not None:
            messages.append(assistant)
    return messages


def flatten_user_content(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        text_parts = [
            part.get("text", "")
            for part in content
            if isinstance(part, dict) and part.get("type") == "text"
        ]
        return "\n\n".join(part for part in text_parts if part)
    return ""


def parse_sse_text(raw: str) -> list[dict]:
    events: list[dict] = []
    for block in raw.replace("\r\n", "\n").split("\n\n"):
        lines = [line for line in block.split("\n") if line.strip()]
        if not lines:
            continue
        event_type = ""
        payload = None
        for line in lines:
            if line.startswith("event:"):
                event_type = line.split(":", 1)[1].strip()
            elif line.startswith("data:"):
                payload = json.loads(line.split(":", 1)[1].strip())
        if isinstance(payload, dict):
            if event_type:
                payload["event_name"] = event_type
            events.append(payload)
    return events


def collect_sse_events(
    client,
    thread_id: str,
    content: str,
    *,
    surface: str = "app",
    model_name: str | None = None,
) -> list[dict]:
    with client.stream(
        "POST",
        f"/api/v1/agent/threads/{thread_id}/messages/stream",
        data={
            "content": content,
            "surface": surface,
            "model_name": model_name or "",
        },
    ) as response:
        response.raise_for_status()
        raw = "".join(response.iter_text())

    return parse_sse_text(raw)


def collect_run_sse_events(
    client,
    run_id: str,
    *,
    after_sequence: int = 0,
) -> list[dict]:
    with client.stream(
        "GET",
        f"/api/v1/agent/runs/{run_id}/stream",
        params={"after_sequence": after_sequence},
    ) as response:
        response.raise_for_status()
        raw = "".join(response.iter_text())
    return parse_sse_text(raw)
