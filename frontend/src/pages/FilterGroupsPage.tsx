/**
 * CALLING SPEC:
 * - Purpose: render the `FilterGroupsPage` React UI module.
 * - Inputs: callers that import `frontend/src/pages/FilterGroupsPage.tsx` and pass module-defined arguments or framework events.
 * - Outputs: React components and UI helpers exported by `FilterGroupsPage`.
 * - Side effects: React rendering and user event wiring.
 */
import { WorkspaceSection } from "../components/layout/WorkspaceSection";
import { FilterGroupsManager } from "../features/filterGroups/FilterGroupsManager";
import { useFilterGroupsPageModel } from "../features/filterGroups/useFilterGroupsPageModel";

export function FilterGroupsPage() {
  const model = useFilterGroupsPageModel();

  return (
    <div className="page">
      <WorkspaceSection contentClassName="workspace-table-body">
        <div className="table-shell">
          <FilterGroupsManager model={model} />
        </div>
      </WorkspaceSection>
    </div>
  );
}
