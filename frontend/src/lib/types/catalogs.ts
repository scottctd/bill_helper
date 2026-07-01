/**
 * CALLING SPEC:
 * - Purpose: define catalog and reference-data types shared across the frontend.
 * - Inputs: frontend modules that render or mutate tags, entities, users, currencies, and taxonomies.
 * - Outputs: catalog type aliases from generated OpenAPI types.
 * - Side effects: type declarations only.
 */

import type { ApiSchemas } from "./schemas";

export type Tag = ApiSchemas["TagRead"];
export type EntryTag = ApiSchemas["TagSummaryRead"];
export type Entity = ApiSchemas["EntityRead"];
export type User = ApiSchemas["UserRead"];
export type Currency = ApiSchemas["CurrencyRead"];
export type Taxonomy = ApiSchemas["TaxonomyRead"];
export type TaxonomyTerm = ApiSchemas["TaxonomyTermRead"];
