/**
 * CALLING SPEC:
 * - Purpose: route entry for the Import tab page.
 * - Inputs: React Router page mount.
 * - Outputs: Import workspace shell.
 * - Side effects: none beyond child queries.
 */

import { ImportWorkspace } from "../features/import/ImportWorkspace";

export function ImportPage() {
  return <ImportWorkspace />;
}
