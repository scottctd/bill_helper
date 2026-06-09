# CALLING SPEC:
# - Purpose: harness-first agent ORM models for threads, runs, transcript, steps, tools, events.
# - Inputs: SQLAlchemy session operations from repositories and API routers.
# - Outputs: mapped tables for canonical agent execution state.
# - Side effects: database persistence through SQLAlchemy.
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, JSON, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import TypeDecorator

from backend.db_meta import Base
from backend.enums_agent import (
    AgentApprovalPolicy,
    AgentChangeStatus,
    AgentChangeType,
    AgentReviewActionType,
    AgentRunEventType,
    AgentRunStatus,
    AgentStepStatus,
    AgentToolCallStatus,
    AgentTranscriptRole,
)
from backend.models_shared import utc_now, uuid_str

_logger = logging.getLogger(__name__)


def _coerce_approval_policy(raw: object) -> AgentApprovalPolicy:
    if isinstance(raw, AgentApprovalPolicy):
        return raw
    key = (str(raw) if raw is not None else "").strip().lower()
    if key in ("", "default"):
        return AgentApprovalPolicy.DEFAULT
    if key == "yolo":
        return AgentApprovalPolicy.YOLO
    _logger.warning(
        "unknown agent_runs.approval_policy value=%r; using %s",
        raw,
        AgentApprovalPolicy.DEFAULT.value,
    )
    return AgentApprovalPolicy.DEFAULT


class _AgentApprovalPolicyColumn(TypeDecorator):
    impl = String(32)
    cache_ok = True

    def process_bind_param(self, value: object, dialect: object) -> str | None:
        if value is None:
            return None
        return _coerce_approval_policy(value).value

    def process_result_value(self, value: object, dialect: object) -> AgentApprovalPolicy | None:
        if value is None:
            return None
        return _coerce_approval_policy(value)


class AgentThread(Base):
    __tablename__ = "agent_threads"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    owner_user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
        nullable=False,
    )

    runs: Mapped[list[AgentRun]] = relationship(
        back_populates="thread",
        cascade="all, delete-orphan",
        order_by="AgentRun.created_at",
    )
    sources: Mapped[list[AgentSessionSource]] = relationship(
        back_populates="thread",
        cascade="all, delete-orphan",
        order_by="AgentSessionSource.created_at",
    )


