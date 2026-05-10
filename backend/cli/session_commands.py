"""Session command wiring for the `bh` CLI.

CALLING SPEC:
    add_sessions_parser(subparsers, add_format_option) -> None

Inputs:
    - argparse subparser collection and the shared format-option helper
Outputs:
    - registered `bh sessions ...` parser commands
Side effects:
    - performs session/source HTTP calls when registered handlers run
"""

from __future__ import annotations

import argparse
from collections.abc import Callable
from pathlib import Path
from typing import Any

from backend.cli.support import (
    CliContext,
    CliError,
    request_multipart,
    request_json,
    resolve_session_id,
    resolve_thread_id,
    save_cli_config,
)


AddFormatOption = Callable[[argparse.ArgumentParser], None]


def add_sessions_parser(subparsers, add_format_option: AddFormatOption) -> None:
    parser = subparsers.add_parser("sessions", help="External-agent session commands.")
    parser.set_defaults(help_parser=parser)
    sessions = parser.add_subparsers(dest="sessions_command")

    list_parser = sessions.add_parser("list", help="List sessions.")
    add_format_option(list_parser)
    list_parser.set_defaults(handler=_handle_sessions_list, render_key="sessions_list")

    create_parser = sessions.add_parser("create", help="Create a session.")
    add_format_option(create_parser)
    create_parser.add_argument("--title", default=None)
    create_parser.add_argument("--summary", default=None)
    create_parser.add_argument("--use", action="store_true", help="Save the created session as the current CLI session.")
    create_parser.set_defaults(handler=_handle_sessions_create, render_key="sessions_detail")

    use_parser = sessions.add_parser("use", help="Save a session as the current CLI session.")
    add_format_option(use_parser)
    use_parser.add_argument("session_id", help="Full session id or unique short id prefix.")
    use_parser.set_defaults(handler=_handle_sessions_use, render_key="sessions_detail")

    get_parser = sessions.add_parser("get", help="Get a session.")
    add_format_option(get_parser)
    get_parser.add_argument("session_id", nargs="?", help="Full session id or unique short id prefix. Defaults to current session.")
    get_parser.set_defaults(handler=_handle_sessions_get, render_key="sessions_detail")

    update_parser = sessions.add_parser("update", help="Update a session title or summary.")
    add_format_option(update_parser)
    update_parser.add_argument("session_id", nargs="?", help="Full session id or unique short id prefix. Defaults to current session.")
    update_parser.add_argument("--title", default=None)
    update_parser.add_argument("--summary", default=None)
    update_parser.add_argument("--summary-file", default=None)
    update_parser.set_defaults(handler=_handle_sessions_update, render_key="sessions_detail")

    sources_parser = sessions.add_parser("sources", help="Manage sources on a session.")
    sources_parser.set_defaults(help_parser=sources_parser)
    sources = sources_parser.add_subparsers(dest="session_sources_command")

    sources_list = sources.add_parser("list", help="List session sources.")
    add_format_option(sources_list)
    sources_list.add_argument("session_id", nargs="?", help="Full session id or unique short id prefix. Defaults to current session.")
    sources_list.set_defaults(handler=_handle_session_sources_list, render_key="sources_list")

    sources_text = sources.add_parser("add-text", help="Attach text as a session source.")
    add_format_option(sources_text)
    sources_text.add_argument("--session-id", default=None, help="Full session id or unique short id prefix. Defaults to current session.")
    text_group = sources_text.add_mutually_exclusive_group(required=True)
    text_group.add_argument("--text", default=None)
    text_group.add_argument("--text-file", default=None)
    sources_text.add_argument("--filename", default=None)
    sources_text.add_argument("--display-name", default=None)
    sources_text.add_argument("--note", default=None)
    sources_text.set_defaults(handler=_handle_session_sources_add_text, render_key="source_detail")

    sources_file = sources.add_parser("add-file", help="Attach a local file as a session source.")
    add_format_option(sources_file)
    sources_file.add_argument("path", help="Local text, image, or PDF file path.")
    sources_file.add_argument("--session-id", default=None, help="Full session id or unique short id prefix. Defaults to current session.")
    sources_file.add_argument("--note", default=None, help="Short source note.")
    sources_file.set_defaults(handler=_handle_session_sources_add_file, render_key="source_detail")


def _handle_sessions_list(_args: argparse.Namespace, context: CliContext | None) -> Any:
    assert context is not None
    _, payload = request_json(context, "GET", "/agent/sessions")
    return payload


def _handle_sessions_create(args: argparse.Namespace, context: CliContext | None) -> Any:
    assert context is not None
    _, payload = request_json(
        context,
        "POST",
        "/agent/sessions",
        json_body={"title": args.title, "summary": args.summary},
    )
    if args.use:
        save_cli_config({"session_id": payload.get("id")})
    return payload


def _handle_sessions_use(args: argparse.Namespace, context: CliContext | None) -> Any:
    assert context is not None
    session_id = resolve_session_id(context, session_id=args.session_id)
    _, payload = request_json(context, "GET", f"/agent/sessions/{session_id}")
    save_cli_config({"session_id": payload.get("id")})
    return payload


def _handle_sessions_get(args: argparse.Namespace, context: CliContext | None) -> Any:
    assert context is not None
    session_id = _resolve_session_argument(context, override=args.session_id)
    _, payload = request_json(context, "GET", f"/agent/sessions/{session_id}")
    return payload


def _handle_sessions_update(args: argparse.Namespace, context: CliContext | None) -> Any:
    assert context is not None
    session_id = _resolve_session_argument(context, override=args.session_id)
    update_payload: dict[str, Any] = {}
    if args.title is not None:
        update_payload["title"] = args.title
    if args.summary_file is not None:
        update_payload["summary"] = Path(args.summary_file).read_text(encoding="utf-8")
    elif args.summary is not None:
        update_payload["summary"] = args.summary
    if not update_payload:
        raise CliError("Provide --title, --summary, or --summary-file.")
    _, payload = request_json(
        context,
        "PATCH",
        f"/agent/sessions/{session_id}",
        json_body=update_payload,
    )
    return payload


def _handle_session_sources_list(args: argparse.Namespace, context: CliContext | None) -> Any:
    assert context is not None
    session_id = _resolve_session_argument(context, override=args.session_id)
    _, payload = request_json(context, "GET", f"/agent/sessions/{session_id}/sources")
    return payload


def _handle_session_sources_add_text(args: argparse.Namespace, context: CliContext | None) -> Any:
    assert context is not None
    session_id = _resolve_session_argument(context, override=args.session_id)
    source_text = args.text
    if args.text_file is not None:
        source_text = Path(args.text_file).read_text(encoding="utf-8")
    _, payload = request_json(
        context,
        "POST",
        f"/agent/sessions/{session_id}/sources/text",
        json_body={
            "text": source_text,
            "filename": args.filename,
            "display_name": args.display_name,
            "note": args.note,
        },
    )
    return payload


def _handle_session_sources_add_file(args: argparse.Namespace, context: CliContext | None) -> Any:
    assert context is not None
    session_id = _resolve_session_argument(context, override=args.session_id)
    path = Path(args.path)
    if not path.is_file():
        raise CliError(f"Source file not found: {path}")
    _, payload = request_multipart(
        context,
        "POST",
        f"/agent/sessions/{session_id}/sources",
        file_path=path,
        data={"note": args.note},
    )
    return payload


def _resolve_session_argument(context: CliContext, *, override: str | None = None) -> str:
    return resolve_session_id(
        context,
        session_id=resolve_thread_id(context, override=override),
    )
