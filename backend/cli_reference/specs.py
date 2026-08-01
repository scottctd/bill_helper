# CALLING SPEC:
# - Purpose: canonical `bh` CommandSpec definitions and hosted/external visibility constants.
# - Inputs: none at import time; render layer selects subsets by surface.
# - Outputs: CompactSchema, CommandSpec, COMMAND_SPECS, and hosted override specs.
# - Side effects: none.
"""Command specification data for the `bh` CLI and agent prompt cheat sheets."""
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


SESSION_SOURCE_COMMANDS = frozenset(
    {
        "bh sessions sources list [session_id]",
        "bh sessions sources add-text",
        "bh sessions sources add-file <path>",
    }
)

HOSTED_HIDDEN_SESSION_COMMANDS = frozenset(
    {
        "bh sessions list",
        "bh sessions create",
        "bh sessions use <session_id>",
        "bh sessions get [session_id]",
    }
)

HOSTED_HIDDEN_COMMANDS = frozenset({"bh login", "bh instruction"}) | HOSTED_HIDDEN_SESSION_COMMANDS

HOSTED_SESSION_UPDATE_SPEC = CommandSpec(
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

HOSTED_ENTRIES_IMPORT_SPEC = CommandSpec(
    "bh entries import",
    "Create multiple entry proposals in the current thread from one JSON document.",
    required_arguments=(
        "--payload-json JSON: inline JSON document.",
    ),
    notes=(
        "--payload-file is for external agents with local files and is not available to hosted runs.",
        "JSON must be an object with an entries array (1-100 items).",
        "Each entry requires: kind, date, name, amount_minor, from_entity, to_entity.",
        "Each entry may include: currency_code, tags, markdown_notes.",
        "Each entry becomes one pending review proposal.",
        (
            "A matching pending create_entity or create_account proposal in the current thread satisfies "
            "entry proposal validation. After proposing a missing entity or account, retry the import "
            "immediately; do not wait for approval."
        ),
        (
            "Example: bh entries import --payload-json "
            '\'{"entries":[{"kind":"EXPENSE","date":"2026-03-15","name":"Farm Boy",'
            '"amount_minor":1234,"from_entity":"Checking","to_entity":"Farm Boy"}]}\''
        ),
    ),
)


COMMAND_SPECS: tuple[CommandSpec, ...] = (
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
            "--category TEXT: entry category leaf, parent, or uncategorized filter.",
            "--group-id ID: group id or unique short id prefix filter.",
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
            "--category TEXT: optional entry category leaf or path, for example food_drink/groceries.",
            "--lifecycle {fixed,day_to_day,one_time}: optional lifecycle override.",
        ),
    ),
    CommandSpec(
        "bh entries import",
        "Create multiple entry proposals in the current thread from one JSON document.",
        required_arguments=(
            "exactly one of --payload-json JSON or --payload-file PATH.",
        ),
        notes=(
            "JSON must be an object with an entries array (1-100 items).",
            "Each entry requires: kind, date, name, amount_minor, from_entity, to_entity.",
            "Each entry may include: currency_code, tags, markdown_notes, category, lifecycle.",
            "Each entry becomes one pending review proposal.",
            (
                "Example: bh entries import --payload-json "
                '\'{"entries":[{"kind":"EXPENSE","date":"2026-03-15","name":"Farm Boy",'
                '"amount_minor":1234,"from_entity":"Checking","to_entity":"Farm Boy"}]}\''
            ),
        ),
    ),
    CommandSpec(
        "bh entries update <entry_id>",
        "Create an entry-update proposal in the current thread.",
        required_arguments=(
            "<entry_id>: full entry id or unique short id prefix.",
            "exactly one of --patch-json JSON or --patch-file PATH.",
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
            "exactly one of --patch-json JSON or --patch-file PATH.",
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
        "Get one group.",
        required_arguments=(
            "<group_id>: full group id or unique short id prefix.",
        ),
    ),
    CommandSpec(
        "bh groups create",
        "Create a group proposal in the current thread.",
        required_arguments=(
            "--name TEXT: group display name.",
        ),
        optional_arguments=(
            "--source {manual,rule}: group source. Defaults to manual.",
            "--description TEXT: optional group description.",
            "--color TEXT: optional group color token.",
            "--rule-json JSON or --rule-file PATH: required for rule groups.",
        ),
    ),
    CommandSpec(
        "bh groups update <group_id>",
        "Create a group-update proposal in the current thread.",
        required_arguments=(
            "<group_id>: full group id or unique short id prefix.",
            "exactly one of --patch-json JSON or --patch-file PATH.",
        ),
        notes=(
            "JSON/PATH must contain a patch object.",
            "Patch object format examples: `{\"name\":\"New Group Name\"}` or `{\"rule\":{...}}`.",
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
            "exactly one of --payload-json JSON or --payload-file PATH.",
        ),
        notes=(
            "Payload is nested; `target.target_type` must be `entry`.",
            "Top-level JSON: `{\"action\":\"add\",\"group_ref\":{...},\"target\":{...}}`.",
            "Parent `group_ref`: exactly one of `{\"group_id\":\"<id>\"}` or `{\"create_group_proposal_id\":\"<id>\"}`.",
            "Entry target: `{\"target_type\":\"entry\",\"entry_ref\":{\"entry_id\":\"<id>\"}}` or `entry_ref` with `create_entry_proposal_id`.",
            "Rule groups require `target.override` (`include` or `exclude`); manual groups must omit `override`.",
        ),
    ),
    CommandSpec(
        "bh groups remove-member",
        "Create a group-membership removal proposal.",
        required_arguments=(
            "exactly one of --payload-json JSON or --payload-file PATH.",
        ),
        notes=(
            "Remove supports **existing ids only**; proposal-id references are rejected for parent group and targets.",
            "Top-level JSON: `{\"action\":\"remove\",\"group_ref\":{\"group_id\":\"<id>\"},\"target\":{\"target_type\":\"entry\",\"entry_ref\":{\"entry_id\":\"<id>\"}}}`.",
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
            "exactly one of --patch-json JSON or --patch-file PATH.",
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
            "exactly one of --patch-json JSON or --patch-file PATH.",
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
        "bh entry-categories list",
        "List entry categories.",
    ),
    CommandSpec(
        "bh entry-categories get <category_ref>",
        "Get one entry category by name, path, full id, or unique id prefix.",
        required_arguments=("<category_ref>: name, path, full id, or unique id prefix.",),
    ),
    CommandSpec(
        "bh entry-categories create <name>",
        "Create an entry category directly.",
        required_arguments=("<name>: category term name.",),
        optional_arguments=(
            "--parent REF: create a child under a parent category.",
            "--description TEXT: category description.",
            "--default-lifecycle {fixed,day_to_day,one_time}: default lifecycle.",
        ),
    ),
    CommandSpec(
        "bh entry-categories update <category_ref>",
        "Update an entry category directly.",
        required_arguments=("<category_ref>: name, path, full id, or unique id prefix.",),
        optional_arguments=(
            "--name TEXT, --description TEXT, or --clear-description.",
            "--default-lifecycle VALUE or --clear-default-lifecycle.",
        ),
    ),
    CommandSpec(
        "bh entry-categories remove <category_ref>",
        "Delete an entry category directly; assigned entries become uncategorized.",
        required_arguments=("<category_ref>: name, path, full id, or unique id prefix.",),
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
            "exactly one of --patch-json JSON or --patch-file PATH.",
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
    CommandSpec(
        "bh dashboard timeline",
        "List dashboard activity months in ascending YYYY-MM order.",
        notes=(
            "Returns months with visible expense or cash-withdrawal activity in the dashboard currency.",
            "Use before `--year` batch reads or to pick a valid `--month` value.",
        ),
    ),
    CommandSpec(
        "bh dashboard finance get",
        "Read personal finance dashboard analytics for one month or a batch.",
        optional_arguments=(
            "exactly one of --month YYYY-MM, --year YYYY, or --months LIST.",
            "--month YYYY-MM: single month. Defaults to the current calendar month.",
            "--year YYYY: batch all expense-active months in that year.",
            "--months LIST: comma-separated YYYY-MM list (backend max 24).",
            "--sections NAME: section filter. Repeat or comma-separate. Default: all.",
            "--breakdown-depth {summary,categories,destinations,entries}: category drill-down depth.",
            "Sections: meta, kpis, categories, lifecycles, groups, daily_spending, monthly_trend, spending_by_from, spending_by_to, spending_by_tag, income_by_from, weekday_spending, largest_expenses, projection, reconciliation, all.",
        ),
        notes=(
            "Dashboard currency only; internal account-to-account transfers are excluded from expense analytics.",
            "Use `--format json --sections categories` for the category -> destination -> entry tree.",
            "Example: bh dashboard finance get --month 2026-05 --sections kpis,categories,lifecycles,largest_expenses",
            "Example: bh dashboard finance get --year 2026 --sections kpis,monthly_trend --format json",
        ),
    ),
    CommandSpec(
        "bh dashboard agent get",
        "Read agent usage and cost dashboard analytics.",
        optional_arguments=(
            "--range {7d,30d,90d,all}: rolling window. Default 30d.",
            "--model NAME: model filter. Repeat for multiple models.",
            "--surface NAME: surface filter. Repeat for multiple surfaces.",
            "--sections NAME: section filter. Repeat or comma-separate. Default: all.",
            "Sections: meta, metrics, cost_series, token_distribution, model_breakdown, surface_breakdown, top_runs, all.",
        ),
        notes=(
            "Costs are USD floats from finished agent runs.",
            "Example: bh dashboard agent get --range 30d --sections metrics",
            "Example: bh dashboard agent get --range 90d --sections model_breakdown,top_runs --format json",
        ),
    ),
)

