/**
 * CALLING SPEC:
 * - Purpose: render the admin page shell for user CRUD, session revoke, and impersonation.
 * - Inputs: admin page model from useAdminPageModel.
 * - Outputs: admin management UI with auth-gated routing.
 * - Side effects: React rendering and user event wiring.
 */
import { Navigate } from "react-router-dom";

import { Card, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { AdminSessionsSection } from "../features/admin/AdminSessionsSection";
import { AdminUsersSection } from "../features/admin/AdminUsersSection";
import { useAdminPageModel } from "../features/admin/useAdminPageModel";

export function AdminPage() {
  const model = useAdminPageModel();

  if (model.auth.status === "loading") {
    return <p>Loading admin tools...</p>;
  }

  if (model.auth.status !== "authenticated") {
    return <Navigate to="/login" replace />;
  }

  if (!model.auth.session?.user.is_admin) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="stack-lg">
      <Card>
        <CardHeader>
          <CardTitle>Admin</CardTitle>
          <CardDescription>Create users, rotate passwords, inspect active sessions, and start impersonation sessions.</CardDescription>
        </CardHeader>
      </Card>

      <AdminUsersSection model={model} />
      <AdminSessionsSection model={model} />
    </div>
  );
}
