# CALLING SPEC:
# - Purpose: ORM models for backend-orchestrated import jobs and tasks.
# - Inputs: SQLAlchemy session writes from import workflow services.
# - Outputs: `ImportJob` and `ImportTask` mapped classes.
# - Side effects: persisted rows in `import_jobs` and `import_tasks`.
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.db_meta import Base
from backend.enums_agent import AgentApprovalPolicy
from backend.enums_import import ImportJobStatus, ImportTaskStatus
from backend.models_agent import _AgentApprovalPolicyColumn
from backend.models_shared import utc_now, uuid_str


class ImportJob(Base):
    __tablename__ = "import_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    owner_user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[ImportJobStatus] = mapped_column(
        Enum(ImportJobStatus),
        nullable=False,
        default=ImportJobStatus.QUEUED,
        index=True,
    )
    model_name: Mapped[str] = mapped_column(String(255), nullable=False)
    concurrency: Mapped[int] = mapped_column(Integer, nullable=False)
    approval_policy: Mapped[AgentApprovalPolicy] = mapped_column(
        _AgentApprovalPolicyColumn(),
        nullable=False,
        default=AgentApprovalPolicy.DEFAULT,
    )
    instructions: Mapped[str] = mapped_column(Text, nullable=False, default="")
    total_tasks: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed_tasks: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_tasks: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
        nullable=False,
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    tasks: Mapped[list[ImportTask]] = relationship(
        back_populates="job",
        cascade="all, delete-orphan",
        order_by="ImportTask.sequence_index",
    )


class ImportTask(Base):
    __tablename__ = "import_tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid_str)
    job_id: Mapped[str] = mapped_column(
        ForeignKey("import_jobs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    thread_id: Mapped[str] = mapped_column(
        ForeignKey("agent_threads.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_user_file_id: Mapped[str | None] = mapped_column(
        ForeignKey("user_files.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    source_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    source_label: Mapped[str] = mapped_column(String(1024), nullable=False)
    status: Mapped[ImportTaskStatus] = mapped_column(
        Enum(ImportTaskStatus),
        nullable=False,
        default=ImportTaskStatus.QUEUED,
        index=True,
    )
    active_run_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    error_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    sequence_index: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
        nullable=False,
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    job: Mapped[ImportJob] = relationship(back_populates="tasks")
