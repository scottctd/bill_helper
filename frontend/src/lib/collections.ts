/**
 * CALLING SPEC:
 * - Purpose: normalize optional API list fields from generated OpenAPI types.
 * - Inputs: optional arrays returned by backend read models.
 * - Outputs: stable empty-array defaults for safe iteration.
 * - Side effects: none.
 */

export function listOrEmpty<T>(items: T[] | undefined | null): T[] {
  return items ?? [];
}

export function nullishToNull<T>(value: T | undefined | null): T | null {
  return value ?? null;
}
