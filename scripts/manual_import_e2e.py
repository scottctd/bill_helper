# CALLING SPEC:
# - Purpose: manual import workflow smoke test via HTTP API without approving proposals.
# - Inputs: CLI flags for API base, credentials, model, and poll limits.
# - Outputs: exit code 0 on success; prints job/task status only (no tokens).
# - Side effects: creates draft attachments and an import job; does not batch-approve.
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_MODEL = "fireworks_ai/deepseek-v4-flash"


def _request(
    method: str,
    url: str,
    *,
    token: str | None = None,
    body: dict | None = None,
    multipart: tuple[str, bytes, str] | None = None,
) -> tuple[int, object]:
    headers: dict[str, str] = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data: bytes | None = None
    if multipart is not None:
        field_name, payload, filename = multipart
        boundary = "billhelperboundary"
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
        parts = [
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="{field_name}"; filename="{filename}"\r\n'.encode(),
            b"Content-Type: text/plain\r\n\r\n",
            payload,
            b"\r\n",
            f"--{boundary}--\r\n".encode(),
        ]
        data = b"".join(parts)
    elif body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read()
            if not raw:
                return resp.status, None
            return resp.status, json.loads(raw.decode())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode()
        try:
            parsed = json.loads(detail)
        except json.JSONDecodeError:
            parsed = detail
        return exc.code, parsed


def main() -> int:
    parser = argparse.ArgumentParser(description="Manual import E2E (no proposal approval).")
    parser.add_argument("--api-base", default="http://localhost:8000/api/v1")
    parser.add_argument("--username", default="admin")
    parser.add_argument("--password", default="admin")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--concurrency", type=int, default=2)
    parser.add_argument("--polls", type=int, default=40, help="Status poll rounds (>=40 for 50+ calls).")
    parser.add_argument("--poll-interval", type=float, default=3.0)
    args = parser.parse_args()
    base = args.api_base.rstrip("/")
    call_count = 0

    def call(method: str, path: str, **kwargs) -> object:
        nonlocal call_count
        call_count += 1
        status, payload = _request(method, f"{base}{path}", **kwargs)
        if status >= 400:
            raise RuntimeError(f"{method} {path} -> {status}: {payload}")
        return payload

    print("Logging in…")
    login = call("POST", "/auth/login", body={"username": args.username, "password": args.password})
    token = login["token"]

    print("Fetching runtime settings…")
    settings = call("GET", "/settings", token=token)
    models = settings.get("available_agent_models") or []
    model = args.model
    if model not in models:
        deepseek = [item for item in models if "deepseek" in item.lower()]
        if deepseek:
            model = deepseek[0]
            print(f"Model {args.model!r} not in catalog; using {model}")
        elif models:
            model = models[0]
            print(f"Using first available model: {model}")
    else:
        print(f"Using model: {model}")

    sources = [
        (
            "fabricated-statement-a.txt",
            b"Bank Statement - Test Account A\nDate: 2026-03-15\nMerchant: Coffee Shop\nAmount: -12.50 USD\n",
        ),
        (
            "fabricated-statement-b.txt",
            b"Bank Statement - Test Account B\nDate: 2026-03-16\nMerchant: Grocery Store\nAmount: -45.00 USD\n",
        ),
    ]
    attachment_ids: list[str] = []
    for filename, content in sources:
        print(f"Uploading draft attachment {filename}…")
        status, payload = _request(
            "POST",
            f"{base}/agent/draft-attachments",
            token=token,
            multipart=("file", content, filename),
        )
        call_count += 1
        if status >= 400:
            raise RuntimeError(f"upload failed: {payload}")
        attachment_ids.append(payload["id"])
        print(f"  attachment_id={payload['id']}")

    print("Preflight…")
    preflight = call(
        "POST",
        "/import/preflight",
        token=token,
        body={"source_attachment_ids": attachment_ids},
    )
    print(f"  files={len(preflight['files'])}")

    print("Creating import job (concurrency=2, approval_policy=default)…")
    job = call(
        "POST",
        "/import/jobs",
        token=token,
        body={
            "title": "Manual E2E import test",
            "model_name": model,
            "concurrency": args.concurrency,
            "approval_policy": "default",
            "instructions": (
                "Read the attached statement text and propose one expense entry using bh entries create. "
                "Do not apply changes yourself; leave proposals for review."
            ),
            "source_attachment_ids": attachment_ids,
        },
    )
    job_id = job["id"]
    print(f"  job_id={job_id} tasks={job['total_tasks']} status={job['status']}")

    terminal = {"completed", "failed", "cancelled"}
    detail = job
    for poll in range(1, args.polls + 1):
        time.sleep(args.poll_interval)
        detail = call("GET", f"/import/jobs/{job_id}", token=token)
        tasks = detail.get("tasks") or []
        task_summary = ", ".join(f"{t['source_label']}:{t['status']}" for t in tasks)
        cost = detail.get("aggregate_total_cost_usd")
        print(
            f"poll {poll}/{args.polls}: job={detail['status']} "
            f"done={detail['completed_tasks']}/{detail['total_tasks']} "
            f"failed={detail['failed_tasks']} cost={cost} | {task_summary}"
        )
        if detail["status"] in terminal and all(t["status"] in terminal for t in tasks):
            break

    print("Listing aggregated proposals (read-only, no approve)…")
    proposals = call("GET", f"/import/jobs/{job_id}/proposals", token=token)
    print(f"  proposal_groups={len(proposals)}")
    for row in proposals[:10]:
        print(
            f"  - {row['change_type']} status={row['status']} "
            f"dup={row['duplicate_count']} sources={row['source_task_labels']}"
        )

    call("GET", "/import/jobs", token=token)
    for task in detail.get("tasks") or []:
        if task.get("thread_id"):
            call("GET", f"/agent/threads/{task['thread_id']}", token=token)

    print(f"Done. API calls={call_count} job_id={job_id} final_status={detail['status']}")
    print("No batch-approve/reject calls were made.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
