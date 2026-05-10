# CALLING SPEC:
# - Purpose: define public API schemas for external-agent sessions and session sources.
# - Inputs: agent session routers and CLI-facing HTTP payloads.
# - Outputs: Pydantic request/response contracts.
# - Side effects: none.
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class AgentSessionSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AgentSessionCreate(AgentSessionSchema):
    title: str | None = Field(default=None, max_length=255)
    summary: str | None = Field(default=None, max_length=20000)


class AgentSessionUpdate(AgentSessionSchema):
    title: str | None = Field(default=None, max_length=255)
    summary: str | None = Field(default=None, max_length=20000)


class AgentSessionRead(AgentSessionSchema):
    id: str
    title: str | None = None
    summary: str | None = None
    created_at: datetime
    updated_at: datetime
    pending_change_count: int = 0
    has_running_run: bool = False


class AgentSessionListRead(AgentSessionSchema):
    sessions: list[AgentSessionRead]


class AgentSessionSourceTextCreate(AgentSessionSchema):
    text: str = Field(min_length=1, max_length=5_000_000)
    filename: str | None = Field(default=None, max_length=255)
    display_name: str | None = Field(default=None, max_length=255)
    note: str | None = Field(default=None, max_length=2000)


class AgentSessionSourceRead(AgentSessionSchema):
    id: str
    session_id: str
    source_id: str
    display_name: str
    original_filename: str | None = None
    mime_type: str
    size_bytes: int
    sha256: str | None = None
    note: str | None = None
    created_at: datetime


class AgentSessionSourceListRead(AgentSessionSchema):
    sources: list[AgentSessionSourceRead]
