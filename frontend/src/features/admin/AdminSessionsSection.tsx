/**
 * CALLING SPEC:
 * - Purpose: render the admin sessions table with revoke actions.
 * - Inputs: admin page model session query and delete-session mutation.
 * - Outputs: sessions card UI for the admin page.
 * - Side effects: session revoke mutation triggers on user action.
 */
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import type { AdminPageModel } from "./useAdminPageModel";
import { getApiErrorMessage } from "../../lib/api/core";

export function AdminSessionsSection({ model }: { model: AdminPageModel }) {
  const { sessionsQuery } = model.queries;
  const { deleteSessionMutation } = model.mutations;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sessions</CardTitle>
        <CardDescription>Revoke stale bearer tokens without touching the owning user.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {sessionsQuery.isLoading ? <p>Loading sessions...</p> : null}
        {sessionsQuery.error ? <p className="error">{getApiErrorMessage(sessionsQuery.error)}</p> : null}
        {(sessionsQuery.data ?? []).length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Flags</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(sessionsQuery.data ?? []).map((session) => (
                <TableRow key={session.id}>
                  <TableCell>{session.user_name}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      {session.is_admin ? <Badge variant="secondary">Admin</Badge> : null}
                      {session.is_admin_impersonation ? <Badge variant="outline">Impersonation</Badge> : null}
                      {session.is_current ? <Badge variant="secondary">Current</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell>{new Date(session.created_at).toLocaleString()}</TableCell>
                  <TableCell>{session.expires_at ? new Date(session.expires_at).toLocaleString() : "Never"}</TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={deleteSessionMutation.isPending}
                      onClick={() => deleteSessionMutation.mutate(session.id)}
                    >
                      Revoke
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
        {deleteSessionMutation.error ? <p className="error">{getApiErrorMessage(deleteSessionMutation.error)}</p> : null}
      </CardContent>
    </Card>
  );
}