class AgentRun(Base):
    __tablename__ = "agent_runs"
    __table_args__ = (
        UniqueConstraint("thread_id", "turn_index", name="uq_agent_runs_thread_turn"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    thread_id: Mapped[str | None] = mapped_column(
        ForeignKey("agent_threads.id", ondelete="CASCADE"), nullable=True, index=True
    )
    turn_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[AgentRunStatus] = mapped_column(
        Enum(AgentRunStatus), nullable=False, index=True
    )
    model_name: Mapped[str] = mapped_column(String(255), nullable=False)
    principal_user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    principal_user_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    origin: Mapped[str] = mapped_column(String(64), nullable=False, default="app")
    approval_policy: Mapped[AgentApprovalPolicy] = mapped_column(
        _AgentApprovalPolicyColumn(),
        nullable=False,
        default=AgentApprovalPolicy.DEFAULT,
    )
    max_steps: Mapped[int] = mapped_column(Integer, nullable=False, default=20)
    final_transcript_message_id: Mapped[str | None] = mapped_column(
        ForeignKey("agent_transcript_messages.id", ondelete="SET NULL"),
        nullable=True,
    )
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cache_read_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cache_write_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    input_cost_usd: Mapped[float | None] = mapped_column(nullable=True)
    output_cost_usd: Mapped[float | None] = mapped_column(nullable=True)
    total_cost_usd: Mapped[float | None] = mapped_column(nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    stop_requested: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("0")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False, index=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    thread: Mapped[AgentThread | None] = relationship(back_populates="runs")
    transcript_messages: Mapped[list[AgentTranscriptMessage]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="AgentTranscriptMessage.sequence_index",
        foreign_keys="AgentTranscriptMessage.run_id",
    )
    steps: Mapped[list[AgentStep]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="AgentStep.step_index",
    )
    tool_calls: Mapped[list[AgentToolCall]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="AgentToolCall.call_index",
    )
    events: Mapped[list[AgentRunEvent]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="AgentRunEvent.sequence_index",
    )
    change_items: Mapped[list[AgentChangeItem]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="AgentChangeItem.created_at",
    )


class AgentTranscriptMessage(Base):
    __tablename__ = "agent_transcript_messages"
    __table_args__ = (
        UniqueConstraint("run_id", "sequence_index", name="uq_agent_transcript_run_sequence"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    run_id: Mapped[str] = mapped_column(
        ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sequence_index: Mapped[int] = mapped_column(Integer, nullable=False)
    role: Mapped[AgentTranscriptRole] = mapped_column(
        Enum(AgentTranscriptRole), nullable=False, index=True
    )
    content_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    reasoning_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    tool_request_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    tool_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )

    run: Mapped[AgentRun] = relationship(
        back_populates="transcript_messages",
        foreign_keys=[run_id],
    )
    attachments: Mapped[list[AgentTranscriptAttachment]] = relationship(
        back_populates="transcript_message",
        cascade="all, delete-orphan",
        order_by="AgentTranscriptAttachment.created_at",
    )


class AgentTranscriptAttachment(Base):
    __tablename__ = "agent_transcript_attachments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    transcript_message_id: Mapped[str] = mapped_column(
        ForeignKey("agent_transcript_messages.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_file_id: Mapped[str] = mapped_column(
        ForeignKey("user_files.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )

    transcript_message: Mapped[AgentTranscriptMessage] = relationship(back_populates="attachments")
    user_file: Mapped["UserFile"] = relationship(back_populates="transcript_attachments")

    @property
    def mime_type(self) -> str:
        return self.user_file.mime_type

    @property
    def original_filename(self) -> str | None:
        return self.user_file.original_filename

    @property
    def file_path(self) -> str:
        from backend.services.user_files import resolve_user_file_path

        return str(resolve_user_file_path(self.user_file))


class AgentStep(Base):
    __tablename__ = "agent_steps"
    __table_args__ = (
        UniqueConstraint("run_id", "step_index", name="uq_agent_steps_run_step"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    run_id: Mapped[str] = mapped_column(
        ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    step_index: Mapped[int] = mapped_column(Integer, nullable=False)
    assistant_transcript_message_id: Mapped[str] = mapped_column(
        ForeignKey("agent_transcript_messages.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    status: Mapped[AgentStepStatus] = mapped_column(
        Enum(AgentStepStatus), nullable=False, index=True
    )
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cache_read_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cache_write_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    finish_reason: Mapped[str | None] = mapped_column(String(64), nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    diagnostic_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )

    run: Mapped[AgentRun] = relationship(back_populates="steps")
    assistant_message: Mapped[AgentTranscriptMessage] = relationship(
        foreign_keys=[assistant_transcript_message_id]
    )
    tool_calls: Mapped[list[AgentToolCall]] = relationship(
        back_populates="step",
        cascade="all, delete-orphan",
        order_by="AgentToolCall.call_index",
    )


class AgentToolCall(Base):
    __tablename__ = "agent_tool_calls"
    __table_args__ = (
        UniqueConstraint("step_id", "call_index", name="uq_agent_tool_calls_step_call"),
        UniqueConstraint("run_id", "tool_request_id", name="uq_agent_tool_calls_run_request"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    run_id: Mapped[str] = mapped_column(
        ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    step_id: Mapped[str] = mapped_column(
        ForeignKey("agent_steps.id", ondelete="CASCADE"), nullable=False, index=True
    )
    call_index: Mapped[int] = mapped_column(Integer, nullable=False)
    tool_request_id: Mapped[str] = mapped_column(String(255), nullable=False)
    tool_name: Mapped[str] = mapped_column(String(128), nullable=False)
    arguments_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    status: Mapped[AgentToolCallStatus] = mapped_column(
        Enum(AgentToolCallStatus), nullable=False, index=True
    )
    result_content_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    run: Mapped[AgentRun] = relationship(back_populates="tool_calls")
    step: Mapped[AgentStep] = relationship(back_populates="tool_calls")


class AgentRunEvent(Base):
    __tablename__ = "agent_run_events"
    __table_args__ = (
        UniqueConstraint("run_id", "sequence_index", name="uq_agent_run_events_run_sequence"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    run_id: Mapped[str] = mapped_column(
        ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sequence_index: Mapped[int] = mapped_column(Integer, nullable=False)
    event_type: Mapped[AgentRunEventType] = mapped_column(
        Enum(AgentRunEventType), nullable=False, index=True
    )
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )

    run: Mapped[AgentRun] = relationship(back_populates="events")


class AgentSessionSource(Base):
    __tablename__ = "agent_session_sources"
    __table_args__ = (
        UniqueConstraint(
            "thread_id",
            "user_file_id",
            name="uq_agent_session_sources_thread_file",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    thread_id: Mapped[str] = mapped_column(
        ForeignKey("agent_threads.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_file_id: Mapped[str] = mapped_column(
        ForeignKey("user_files.id", ondelete="CASCADE"), nullable=False, index=True
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )

    thread: Mapped[AgentThread] = relationship(back_populates="sources")
    user_file: Mapped["UserFile"] = relationship(back_populates="session_sources")


class AgentChangeItem(Base):
    __tablename__ = "agent_change_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    run_id: Mapped[str] = mapped_column(
        ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    change_type: Mapped[AgentChangeType] = mapped_column(
        Enum(AgentChangeType), nullable=False, index=True
    )
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    status: Mapped[AgentChangeStatus] = mapped_column(
        Enum(AgentChangeStatus),
        nullable=False,
        default=AgentChangeStatus.PENDING_REVIEW,
        index=True,
    )
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    applied_resource_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    applied_resource_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
        nullable=False,
    )

    run: Mapped[AgentRun] = relationship(back_populates="change_items")
    review_actions: Mapped[list[AgentReviewAction]] = relationship(
        back_populates="change_item",
        cascade="all, delete-orphan",
        order_by="AgentReviewAction.created_at",
    )


class AgentReviewAction(Base):
    __tablename__ = "agent_review_actions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    change_item_id: Mapped[str] = mapped_column(
        ForeignKey("agent_change_items.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    action: Mapped[AgentReviewActionType] = mapped_column(
        Enum(AgentReviewActionType), nullable=False, index=True
    )
    actor: Mapped[str] = mapped_column(String(255), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )

    change_item: Mapped[AgentChangeItem] = relationship(back_populates="review_actions")
