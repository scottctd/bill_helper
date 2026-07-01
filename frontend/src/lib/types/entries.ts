/**
 * CALLING SPEC:
 * - Purpose: define entry and tag-suggestion contracts for the frontend.
 * - Inputs: frontend modules that list, edit, and classify ledger entries.
 * - Outputs: entry-domain type aliases from generated OpenAPI types.
 * - Side effects: type declarations only.
 */

import type { ApiSchemas } from "./schemas";

export type EntryGroupRef = ApiSchemas["GroupRefRead"];
export type Entry = ApiSchemas["EntryRead"];
export type EntryDetail = ApiSchemas["EntryDetailRead"];
export type EntryListResponse = ApiSchemas["EntryListResponse"];
export type EntryTagSuggestionRequest = ApiSchemas["EntryTagSuggestionRequest"];
export type EntryTagSuggestionResponse = ApiSchemas["EntryTagSuggestionResponse"];
