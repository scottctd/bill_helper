"""Internal `bh` CLI execution for agent runs.

CALLING SPEC:
    run_bh(context, args) -> ToolExecutionResult
    run_terminal(context, args) -> ToolExecutionResult

Inputs:
    - current tool context with run/principal scope
    - command string, optional cwd, timeout
Outputs:
    - structured command result with exit code, stdout, stderr, cwd, and truncation flags
Side effects:
    - mints a short-lived backend session token, runs a `bh ...` CLI invocation, and revokes the token
"""

from __future__ import annotations

from datetime import timedelta
import logging
import os
import shlex
import subprocess
import sys
from time import monotonic
from typing import Any

from sqlalchemy import select

from backend.config import get_settings
from backend.database import open_session
from backend.models_agent import AgentRun
from backend.models_finance import User
from backend.services.agent.tool_args.terminal import RunBhArgs
from backend.services.agent.tool_results import format_lines
from backend.services.agent.tool_types import ToolContext, ToolExecutionResult, ToolExecutionStatus
from backend.services.sessions import create_session, revoke_session_by_id, utc_now

_BH_DISPLAY_CWD = "bh://internal"
_MAX_OUTPUT_CHARS = 12000
logger = logging.getLogger(__name__)


def run_bh(context: ToolContext, args: RunBhArgs) -> ToolExecutionResult:
    try:
        execution = _execute_bh(context, args=args)
    except (subprocess.TimeoutExpired, ValueError) as exc:
        return ToolExecutionResult(
            output_text=format_lines(
                [
                    "ERROR",
                    "summary: bh command failed",
                    f"details: {exc}",
                ]
            ),
            output_json={
                "summary": "bh command failed",
                "details": str(exc),
            },
            status=ToolExecutionStatus.ERROR,
        )
    except Exception as exc:  # pragma: no cover - guarded runtime fallback
        logger.exception(
            "bh runner tool failed unexpectedly: scope=agent_run_bh run_id=%s user_id=%s cwd=%s command=%s error_type=%s",
            context.run_id,
            context.principal_user_id,
            _BH_DISPLAY_CWD,
            args.command,
            type(exc).__name__,
        )
        return ToolExecutionResult(
            output_text=format_lines(
                [
                    "ERROR",
                    "summary: bh command failed",
                    f"details: {exc}",
                ]
            ),
            output_json={
                "summary": "bh command failed",
                "details": str(exc),
            },
            status=ToolExecutionStatus.ERROR,
        )
    return ToolExecutionResult(
        output_text=format_lines(_result_lines(execution)),
        output_json=execution,
        status=ToolExecutionStatus.OK if execution["exit_code"] == 0 else ToolExecutionStatus.ERROR,
    )


def run_terminal(context: ToolContext, args: RunBhArgs) -> ToolExecutionResult:
    return run_bh(context, args)


def _execute_bh(context: ToolContext, *, args: RunBhArgs) -> dict[str, Any]:
    principal_user_id = (context.principal_user_id or "").strip()
    if not principal_user_id:
        raise ValueError("run_bh requires a principal user.")
    thread_id = _thread_id_for_run(context)
    settings = get_settings()
    argv = _parse_bh_command(args.command)
    _validate_hosted_bh_command(argv)
    session_token, session_id = _create_temporary_session(user_id=principal_user_id)
    env = {
        **os.environ,
        "BH_API_BASE_URL": settings.agent_cli_base_url,
        "BH_AUTH_TOKEN": session_token,
        "BH_SESSION_ID": thread_id,
        "BH_THREAD_ID": thread_id,
        "BH_RUN_ID": context.run_id,
    }
    started_at = monotonic()
    try:
        completed = subprocess.run(
            [sys.executable, "-m", "backend.cli.main", *argv[1:]],
            env=env,
            timeout=float(args.timeout_seconds),
            check=False,
            capture_output=True,
            text=True,
        )
        raw_stdout = completed.stdout or ""
        raw_stderr = completed.stderr or ""
        exit_code = int(completed.returncode)
    finally:
        _revoke_temporary_session(session_id=session_id)
    duration_ms = int((monotonic() - started_at) * 1000)
    stdout, stdout_truncated = _truncate_and_scrub(raw_stdout, secret=session_token)
    stderr, stderr_truncated = _truncate_and_scrub(raw_stderr, secret=session_token)
    return {
        "summary": "bh command completed" if exit_code == 0 else "bh command exited non-zero",
        "command": args.command,
        "cwd": _BH_DISPLAY_CWD,
        "exit_code": exit_code,
        "stdout": stdout,
        "stderr": stderr,
        "stdout_truncated": stdout_truncated,
        "stderr_truncated": stderr_truncated,
        "duration_ms": duration_ms,
    }


