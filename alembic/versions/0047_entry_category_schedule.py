"""replace the initial entry-category schedule

Replaces the prototype category tree with durable purpose-based parents and
children. Existing assignments receive deterministic fallback mappings; a
separate audited classifier can refine ambiguous production entries after the
schema migration.

This is a destructive data migration. Exact prior category assignments are not
restored on downgrade; use the pre-migration database backup instead.

Revision ID: 0047_entry_category_schedule
Revises: 0046_entry_category_lifecycle
Create Date: 2026-06-22
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timezone
import json
from uuid import uuid4

from alembic import op
import sqlalchemy as sa


revision: str = "0047_entry_category_schedule"
down_revision: str | Sequence[str] | None = "0046_entry_category_lifecycle"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


CategorySpec = tuple[str, str | None, str]
ParentSpec = tuple[str, str, list[CategorySpec]]


ENTRY_CATEGORY_TREE: list[ParentSpec] = [
    (
        "food_drink",
        "Food and drink purchased for home or prepared away from home.",
        [
            ("groceries", "day_to_day", "Food and household staples bought for home."),
            ("restaurants", "day_to_day", "Meals and drinks purchased from restaurants for on-site consumption."),
            ("delivery_takeout", "day_to_day", "Restaurant meals ordered for delivery or takeout."),
            ("coffee_snacks", "day_to_day", "Coffee, tea, desserts, and small snacks."),
            ("alcohol_bars", "day_to_day", "Alcohol purchases and spending at bars."),
        ],
    ),
    (
        "transport",
        "Transportation between places, including public and private travel.",
        [
            ("transit", "day_to_day", "Public transit fares, passes, and bike-share usage."),
            ("rideshare_taxi", "day_to_day", "Taxi and rideshare trips."),
            ("fuel", "day_to_day", "Gasoline and other vehicle fuel."),
            ("parking", "day_to_day", "Parking fees and parking permits."),
            ("airfare", "one_time", "Commercial flights and airline tickets."),
        ],
    ),
    (
        "housing",
        "Primary housing, household services, and temporary accommodation.",
        [
            ("rent", "fixed", "Recurring rent for the primary residence."),
            ("utilities", "fixed", "Electricity, water, heating, and other household utilities."),
            ("internet", "fixed", "Home internet service."),
            ("phone", "fixed", "Mobile and landline phone service."),
            ("home_maintenance", "one_time", "Home repairs, maintenance, and improvement work."),
            ("accommodation", "one_time", "Hotels, short-term rentals, and other temporary lodging."),
        ],
    ),
    (
        "health",
        "Health care, medication, and physical wellness.",
        [
            ("medical", "one_time", "Medical appointments, treatment, tests, and health services."),
            ("pharmacy", "day_to_day", "Prescription and over-the-counter medication."),
            ("fitness", "fixed", "Gym memberships, sports programs, and recurring fitness costs."),
        ],
    ),
    (
        "shopping",
        "Physical goods purchased for personal or household use.",
        [
            ("clothing", "day_to_day", "Clothing, shoes, and wearable accessories."),
            ("electronics", "one_time", "Consumer electronics, devices, and accessories."),
            ("household_goods", "day_to_day", "Furniture, household supplies, and general home goods."),
            ("personal_care", "day_to_day", "Personal-care products and grooming services."),
            ("gifts", "one_time", "Gifts purchased for other people."),
        ],
    ),
    (
        "entertainment",
        "Media, events, activities, and hobbies.",
        [
            ("streaming_media", "fixed", "Streaming video, music, news, and media subscriptions."),
            ("events_activities", "one_time", "Tickets, attractions, events, and recreational activities."),
            ("hobbies", "day_to_day", "Supplies, memberships, and purchases for personal hobbies."),
        ],
    ),
    (
        "software_tools",
        "Software and online tools used for work or personal productivity.",
        [
            ("ai_apis", "fixed", "Usage and subscriptions for AI APIs and model platforms."),
            ("software_subscriptions", "fixed", "Recurring software, cloud, and productivity-tool subscriptions."),
        ],
    ),
    (
        "education",
        "Tuition, courses, books, and formal learning expenses.",
        [
            ("tuition", "one_time", "Tuition, admission, application, and institutional education fees."),
            ("courses_books", "one_time", "Courses, textbooks, learning materials, and educational books."),
        ],
    ),
    (
        "financial",
        "Costs imposed by financial obligations and institutions.",
        [
            ("insurance", "fixed", "Insurance premiums and protection plans."),
            ("taxes", "fixed", "Income, property, government, and other taxes."),
            ("fees", "day_to_day", "Banking, account, transaction, and administrative fees."),
            ("debt_interest", "fixed", "Interest charged on loans, credit cards, and other debt."),
        ],
    ),
    (
        "income",
        "Money received as earnings or investment income.",
        [
            ("salary_wages", "fixed", "Salary, wages, and regular employment income."),
            ("investment_income", "one_time", "Interest, dividends, and realized investment gains."),
            ("other_income", "one_time", "Other income, benefits, awards, and irregular inflows."),
        ],
    ),
    (
        "refunds",
        "Returned money and repayment of previously incurred costs.",
        [
            ("refund", "one_time", "Merchant refunds and purchase reversals."),
            ("reimbursement", "one_time", "Repayment of expenses by another person or organization."),
            ("tax_refund", "one_time", "Refunds issued by a tax authority."),
        ],
    ),
]


LEGACY_ASSIGNMENT_FALLBACKS: dict[str, str | None] = {
    "housing": "rent",
    "utilities": "utilities",
    "internet_mobile": "internet",
    "home": "household_goods",
    "home_maintenance": "home_maintenance",
    "grocery": "groceries",
    "dining_out": "restaurants",
    "coffee_snacks": "coffee_snacks",
    "alcohol_bars": "alcohol_bars",
    "transportation": "transit",
    "fuel": "fuel",
    "auto": "fuel",
    "health_medical": "medical",
    "pharmacy": "pharmacy",
    "shopping": "household_goods",
    "clothing": "clothing",
    "personal_care": "personal_care",
    "entertainment": "events_activities",
    "pets": "household_goods",
    "electronics": "electronics",
    "gifts": "gifts",
    "fitness": "fitness",
    "subscriptions": "software_subscriptions",
    "debt_payment": None,
    "interest_expense": "debt_interest",
    "taxes": "taxes",
    "insurance": "insurance",
    "fees": "fees",
    "bank_fees": "fees",
    "api_usage": "ai_apis",
    "education": "tuition",
    "kids_childcare": None,
    "donations_charity": None,
    "income": "other_income",
    "salary_wages": "salary_wages",
    "bonus": "other_income",
    "investment_gains": "investment_income",
    "gifts_received": "other_income",
    "other_income": "other_income",
    "business_income": "other_income",
    "dividends": "investment_income",
    "interest_income": "investment_income",
    "refund": "refund",
    "reimbursement": "reimbursement",
    "tax_refund": "tax_refund",
}

LEGACY_DEFAULT_LIFECYCLES: dict[str, str] = {
    "housing": "fixed",
    "utilities": "fixed",
    "internet_mobile": "fixed",
    "home": "day_to_day",
    "home_maintenance": "one_time",
    "grocery": "day_to_day",
    "dining_out": "day_to_day",
    "coffee_snacks": "day_to_day",
    "alcohol_bars": "day_to_day",
    "transportation": "day_to_day",
    "fuel": "day_to_day",
    "auto": "day_to_day",
    "health_medical": "day_to_day",
    "pharmacy": "day_to_day",
    "shopping": "day_to_day",
    "clothing": "day_to_day",
    "personal_care": "day_to_day",
    "entertainment": "day_to_day",
    "pets": "day_to_day",
    "electronics": "one_time",
    "gifts": "one_time",
    "fitness": "fixed",
    "subscriptions": "fixed",
    "debt_payment": "fixed",
    "interest_expense": "fixed",
    "taxes": "fixed",
    "insurance": "fixed",
    "fees": "day_to_day",
    "bank_fees": "day_to_day",
    "api_usage": "day_to_day",
    "education": "one_time",
    "kids_childcare": "fixed",
    "donations_charity": "one_time",
    "income": "fixed",
    "salary_wages": "fixed",
    "bonus": "one_time",
    "investment_gains": "one_time",
    "gifts_received": "one_time",
    "other_income": "day_to_day",
    "business_income": "fixed",
    "dividends": "one_time",
    "interest_income": "fixed",
    "refund": "one_time",
    "reimbursement": "one_time",
    "tax_refund": "one_time",
}


LEGACY_TERM_NAMES = {
    "housing",
    "utilities",
    "internet_mobile",
    "home",
    "home_maintenance",
    "food_drink",
    "grocery",
    "dining_out",
    "coffee_snacks",
    "alcohol_bars",
    "transport",
    "transportation",
    "fuel",
    "auto",
    "health",
    "pharmacy",
    "health_medical",
    "shopping_lifestyle",
    "shopping",
    "clothing",
    "personal_care",
    "entertainment",
    "pets",
    "electronics",
    "gifts",
    "fitness",
    "subscriptions",
    "financial",
    "debt_payment",
    "interest_expense",
    "taxes",
    "insurance",
    "fees",
    "bank_fees",
    "api_usage",
    "education_family",
    "education",
    "kids_childcare",
    "giving",
    "donations_charity",
    "income",
    "salary_wages",
    "bonus",
    "investment_gains",
    "gifts_received",
    "other_income",
    "business_income",
    "dividends",
    "interest_income",
    "refunds",
    "refund",
    "reimbursement",
    "tax_refund",
}


def _metadata(description: str, lifecycle: str | None) -> str:
    value: dict[str, str] = {"description": description}
    if lifecycle is not None:
        value["default_lifecycle"] = lifecycle
    return json.dumps(value, sort_keys=True)


def _load_terms(bind: sa.engine.Connection, taxonomy_id: str) -> dict[str, str]:
    return {
        str(name): str(term_id)
        for term_id, name in bind.execute(
            sa.text(
                "SELECT id, name FROM taxonomy_terms WHERE taxonomy_id = :taxonomy_id"
            ),
            {"taxonomy_id": taxonomy_id},
        ).all()
    }


def _ensure_term(
    bind: sa.engine.Connection,
    *,
    taxonomy_id: str,
    name_to_id: dict[str, str],
    name: str,
    parent_term_id: str | None,
    description: str,
    lifecycle: str | None,
    now: datetime,
) -> str:
    term_id = name_to_id.get(name)
    if term_id is None:
        term_id = str(uuid4())
        bind.execute(
            sa.text(
                """
                INSERT INTO taxonomy_terms
                    (id, taxonomy_id, name, normalized_name, parent_term_id,
                     metadata_json, created_at, updated_at)
                VALUES
                    (:id, :taxonomy_id, :name, :name, :parent_term_id,
                     :metadata_json, :now, :now)
                """
            ),
            {
                "id": term_id,
                "taxonomy_id": taxonomy_id,
                "name": name,
                "parent_term_id": parent_term_id,
                "metadata_json": _metadata(description, lifecycle),
                "now": now,
            },
        )
        name_to_id[name] = term_id
        return term_id

    bind.execute(
        sa.text(
            """
            UPDATE taxonomy_terms
            SET parent_term_id = :parent_term_id,
                metadata_json = :metadata_json,
                updated_at = :now
            WHERE id = :id
            """
        ),
        {
            "id": term_id,
            "parent_term_id": parent_term_id,
            "metadata_json": _metadata(description, lifecycle),
            "now": now,
        },
    )
    return term_id


def _migrate_taxonomy(
    bind: sa.engine.Connection,
    *,
    taxonomy_id: str,
    now: datetime,
) -> None:
    legacy_name_to_id = _load_terms(bind, taxonomy_id)
    name_to_id = dict(legacy_name_to_id)
    preserved_lifecycle_entry_ids: set[str] = set()
    for source_name, source_default in LEGACY_DEFAULT_LIFECYCLES.items():
        source_id = legacy_name_to_id.get(source_name)
        if source_id is None:
            continue
        preserved_lifecycle_entry_ids.update(
            str(entry_id)
            for entry_id in bind.execute(
                sa.text(
                    """
                    SELECT entry.id
                    FROM entries AS entry
                    JOIN taxonomy_assignments AS assignment
                      ON assignment.subject_type = 'entry'
                     AND assignment.subject_id = entry.id
                    WHERE assignment.taxonomy_id = :taxonomy_id
                      AND assignment.term_id = :source_id
                      AND entry.lifecycle IS NOT NULL
                      AND entry.lifecycle != :source_default
                    """
                ),
                {
                    "taxonomy_id": taxonomy_id,
                    "source_id": source_id,
                    "source_default": source_default.upper(),
                },
            ).scalars()
        )

    parent_ids: dict[str, str] = {}
    for parent_name, description, _children in ENTRY_CATEGORY_TREE:
        parent_ids[parent_name] = _ensure_term(
            bind,
            taxonomy_id=taxonomy_id,
            name_to_id=name_to_id,
            name=parent_name,
            parent_term_id=None,
            description=description,
            lifecycle=None,
            now=now,
        )

    for parent_name, _description, children in ENTRY_CATEGORY_TREE:
        for child_name, lifecycle, description in children:
            _ensure_term(
                bind,
                taxonomy_id=taxonomy_id,
                name_to_id=name_to_id,
                name=child_name,
                parent_term_id=parent_ids[parent_name],
                description=description,
                lifecycle=lifecycle,
                now=now,
            )

    for source_name, target_name in LEGACY_ASSIGNMENT_FALLBACKS.items():
        source_id = legacy_name_to_id.get(source_name)
        if source_id is None:
            continue
        if target_name is None:
            parameters: dict[str, object] = {
                "taxonomy_id": taxonomy_id,
                "source_id": source_id,
            }
            preserve_clause = ""
            statement = """
                UPDATE entries
                SET lifecycle = NULL
                WHERE id IN (
                    SELECT subject_id FROM taxonomy_assignments
                    WHERE taxonomy_id = :taxonomy_id
                      AND term_id = :source_id
                      AND subject_type = 'entry'
                )
            """
            if preserved_lifecycle_entry_ids:
                statement += " AND id NOT IN :preserved_ids"
                parameters["preserved_ids"] = sorted(preserved_lifecycle_entry_ids)
                lifecycle_statement = sa.text(statement).bindparams(
                    sa.bindparam("preserved_ids", expanding=True)
                )
            else:
                lifecycle_statement = sa.text(statement)
            bind.execute(lifecycle_statement, parameters)
            bind.execute(
                sa.text(
                    """
                    DELETE FROM taxonomy_assignments
                    WHERE taxonomy_id = :taxonomy_id AND term_id = :source_id
                    """
                ),
                {"taxonomy_id": taxonomy_id, "source_id": source_id},
            )
            continue
        target_id = name_to_id[target_name]
        if source_id == target_id:
            continue
        bind.execute(
            sa.text(
                """
                UPDATE taxonomy_assignments
                SET term_id = :target_id, updated_at = :now
                WHERE taxonomy_id = :taxonomy_id AND term_id = :source_id
                """
            ),
            {
                "taxonomy_id": taxonomy_id,
                "source_id": source_id,
                "target_id": target_id,
                "now": now,
            },
        )

    for _parent_name, _description, children in ENTRY_CATEGORY_TREE:
        for child_name, lifecycle, _child_description in children:
            target_id = name_to_id[child_name]
            parameters = {
                "taxonomy_id": taxonomy_id,
                "target_id": target_id,
                "lifecycle": lifecycle.upper(),
            }
            statement = """
                UPDATE entries
                SET lifecycle = :lifecycle
                WHERE id IN (
                    SELECT subject_id FROM taxonomy_assignments
                    WHERE taxonomy_id = :taxonomy_id
                      AND term_id = :target_id
                      AND subject_type = 'entry'
                )
            """
            if preserved_lifecycle_entry_ids:
                statement += " AND id NOT IN :preserved_ids"
                parameters["preserved_ids"] = sorted(preserved_lifecycle_entry_ids)
                lifecycle_statement = sa.text(statement).bindparams(
                    sa.bindparam("preserved_ids", expanding=True)
                )
            else:
                lifecycle_statement = sa.text(statement)
            bind.execute(lifecycle_statement, parameters)

    final_names = {
        name
        for parent_name, _description, children in ENTRY_CATEGORY_TREE
        for name in [parent_name, *(child[0] for child in children)]
    }
    obsolete_names = sorted(LEGACY_TERM_NAMES - final_names)
    bind.execute(
        sa.text(
            """
            DELETE FROM taxonomy_terms
            WHERE taxonomy_id = :taxonomy_id
              AND name IN :obsolete_names
              AND id NOT IN (
                  SELECT term_id FROM taxonomy_assignments
                  WHERE taxonomy_id = :taxonomy_id
              )
            """
        ).bindparams(sa.bindparam("obsolete_names", expanding=True)),
        {"taxonomy_id": taxonomy_id, "obsolete_names": obsolete_names},
    )


def upgrade() -> None:
    bind = op.get_bind()
    now = datetime.now(timezone.utc)
    taxonomy_ids = bind.execute(
        sa.text("SELECT id FROM taxonomies WHERE key = 'entry_category'")
    ).scalars()
    for taxonomy_id in taxonomy_ids:
        _migrate_taxonomy(bind, taxonomy_id=str(taxonomy_id), now=now)


def downgrade() -> None:
    # Exact prior category assignments cannot be reconstructed after entry-level
    # refinement. Restore the pre-migration database backup when rollback is needed.
    pass
