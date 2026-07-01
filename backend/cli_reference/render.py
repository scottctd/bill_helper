# CALLING SPEC:
# - Purpose: render markdown `bh` cheat sheets for hosted and external agent prompts.
# - Inputs: include_source_commands flag selecting external vs hosted command visibility.
# - Outputs: markdown cheat sheet text embedded in system prompts and `bh instruction`.
# - Side effects: none.
from __future__ import annotations

from backend.cli_reference.compact_schemas import COMPACT_SCHEMAS
from backend.cli_reference.specs import (
    COMMAND_SPECS,
    HOSTED_ENTRIES_IMPORT_SPEC,
    HOSTED_HIDDEN_COMMANDS,
    HOSTED_SESSION_UPDATE_SPEC,
    SESSION_SOURCE_COMMANDS,
    CommandSpec,
)


def _format_spec_list_item(text: str) -> str:
    if "`" in text:
        return text
    return f"`{text}`"


def _render_command_spec(item: CommandSpec) -> str:
    lines = [
        f"### `{item.command}`",
        f"- Purpose: {item.purpose}",
    ]
    if item.required_arguments:
        lines.append("- Required arguments:")
        lines.extend(f"  - {_format_spec_list_item(arg)}" for arg in item.required_arguments)
    else:
        lines.append("- Required arguments: none.")
    if item.optional_arguments:
        lines.append("- Optional arguments:")
        lines.extend(f"  - {_format_spec_list_item(arg)}" for arg in item.optional_arguments)
    else:
        lines.append("- Optional arguments: none.")
    if item.notes:
        lines.append("- Notes:")
        lines.extend(f"  - {note}" for note in item.notes)
    return "\n".join(lines)


