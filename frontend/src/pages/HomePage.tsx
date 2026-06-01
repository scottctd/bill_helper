/**
 * CALLING SPEC:
 * - Purpose: render the `HomePage` React UI module.
 * - Inputs: callers that import `frontend/src/pages/HomePage.tsx` and pass module-defined arguments or framework events.
 * - Outputs: React components and UI helpers exported by `HomePage`.
 * - Side effects: React rendering and user event wiring.
 */
import { WorkspaceSection } from "../components/layout/WorkspaceSection";
import { AgentPanel } from "../features/agent/AgentPanel";

export function HomePage() {
  return (
    <div className="page agent-page">
      <WorkspaceSection className="agent-workspace-shell" contentClassName="agent-workspace-shell-body">
        <AgentPanel isOpen embedded />
      </WorkspaceSection>
    </div>
  );
}