def _parse_bh_command(command: str) -> list[str]:
    try:
        argv = shlex.split(command)
    except ValueError as exc:
        raise ValueError(f"Invalid command: {exc}") from exc
    if not argv:
        raise ValueError("Command is empty. Use `bh ...`.")
    if argv[0] != "bh":
        raise ValueError("run_bh only supports `bh ...` commands.")
    return argv


def _validate_hosted_bh_command(argv: list[str]) -> None:
    command_tokens = _bh_command_tokens(argv)
    if not command_tokens:
        return
    if command_tokens[0] in {"instruction", "login"}:
        raise ValueError("`bh login` and `bh instruction` are for external agents; hosted runs already receive auth and app rules.")
    if command_tokens[0] == "entries" and len(command_tokens) >= 2 and command_tokens[1] == "import":
        _reject_hosted_file_flags(
            command_tokens[2:],
            file_flag_names=("--payload-file",),
            command_label="Hosted `bh entries import`",
            inline_hint="pass --payload-json instead.",
        )
        return
    if command_tokens[0] != "sessions":
        return
    if len(command_tokens) < 2 or command_tokens[1] != "update":
        raise ValueError(
            "Hosted runs cannot list, create, switch, get, or attach session sources. "
            "The app owns session management; use `bh sessions update` only for the current session."
        )
    _validate_hosted_session_update(command_tokens[2:])


def _bh_command_tokens(argv: list[str]) -> list[str]:
    tokens = argv[1:]
    index = 0
    while index < len(tokens):
        token = tokens[index]
        if token == "--format":
            index += 2
            continue
        if token.startswith("--format="):
            index += 1
            continue
        break
    return tokens[index:]


def _validate_hosted_session_update(tokens: list[str]) -> None:
    _reject_hosted_file_flags(
        tokens,
        file_flag_names=("--summary-file",),
        command_label="Hosted `bh sessions update`",
        inline_hint="pass --summary text instead.",
    )
    index = 0
    while index < len(tokens):
        token = tokens[index]
        if token in {"--title", "--summary", "--format"}:
            index += 2
            continue
        if token.startswith("--title=") or token.startswith("--summary=") or token.startswith("--format="):
            index += 1
            continue
        if token.startswith("-"):
            index += 1
            continue
        raise ValueError("Hosted `bh sessions update` can update only the current session; omit session_id.")


def _reject_hosted_file_flags(
    tokens: list[str],
    *,
    file_flag_names: tuple[str, ...],
    command_label: str,
    inline_hint: str,
) -> None:
    for token in tokens:
        for flag_name in file_flag_names:
            if token == flag_name or token.startswith(f"{flag_name}="):
                raise ValueError(f"{command_label} cannot read local files; {inline_hint}")


def _thread_id_for_run(context: ToolContext) -> str:
    thread_id = context.db.scalar(select(AgentRun.thread_id).where(AgentRun.id == context.run_id))
    if not isinstance(thread_id, str) or not thread_id:
        raise ValueError("run_bh requires a valid run/thread context.")
    return thread_id


def _create_temporary_session(*, user_id: str) -> tuple[str, str]:
    db = open_session()
    try:
        user = db.get(User, user_id)
        if user is None:
            raise ValueError("Terminal tool user not found.")
        expires_at = utc_now() + timedelta(minutes=10)
        token, session_row = create_session(
            db,
            user=user,
            expires_at=expires_at,
        )
        db.commit()
        return token, session_row.id
    finally:
        db.close()


def _revoke_temporary_session(*, session_id: str) -> None:
    db = open_session()
    try:
        revoke_session_by_id(db, session_id=session_id)
        db.commit()
    finally:
        db.close()


def _truncate_and_scrub(value: str, *, secret: str) -> tuple[str, bool]:
    scrubbed = value.replace(secret, "***") if secret else value
    if len(scrubbed) <= _MAX_OUTPUT_CHARS:
        return scrubbed, False
    return scrubbed[:_MAX_OUTPUT_CHARS], True


def _result_lines(payload: dict[str, Any]) -> list[str]:
    return [
        "OK" if payload["exit_code"] == 0 else "ERROR",
        f"summary: {payload['summary']}",
        f"exit_code: {payload['exit_code']}",
        f"cwd: {payload['cwd']}",
        f"duration_ms: {payload['duration_ms']}",
        f"stdout_truncated: {payload['stdout_truncated']}",
        f"stderr_truncated: {payload['stderr_truncated']}",
        f"stdout: {payload['stdout']}",
        f"stderr: {payload['stderr']}",
    ]
