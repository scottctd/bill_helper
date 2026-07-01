/**
 * CALLING SPEC:
 * - Purpose: expose the generated OpenAPI schema map for domain type aliases.
 * - Inputs: modules under `frontend/src/lib/types/` that alias backend contracts.
 * - Outputs: `ApiSchemas` type alias.
 * - Side effects: type declarations only.
 */

import type { components } from "../api-types.gen";

export type ApiSchemas = components["schemas"];
