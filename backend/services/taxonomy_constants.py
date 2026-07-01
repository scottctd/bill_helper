# CALLING SPEC:
# - Purpose: Domain service logic for `taxonomy_constants`.
# - Inputs: Callers import `backend/services/taxonomy_constants`.
# - Outputs: Exports module constants or registry entries.
# - Side effects: No persistence; pure helpers unless callers pass live sessions.
from __future__ import annotations

TAG_TYPE_TAXONOMY_KEY = "tag_type"
TAG_TYPE_SUBJECT_TYPE = "tag"
ENTITY_CATEGORY_TAXONOMY_KEY = "entity_category"
ENTITY_CATEGORY_SUBJECT_TYPE = "entity"
ENTRY_CATEGORY_TAXONOMY_KEY = "entry_category"
ENTRY_CATEGORY_SUBJECT_TYPE = "entry"
