/**
 * CALLING SPEC:
 * - Purpose: define runtime settings contracts for the frontend.
 * - Inputs: frontend modules that read or update runtime settings.
 * - Outputs: runtime settings type aliases from generated OpenAPI types.
 * - Side effects: type declarations only.
 */

import type { ApiSchemas } from "./schemas";

export type RuntimeSettingsOverrides = ApiSchemas["RuntimeSettingsOverridesRead"];
export type RuntimeSettings = ApiSchemas["RuntimeSettingsRead"];
export type RuntimeSettingsUpdatePayload = ApiSchemas["RuntimeSettingsUpdate"];
