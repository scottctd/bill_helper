/**
 * CALLING SPEC:
 * - Purpose: define authentication and admin-session contracts for the frontend.
 * - Inputs: frontend modules that manage login state and admin impersonation flows.
 * - Outputs: auth and admin session type aliases from generated OpenAPI types.
 * - Side effects: type declarations only.
 */

import type { ApiSchemas } from "./schemas";

export type AuthUser = ApiSchemas["AuthUserRead"];
export type AuthSession = ApiSchemas["AuthSessionRead"];
export type AuthLoginResponse = ApiSchemas["AuthLoginResponse"];
export type AdminSession = ApiSchemas["AdminSessionRead"];