def render_bh_cheat_sheet(*, include_source_commands: bool = True) -> str:
    compact_schema_keys = {
        "entries_list",
        "accounts_list",
        "snapshots_list",
        "groups_list",
        "entities_list",
        "tags_list",
        "proposals_list",
        "dashboard_timeline",
        "dashboard_kpis",
        "dashboard_categories",
        "dashboard_lifecycles",
        "dashboard_groups",
        "dashboard_breakdown",
        "dashboard_agent_metrics",
    }
    if include_source_commands:
        compact_schema_keys.add("sessions_list")
        compact_schema_keys.add("sources_list")
    else:
        compact_schema_keys.add("sessions_detail")
    schema_lines = "\n".join(
        f"- `{item.render_key}` -> `{item.schema}`"
        for item in COMPACT_SCHEMAS
        if item.render_key in compact_schema_keys
    )
    visible_command_specs: list[str] = []
    for item in COMMAND_SPECS:
        if not include_source_commands:
            if item.command in SESSION_SOURCE_COMMANDS or item.command in HOSTED_HIDDEN_COMMANDS:
                continue
            if item.command == "bh sessions update [session_id]":
                visible_command_specs.append(_render_command_spec(HOSTED_SESSION_UPDATE_SPEC))
                continue
            if item.command == "bh entries import":
                visible_command_specs.append(_render_command_spec(HOSTED_ENTRIES_IMPORT_SPEC))
                continue
        visible_command_specs.append(_render_command_spec(item))
    command_specs = "\n\n".join(visible_command_specs)
    source_guidance = (
        "- Source uploads are content-deduplicated per user. Uploading the same bytes again returns the same source id and attaching it to the same session is idempotent.\n"
        if include_source_commands
        else "- The app owns hosted session creation, selection, and attachment linking. Hosted runs may update only the current session with `bh sessions update`; do not use session navigation or source-management commands.\n"
    )
    auth_guidance = (
        "- `bh login` stores `api_base_url` and `auth_token` for future commands; env vars (`BH_API_BASE_URL`, `BH_AUTH_TOKEN`) still override config.\n"
        if include_source_commands
        else "- Hosted runs receive temporary auth and the current session id automatically.\n"
    )
    proposal_scope_guidance = (
        "- Mutating proposal commands require a current session (`bh sessions create --use`, `bh sessions use <session_id>`, `BH_SESSION_ID`, or an explicit session id where supported). `BH_RUN_ID` is optional and only present for the hosted internal agent.\n"
        if include_source_commands
        else "- Mutating proposal commands use the injected current session. `BH_RUN_ID` is present for hosted runs and should not be supplied manually.\n"
    )
    session_and_source_flows = (
        "- Login for local dev: `bh login --api-base-url http://localhost:8000/api/v1 --username admin --password-stdin`\n"
        "- Create and use a session: `bh sessions create --title \"March statements\" --use`\n"
        "- Switch to an existing session: `bh sessions list`, then `bh sessions use <session_id>`\n"
        "- Attach text to the current session: `bh sessions sources add-text --text \"Statement balance: 1234.56\" --filename statement.txt`\n"
        "- Attach a local PDF to a session: `bh sessions sources add-file statement.pdf --session-id a1b2c3d4`\n"
        if include_source_commands
        else "- Update the current session summary: `bh sessions update --summary \"Reviewed May receipts and proposed 3 entries.\"`\n"
    )
    return (
        "Use `bh` for Bill Helper app reads and current-session proposal creation and proposal mutation.\n"
        "\n"
        "- Agent calls should expect `compact` output by default; use `--format text` or `--format json` only when needed.\n"
        "- Every command also accepts `--format {compact,json,text}` as an optional global override.\n"
        "- List output uses 8-character ids when unique in the current result set; collisions fall back to full ids.\n"
        "- Compact output is line-oriented: one `schema:` line defines column order, then one escaped `|`-delimited row per record.\n"
        "- Text output formats monetary minor units as decimal currency amounts; compact/json preserve raw minor-unit fields.\n"
        f"{auth_guidance}"
        f"{proposal_scope_guidance}"
        f"{source_guidance}"
        "- Inspect before mutating: read entries/tags/accounts/entities/groups/proposals first, then create resource-scoped proposals.\n"
        "- For spending/income questions, prefer `bh dashboard finance get` before scanning raw entries.\n"
        "- For agent spend questions, use `bh dashboard agent get`.\n"
        "- `bh proposals update` and `bh proposals remove` only work for pending proposals in the current session/thread.\n"
        "\n"
        "Command specifications:\n\n"
        f"{command_specs}\n"
        "\n"
        "Compact output schemas:\n"
        f"{schema_lines}\n"
        "\n"
        "Common flows:\n"
        f"{session_and_source_flows}"
        "- Inspect recent matching entries: `bh entries list --source \"farm boy\" --limit 10`\n"
        "- Read monthly dashboard KPIs: `bh dashboard finance get --sections kpis`\n"
        "- Read expense breakdown tree: `bh dashboard finance get --month 2026-05 --sections categories --format json`\n"
        "- Compare yearly trend: `bh dashboard finance get --year 2026 --sections monthly_trend`\n"
        "- Read agent cost KPIs: `bh dashboard agent get --range 30d --sections metrics`\n"
        "- Inspect current proposal state: `bh proposals list --proposal-status PENDING_REVIEW --limit 20`\n"
        "- Create a tag proposal: `bh tags create --name travel --type context`\n"
        "- Create an entry proposal: `bh entries create --kind EXPENSE --date 2026-03-15 --name \"Farm Boy\" --amount-minor 1234 --from-entity Checking --to-entity \"Farm Boy\" --category food_drink/groceries --lifecycle day_to_day`\n"
        "- Create an entry-update proposal: `bh entries update 8bf2fa83 --patch-json '{\"category\":\"groceries\",\"lifecycle\":\"one_time\"}'`\n"
        "- Import multiple entry proposals: `bh entries import --payload-json '{\"entries\":[{\"kind\":\"EXPENSE\",\"date\":\"2026-03-15\",\"name\":\"Farm Boy\",\"amount_minor\":1234,\"from_entity\":\"Checking\",\"to_entity\":\"Farm Boy\",\"category\":\"food_drink/groceries\",\"lifecycle\":\"day_to_day\"}]}'`\n"
        "- Patch a pending create-entry proposal: `bh proposals update a1b2c3d4 --patch-json '{\"category\":\"food_drink/groceries\",\"lifecycle\":\"day_to_day\"}'`\n"
        "- Create an account proposal: `bh accounts create --name \"Wealthsimple Cash\" --currency-code CAD --inactive`\n"
        "- Create a snapshot proposal: `bh snapshots create --account-id 1a2b3c4d --snapshot-at 2026-03-15 --balance 1234.56 --note \"statement balance\"`\n"
        "- Update a pending proposal: `bh proposals update a1b2c3d4 --patch-json '{\"patch.tags\":[\"travel\"]}'`\n"
        "- Remove a pending proposal: `bh proposals remove a1b2c3d4`\n"
        "- Create a group-membership add proposal: `bh groups add-member --payload-json '{\"action\":\"add\",\"group_ref\":{\"group_id\":\"a971c92e\"},\"target\":{\"target_type\":\"entry\",\"entry_ref\":{\"entry_id\":\"8bf2fa83\"}}}'`\n"
    )


def render_hosted_agent_bh_cheat_sheet() -> str:
    return render_bh_cheat_sheet(include_source_commands=False)
