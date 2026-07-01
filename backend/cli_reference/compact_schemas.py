# CALLING SPEC:
# - Purpose: compact CLI output schema strings keyed by render layer identifiers.
# - Inputs: render_key string from CLI output formatters.
# - Outputs: pipe-delimited column schema or None when unknown.
# - Side effects: none.
from __future__ import annotations

from backend.cli_reference.specs import CompactSchema

COMPACT_SCHEMAS: tuple[CompactSchema, ...] = (
    CompactSchema("entries_list", "id|date|kind|amount_minor|currency|name|from|to|tags|category|lifecycle"),
    CompactSchema(
        "entries_detail",
        "id|date|kind|amount_minor|currency|name|from|to|tags|category|lifecycle|groups",
    ),
    CompactSchema("accounts_list", "id|name|currency|active|balance_minor|balance_as_of"),
    CompactSchema("snapshots_list", "id|date|balance_minor|note"),
    CompactSchema("snapshots_reconciliation", "start|end|open|tracked_change_minor|bank_change_minor|delta_minor|entry_count"),
    CompactSchema("groups_list", "id|source|name|members|first_date|last_date"),
    CompactSchema("groups_detail", "id|entry_id|entry_name|override|date|kind|amount_minor|currency"),
    CompactSchema("entities_list", "name|category"),
    CompactSchema("tags_list", "name|type|description"),
    CompactSchema("entry_categories_list", "id|path|default_lifecycle|usage_count|description"),
    CompactSchema("entry_categories_detail", "id|path|default_lifecycle|usage_count|description"),
    CompactSchema("sessions_list", "id|title|pending|running|updated_at"),
    CompactSchema("sessions_detail", "id|title|pending|running|updated_at"),
    CompactSchema("sources_list", "source_id|name|mime_type|size_bytes|sha256"),
    CompactSchema("source_detail", "source_id|name|mime_type|size_bytes|sha256"),
    CompactSchema("proposals_list", "id|status|change_type|summary"),
    CompactSchema("proposals_detail", "id|status|proposal_type|change_action|change_type|summary|applied_resource"),
    CompactSchema("dashboard_timeline", "month"),
    CompactSchema(
        "dashboard_kpis",
        "expense_minor|income_minor|net_minor|cash_withdrawal_minor|avg_day_minor|median_day_minor|spending_days|one_time_minor|core_spend_minor|uncategorized_minor",
    ),
    CompactSchema("dashboard_categories", "name|total_minor|share|entry_count"),
    CompactSchema("dashboard_lifecycles", "lifecycle|total_minor|share|entry_count"),
    CompactSchema("dashboard_groups", "group_id|name|source|total_minor|share"),
    CompactSchema("dashboard_breakdown", "kind|label|total_minor|share"),
    CompactSchema("dashboard_daily_spending", "date|expense_minor|category_totals_json"),
    CompactSchema("dashboard_monthly_trend", "month|expense_minor|income_minor"),
    CompactSchema("dashboard_weekday_spending", "weekday|total_minor"),
    CompactSchema("dashboard_largest_expenses", "id|date|name|to|amount_minor|category|lifecycle"),
    CompactSchema("dashboard_projection", "days_elapsed|days_remaining|spent_minor|projected_total_minor|projected_remaining_minor"),
    CompactSchema(
        "dashboard_reconciliation",
        "account|currency|snapshot_at|tracked_change_minor|last_delta_minor|mismatched|reconciled",
    ),
    CompactSchema(
        "dashboard_agent_metrics",
        "total_cost_usd|total_tokens|total_runs|completed_runs|failed_runs|avg_cost_usd|avg_tokens|cache_hit_rate|most_used_model|failure_rate",
    ),
    CompactSchema("dashboard_agent_cost_series", "bucket|cost_usd|runs"),
    CompactSchema("dashboard_agent_token_slice", "label|tokens|share"),
    CompactSchema("dashboard_agent_model", "model|runs|input_tokens|output_tokens|cache_reads|total_tokens|total_cost_usd|avg_cost_usd"),
    CompactSchema("dashboard_agent_surface", "surface|runs|tokens|cost_usd"),
    CompactSchema("dashboard_agent_top_runs", "run_id|thread_id|title|model|surface|status|tokens|cost_usd"),
)




def compact_schema_for(render_key: str) -> str | None:
    for item in COMPACT_SCHEMAS:
        if item.render_key == render_key:
            return item.schema
    return None
