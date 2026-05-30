# CALLING SPEC:
# - Purpose: build ranked tag → destination breakdown trees for dashboard filter groups.
# - Inputs: per-filter-group tag, destination, and entry rollups from expense analytics.
# - Outputs: ordered `DashboardTagToBreakdown` lists for dashboard read models.
# - Side effects: none.

from __future__ import annotations

from backend.schemas_finance import (
    DashboardBreakdownEntryItem,
    DashboardTagToBreakdown,
    DashboardToBreakdownItem,
)


def build_tag_to_breakdowns(
    *,
    filter_group_key: str,
    tag_totals_by_group: dict[str, dict[str, int]],
    spending_by_to_per_tag: dict[str, dict[str, dict[str, int]]],
    entries_by_to_per_tag: dict[str, dict[str, dict[str, list[DashboardBreakdownEntryItem]]]],
    entry_count_per_tag: dict[str, dict[str, int]],
    tag_limit: int = 12,
    to_limit: int = 100,
) -> list[DashboardTagToBreakdown]:
    tag_totals_map = tag_totals_by_group.get(filter_group_key, {})
    ranked_tags = sorted(tag_totals_map.items(), key=lambda item: (-item[1], item[0]))[:tag_limit]
    to_totals_for_group = spending_by_to_per_tag.get(filter_group_key, {})
    entries_for_group = entries_by_to_per_tag.get(filter_group_key, {})
    entry_counts_for_group = entry_count_per_tag.get(filter_group_key, {})

    breakdowns: list[DashboardTagToBreakdown] = []
    for tag, tag_total in ranked_tags:
        ranked_tos = sorted(
            to_totals_for_group.get(tag, {}).items(),
            key=lambda item: (-item[1], item[0]),
        )[:to_limit]
        to_items = [
            DashboardToBreakdownItem(
                label=to_label,
                total_minor=to_total,
                share=round(to_total / tag_total, 4) if tag_total > 0 else 0.0,
                entries=sorted(
                    entries_for_group.get(tag, {}).get(to_label, []),
                    key=lambda entry: (entry.occurred_at, entry.name),
                    reverse=True,
                ),
            )
            for to_label, to_total in ranked_tos
        ]
        breakdowns.append(
            DashboardTagToBreakdown(
                tag=tag,
                total_minor=tag_total,
                entry_count=entry_counts_for_group.get(tag, 0),
                to_items=to_items,
            )
        )
    return breakdowns


__all__ = ["build_tag_to_breakdowns"]
