"""Canonical `bh` command reference and prompt-friendly cheat sheet.

CALLING SPEC:
    render_bh_cheat_sheet(include_source_commands=True) -> str
    render_hosted_agent_bh_cheat_sheet() -> str
    compact_schema_for(render_key) -> str | None

Inputs:
    - optional render key names from the CLI output layer
Outputs:
    - concise markdown guidance for agent prompt/doc embedding and compact row schemas
Side effects:
    - none
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class CompactSchema:
    render_key: str
    schema: str


@dataclass(frozen=True, slots=True)
class CommandSpec:
    command: str
    purpose: str
    required_arguments: tuple[str, ...] = ()
    optional_arguments: tuple[str, ...] = ()
    notes: tuple[str, ...] = ()


_SESSION_SOURCE_COMMANDS = frozenset(
    {
        "bh sessions sources list [session_id]",
        "bh sessions sources add-text",
        "bh sessions sources add-file <path>",
    }
)

_HOSTED_HIDDEN_SESSION_COMMANDS = frozenset(
    {
        "bh sessions list",
        "bh sessions create",
        "bh sessions use <session_id>",
        "bh sessions get [session_id]",
    }
)

_HOSTED_HIDDEN_COMMANDS = frozenset({"bh login", "bh instruction"}) | _HOSTED_HIDDEN_SESSION_COMMANDS

_HOSTED_SESSION_UPDATE_SPEC = CommandSpec(
    "bh sessions update",
    "Update the current app-managed session title or summary.",
    optional_arguments=(
        "--title TEXT: replace the current session title.",
        "--summary TEXT: replace the current session summary.",
    ),
    notes=(
        "Hosted runs use the injected current session id. Do not provide a session id.",
        "`--summary-file` is for external agents with local files and is not available to hosted runs.",
    ),
)


_COMPACT_SCHEMAS: tuple[CompactSchema, ...] = (
    CompactSchema("entries_list", "id|date|kind|amount_minor|currency|name|from|to|tags"),
    CompactSchema(
        "entries_detail",
        "id|date|kind|amount_minor|currency|name|from|to|tags|account_id|direct_group_id|direct_group_role",
    ),
    CompactSchema("accounts_list", "id|name|currency|active"),
    CompactSchema("snapshots_list", "id|date|balance_minor|note"),
    CompactSchema("snapshots_reconciliation", "start|end|open|tracked_change_minor|bank_change_minor|delta_minor|entry_count"),
    CompactSchema("groups_list", "id|type|name|descendants|first_date|last_date"),
    CompactSchema("groups_nodes", "node_id|node_type|name|member_role|date|kind|amount_minor|group_type|descendants"),
    CompactSchema("groups_edges", "source|target|relation"),
    CompactSchema("entities_list", "name|category"),
    CompactSchema("tags_list", "name|type|description"),
    CompactSchema("sessions_list", "id|title|pending|running|updated_at"),
    CompactSchema("sessions_detail", "id|title|pending|running|updated_at"),
    CompactSchema("sources_list", "source_id|name|mime_type|size_bytes|sha256"),
    CompactSchema("source_detail", "source_id|name|mime_type|size_bytes|sha256"),
    CompactSchema("proposals_list", "id|status|change_type|summary"),
    CompactSchema("proposals_detail", "id|status|proposal_type|change_action|change_type|summary|applied_resource"),
)


_COMMAND_SPECS: tuple[CommandSpec, ...] = (
    CommandSpec(
        "bh login",
        "Create a password-backed API session and save CLI auth config.",
        required_arguments=(
            "--username TEXT: Bill Helper username.",
        ),
        optional_arguments=(
            "--api-base-url URL: Bill Helper API base URL. Defaults to local dev backend.",
            "--password TEXT: password for non-interactive setup.",
            "--password-stdin: read the password from stdin.",
        ),
    ),
    CommandSpec(
        "bh status",
        "Show current auth and CLI session context.",
    ),
    CommandSpec(
        "bh instruction",
        "Show Bill Helper domain rules and CLI reference without requiring auth.",
    ),
    CommandSpec(
        "bh sessions list",
        "List sessions.",
    ),
    CommandSpec(
        "bh sessions create",
        "Create a session.",
        optional_arguments=(
            "--title TEXT: short session title.",
            "--summary TEXT: current session summary.",
            "--use: save the created session as the current CLI session.",
        ),
    ),
    CommandSpec(
        "bh sessions use <session_id>",
        "Save an existing session as the current CLI session.",
        required_arguments=(
            "<session_id>: full session id or unique short id prefix.",
        ),
    ),
    CommandSpec(
        "bh sessions get [session_id]",
        "Get one session. Uses the current CLI session when the id is omitted.",
        optional_arguments=(
            "<session_id>: full session id, unique short id prefix, or current CLI session default.",
        ),
    ),
    CommandSpec(
        "bh sessions update [session_id]",
        "Update a session title or summary. Uses the current CLI session when the id is omitted.",
        optional_arguments=(
            "<session_id>: full session id, unique short id prefix, or current CLI session default.",
            "--title TEXT: replace the title.",
            "--summary TEXT: replace the summary.",
            "--summary-file PATH: read the replacement summary from a local file.",
        ),
    ),
    CommandSpec(
        "bh sessions sources list [session_id]",
        "List sources attached to a session. Uses the current CLI session when the id is omitted.",
        optional_arguments=(
            "<session_id>: full session id, unique short id prefix, or current CLI session default.",
        ),
    ),
    CommandSpec(
        "bh sessions sources add-text",
        "Attach text as a source to the current or specified session.",
        required_arguments=(
            "one of --text TEXT or --text-file PATH.",
        ),
        optional_arguments=(
            "--session-id ID: full session id or unique short id prefix. Defaults to the current CLI session.",
            "--filename NAME: stored filename for this text source.",
            "--display-name TEXT: display name for this source.",
            "--note TEXT: short source note.",
        ),
    ),
    CommandSpec(
        "bh sessions sources add-file <path>",
        "Attach a local text, image, or PDF file as a source to the current or specified session.",
        required_arguments=(
            "<path>: local file path on the machine running the external agent.",
        ),
        optional_arguments=(
            "--session-id ID: full session id or unique short id prefix. Defaults to the current CLI session.",
            "--note TEXT: short source note.",
        ),
    ),
    CommandSpec(
        "bh entries list",
        "List entries.",
        optional_arguments=(
            "--start-date YYYY-MM-DD: inclusive lower bound on entry date.",
            "--end-date YYYY-MM-DD: inclusive upper bound on entry date.",
            "--kind KIND: entry kind filter, for example EXPENSE, INCOME, or TRANSFER.",
            "--currency CODE: 3-letter currency code filter.",
            "--account-id ID: account id or unique short id prefix filter.",
            "--source TEXT: free-text source filter.",
            "--tag NAME: tag-name filter.",
            "--filter-group-id ID: group id or unique short id prefix filter.",
            "--limit N: integer result limit. Default 20.",
            "--offset N: integer result offset. Default 0.",
        ),
    ),
    CommandSpec(
        "bh entries get <entry_id>",
        "Get one entry.",
        required_arguments=(
            "<entry_id>: full entry id or unique short id prefix.",
        ),
    ),
    CommandSpec(
        "bh entries create",
        "Create an entry proposal in the current thread.",
        required_arguments=(
            "--kind {EXPENSE,INCOME,TRANSFER}: entry kind.",
            "--date YYYY-MM-DD: entry date.",
            "--name TEXT: human-readable entry name.",
            "--amount-minor INT: integer minor units, for example 1234 for 12.34.",
            "--from-entity TEXT: source entity name.",
            "--to-entity TEXT: destination entity name.",
        ),
        optional_arguments=(
            "--currency-code CODE: optional 3-letter currency code. Defaults to runtime settings when omitted.",
            "--tag NAME: tag name. Repeat for multiple tags.",
            "--markdown-notes TEXT: optional markdown notes.",
        ),
    ),
    CommandSpec(
        "bh entries update <entry_id>",
        "Create an entry-update proposal in the current thread.",
        required_arguments=(
            "<entry_id>: full entry id or unique short id prefix.",
            "exactly one of `--patch-json JSON` or `--patch-file PATH`.",
        ),
        notes=(
            "JSON/PATH must contain a patch object.",
        ),
    ),
    CommandSpec(
        "bh entries remove <entry_id>",
        "Create an entry-delete proposal in the current thread.",
        required_arguments=(
            "<entry_id>: full entry id or unique short id prefix.",
        ),
    ),
    CommandSpec(
        "bh accounts list",
        "List accounts.",
    ),
    CommandSpec(
        "bh accounts create",
        "Create an account proposal in the current thread.",
        required_arguments=(
            "--name TEXT: account display name.",
            "--currency-code CODE: 3-letter currency code such as CAD or USD.",
        ),
        optional_arguments=(
            "--markdown-body TEXT: optional markdown description.",
            "--is-active: mark the account as active.",
            "--inactive: mark the account as inactive.",
        ),
        notes=(
            "If neither `--is-active` nor `--inactive` is provided, the proposal defaults to active.",
        ),
    ),
    CommandSpec(
        "bh accounts update <account_ref>",
        "Create an account-update proposal in the current thread.",
        required_arguments=(
            "<account_ref>: exact account name, full id, or unique short id prefix.",
            "exactly one of `--patch-json JSON` or `--patch-file PATH`.",
        ),
        notes=(
            "JSON/PATH must contain a patch object.",
        ),
    ),
    CommandSpec(
        "bh accounts remove <account_ref>",
        "Create an account-delete proposal in the current thread.",
        required_arguments=(
            "<account_ref>: exact account name, full id, or unique short id prefix.",
        ),
    ),
    CommandSpec(
        "bh snapshots list <account_id>",
        "List account snapshots.",
        required_arguments=(
            "<account_id>: full account id or unique short id prefix.",
        ),
    ),
    CommandSpec(
        "bh snapshots reconciliation <account_id>",
        "Get account reconciliation.",
        required_arguments=(
            "<account_id>: full account id or unique short id prefix.",
        ),
        optional_arguments=(
            "--as-of YYYY-MM-DD: reconciliation cutoff date.",
        ),
    ),
    CommandSpec(
        "bh snapshots create",
        "Create a snapshot proposal in the current thread.",
        required_arguments=(
            "--account-id ID: full account id or unique short id prefix.",
            "--snapshot-at YYYY-MM-DD: snapshot date.",
            "--balance DECIMAL: decimal balance amount such as 1234.56.",
        ),
        optional_arguments=(
            "--note TEXT: optional snapshot note.",
        ),
    ),
    CommandSpec(
        "bh snapshots remove <account_id> <snapshot_id>",
        "Create a snapshot-delete proposal in the current thread.",
        required_arguments=(
            "<account_id>: full account id or unique short id prefix.",
            "<snapshot_id>: full snapshot id or unique short id prefix within the account.",
        ),
    ),
    CommandSpec(
        "bh groups list",
        "List groups.",
    ),
    CommandSpec(
        "bh groups get <group_id>",
        "Get one group graph.",
        required_arguments=(
            "<group_id>: full group id or unique short id prefix.",
        ),
    ),
    CommandSpec(
        "bh groups create",
        "Create a group proposal in the current thread.",
        required_arguments=(
            "--name TEXT: group display name.",
            "--group-type {BUNDLE,SPLIT,RECURRING}: group type.",
        ),
    ),
    CommandSpec(
        "bh groups update <group_id>",
        "Create a group-update proposal in the current thread.",
        required_arguments=(
            "<group_id>: full group id or unique short id prefix.",
            "exactly one of `--patch-json JSON` or `--patch-file PATH`.",
        ),
        notes=(
            "JSON/PATH must contain a patch object.",
            "Patch object format: `{\"name\":\"New Group Name\"}`.",
        ),
    ),
    CommandSpec(
        "bh groups remove <group_id>",
        "Create a group-delete proposal in the current thread.",
        required_arguments=(
            "<group_id>: full group id or unique short id prefix.",
        ),
    ),
    CommandSpec(
        "bh groups add-member",
        "Create a group-membership add proposal.",
        required_arguments=(
            "exactly one of `--payload-json JSON` or `--payload-file PATH`.",
        ),
        notes=(
            "Payload is nested; discriminated by `target.target_type` (`entry` vs `child_group`).",
            "Top-level JSON: `{\"action\":\"add\",\"group_ref\":{...},\"target\":{...},\"member_role\":\"PARENT|CHILD\"}`. `member_role` is optional unless SPLIT rules require it.",
            "Parent `group_ref`: exactly one of `{\"group_id\":\"<id>\"}` or `{\"create_group_proposal_id\":\"<id>\"}`.",
            "Entry target: `{\"target_type\":\"entry\",\"entry_ref\":{\"entry_id\":\"<id>\"}}` or `entry_ref` with `create_entry_proposal_id`.",
            "Child-group target: `{\"target_type\":\"child_group\",\"group_ref\":{...}}` with `group_id` or `create_group_proposal_id`.",
        ),
    ),
    CommandSpec(
        "bh groups remove-member",
        "Create a group-membership removal proposal.",
        required_arguments=(
            "exactly one of `--payload-json JSON` or `--payload-file PATH`.",
        ),
        notes=(
            "Remove supports **existing ids only**; proposal-id references are rejected for parent group and targets.",
            "Top-level JSON: `{\"action\":\"remove\",\"group_ref\":{\"group_id\":\"<id>\"},\"target\":{...}}` with discriminated `target` (`entry` vs `child_group`).",
        ),
    ),
    CommandSpec(
        "bh entities list",
        "List entities.",
    ),
    CommandSpec(
        "bh entities create",
        "Create an entity proposal in the current thread.",
        required_arguments=(
            "--name TEXT: entity display name.",
        ),
        optional_arguments=(
            "--category TEXT: optional entity category.",
        ),
    ),
    CommandSpec(
        "bh entities update <entity_name>",
        "Create an entity-update proposal in the current thread.",
        required_arguments=(
            "<entity_name>: exact entity name.",
            "exactly one of `--patch-json JSON` or `--patch-file PATH`.",
        ),
        notes=(
            "JSON/PATH must contain a patch object.",
        ),
    ),
    CommandSpec(
        "bh entities remove <entity_name>",
        "Create an entity-delete proposal in the current thread.",
        required_arguments=(
            "<entity_name>: exact entity name.",
        ),
    ),
    CommandSpec(
        "bh tags list",
        "List tags.",
    ),
    CommandSpec(
        "bh tags create",
        "Create a tag proposal in the current thread.",
        required_arguments=(
            "--name TEXT: tag name.",
        ),
        optional_arguments=(
            "--type TEXT: optional tag type/category.",
        ),
    ),
    CommandSpec(
        "bh tags update <tag_name>",
        "Create a tag-update proposal in the current thread.",
        required_arguments=(
            "<tag_name>: exact tag name.",
            "exactly one of `--patch-json JSON` or `--patch-file PATH`.",
        ),
        notes=(
            "JSON/PATH must contain a patch object.",
        ),
    ),
    CommandSpec(
        "bh tags remove <tag_name>",
        "Create a tag-delete proposal in the current thread.",
        required_arguments=(
            "<tag_name>: exact tag name.",
        ),
    ),
    CommandSpec(
        "bh proposals list",
        "List proposals in the current thread.",
        optional_arguments=(
            "--proposal-type TYPE: proposal type filter.",
            "--proposal-status STATUS: proposal status filter.",
            "--change-action ACTION: change-action filter.",
            "--proposal-id ID: full proposal id or unique short id prefix filter.",
            "--limit N: integer result limit. Default 20.",
        ),
    ),
    CommandSpec(
        "bh proposals get <proposal_id>",
        "Get one proposal by full id or unique prefix.",
        required_arguments=(
            "<proposal_id>: full proposal id or unique short id prefix.",
        ),
    ),
    CommandSpec(
        "bh proposals update <proposal_id>",
        "Update one pending proposal by id.",
        required_arguments=(
            "<proposal_id>: full proposal id or unique short id prefix.",
            "exactly one of `--patch-json JSON` or `--patch-file PATH`.",
        ),
        notes=(
            "JSON/PATH must contain a patch object.",
        ),
    ),
    CommandSpec(
        "bh proposals remove <proposal_id>",
        "Remove one pending proposal by id.",
        required_arguments=(
            "<proposal_id>: full proposal id or unique short id prefix.",
        ),
    ),
)


def compact_schema_for(render_key: str) -> str | None:
    for item in _COMPACT_SCHEMAS:
        if item.render_key == render_key:
            return item.schema
    return None


def _render_command_spec(item: CommandSpec) -> str:
    lines = [
        f"### `{item.command}`",
        f"- Purpose: {item.purpose}",
    ]
    if item.required_arguments:
        lines.append("- Required arguments:")
        lines.extend(f"  - `{arg}`" for arg in item.required_arguments)
    else:
        lines.append("- Required arguments: none.")
    if item.optional_arguments:
        lines.append("- Optional arguments:")
        lines.extend(f"  - `{arg}`" for arg in item.optional_arguments)
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
    }
    if include_source_commands:
        compact_schema_keys.add("sessions_list")
        compact_schema_keys.add("sources_list")
    else:
        compact_schema_keys.add("sessions_detail")
    schema_lines = "\n".join(
        f"- `{item.render_key}` -> `{item.schema}`"
        for item in _COMPACT_SCHEMAS
        if item.render_key in compact_schema_keys
    )
    visible_command_specs: list[str] = []
    for item in _COMMAND_SPECS:
        if not include_source_commands:
            if item.command in _SESSION_SOURCE_COMMANDS or item.command in _HOSTED_HIDDEN_COMMANDS:
                continue
            if item.command == "bh sessions update [session_id]":
                visible_command_specs.append(_render_command_spec(_HOSTED_SESSION_UPDATE_SPEC))
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
        "- Inspect current proposal state: `bh proposals list --proposal-status PENDING_REVIEW --limit 20`\n"
        "- Create a tag proposal: `bh tags create --name grocery --type expense`\n"
        "- Create an entry-update proposal: `bh entries update 8bf2fa83 --patch-json '{\"tags\":[\"grocery\",\"one_time\"]}'`\n"
        "- Create an account proposal: `bh accounts create --name \"Wealthsimple Cash\" --currency-code CAD --inactive`\n"
        "- Create a snapshot proposal: `bh snapshots create --account-id 1a2b3c4d --snapshot-at 2026-03-15 --balance 1234.56 --note \"statement balance\"`\n"
        "- Update a pending proposal: `bh proposals update a1b2c3d4 --patch-json '{\"patch.tags\":[\"grocery\"]}'`\n"
        "- Remove a pending proposal: `bh proposals remove a1b2c3d4`\n"
        "- Create a group-membership add proposal: `bh groups add-member --payload-json '{\"action\":\"add\",\"group_ref\":{\"group_id\":\"a971c92e\"},\"target\":{\"target_type\":\"entry\",\"entry_ref\":{\"entry_id\":\"8bf2fa83\"}}}'`\n"
    )


def render_hosted_agent_bh_cheat_sheet() -> str:
    return render_bh_cheat_sheet(include_source_commands=False)
