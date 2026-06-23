# Entry category axis

## Status

Completed and archived on 2026-06-22.

## Implemented model

- `entry_category` is a principal-owned, single-cardinality, two-level taxonomy.
- Category is the mutually exclusive dashboard partition.
- `Entry.lifecycle` is `fixed`, `day_to_day`, `one_time`, or null.
- Category leaves provide lifecycle defaults; entry values can override them.
- Tags are auxiliary multi-select labels and may overlap.
- Travel remains an auxiliary tag rather than a category.
- Filter groups remain auxiliary cross-cuts and are not partition math.
- The Entries toolbar filters by searchable category paths; filter-group deep links remain supported without occupying toolbar space.

## Canonical schedule

- `food_drink`: `groceries`, `restaurants`, `delivery_takeout`, `coffee_snacks`, `alcohol_bars`
- `transport`: `transit`, `rideshare_taxi`, `fuel`, `parking`, `airfare`
- `housing`: `rent`, `utilities`, `internet`, `phone`, `home_maintenance`, `accommodation`
- `health`: `medical`, `pharmacy`, `fitness`
- `shopping`: `clothing`, `electronics`, `household_goods`, `personal_care`, `gifts`
- `entertainment`: `streaming_media`, `events_activities`, `hobbies`
- `software_tools`: `ai_apis`, `software_subscriptions`
- `education`: `tuition`, `courses_books`
- `financial`: `insurance`, `taxes`, `fees`, `debt_interest`
- `income`: `salary_wages`, `investment_income`, `other_income`
- `refunds`: `refund`, `reimbursement`, `tax_refund`

## Production migration

- A fresh SQLite backup was created immediately before the live migration.
- Production was upgraded from `0046_entry_category_lifecycle` to
  `0047_entry_category_schedule`.
- A `gpt-5.4-mini` classifier grouped 1,184 entries into 254 merchant signatures.
- Final confidence was 225 high, 26 medium, and 3 low.
- Low-confidence entries received the auxiliary `needs_review` tag.
- Manual review corrected definite semantic errors, including classifying
  `Mobi by Rogers` as `transport/transit`.

## Verification

- SQLite integrity: `ok`
- entry-category terms: 11 parents and 41 children
- categorized entries: 1,800
- duplicate category assignments: 0
- assignments to parent categories: 0
- obsolete prototype category terms: 0
- all 26 dashboard months reconcile:
  - category totals equal expense total
  - lifecycle totals equal expense total
- backend: 498 passed, 4 deselected
- frontend: 263 passed
- frontend production build: passed
- agent workspace image: rebuilt and verified with dashboard and entry-category CLI help
- LLM design check: passed
- documentation sync check: passed
- browser QA on `http://localhost:5173`: passed
