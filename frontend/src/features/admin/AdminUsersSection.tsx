/**
 * CALLING SPEC:
 * - Purpose: render admin user create form and users management table.
 * - Inputs: admin page model fields for user CRUD and draft state.
 * - Outputs: create-user card and users table UI.
 * - Side effects: form submit and mutation triggers via model callbacks.
 */
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Checkbox } from "../../components/ui/checkbox";
import { FormField } from "../../components/ui/form-field";
import { Input } from "../../components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import type { AdminPageModel } from "./useAdminPageModel";
import { getApiErrorMessage } from "../../lib/api/core";

export function AdminUsersSection({ model }: { model: AdminPageModel }) {
  const { usersQuery } = model.queries;
  const {
    createUserMutation,
    updateUserMutation,
    resetPasswordMutation,
    deleteUserMutation,
    loginAsMutation
  } = model.mutations;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Create User</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-[2fr_2fr_auto_auto]" onSubmit={model.actions.submitCreateUser}>
            <FormField label="Name">
              <Input
                aria-label="New user name"
                value={model.createName}
                onChange={(event) => model.setCreateName(event.target.value)}
                placeholder="e.g. alice"
              />
            </FormField>
            <FormField label="Password">
              <Input
                aria-label="New user password"
                type="password"
                value={model.createPassword}
                onChange={(event) => model.setCreatePassword(event.target.value)}
                placeholder="Set an initial password"
              />
            </FormField>
            <FormField label="Admin">
              <div className="flex h-10 items-center gap-2 rounded-sm border border-input px-3">
                <Checkbox
                  checked={model.createIsAdmin}
                  onCheckedChange={(checked) => model.setCreateIsAdmin(checked === true)}
                  id="create-admin-checkbox"
                />
                <label htmlFor="create-admin-checkbox" className="text-sm">
                  Grant admin access
                </label>
              </div>
            </FormField>
            <div className="flex items-end">
              <Button type="submit" disabled={createUserMutation.isPending}>
                {createUserMutation.isPending ? "Creating..." : "Create user"}
              </Button>
            </div>
          </form>
          {createUserMutation.error ? <p className="error mt-3">{getApiErrorMessage(createUserMutation.error)}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <CardDescription>Edits apply immediately to the selected account owner.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {usersQuery.isLoading ? <p>Loading users...</p> : null}
          {usersQuery.error ? <p className="error">{getApiErrorMessage(usersQuery.error)}</p> : null}
          {model.users.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Accounts</TableHead>
                  <TableHead>Entries</TableHead>
                  <TableHead>Update</TableHead>
                  <TableHead>Reset Password</TableHead>
                  <TableHead>Session</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {model.users.map((user) => {
                  const draft = model.actions.draftFor(user);
                  return (
                    <TableRow key={user.id}>
                      <TableCell className="align-top">
                        <div className="grid gap-2">
                          <Input
                            value={draft.name}
                            onChange={(event) => model.actions.patchDraft(user.id, { name: event.target.value })}
                            aria-label={`${user.name} display name`}
                          />
                          <div className="flex items-center gap-2">
                            {user.is_current_user ? <Badge variant="secondary">Current</Badge> : null}
                            {model.auth.session?.user.id === user.id ? <Badge variant="outline">This session</Badge> : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="flex h-10 items-center gap-2">
                          <Checkbox
                            checked={draft.is_admin}
                            onCheckedChange={(checked) => model.actions.patchDraft(user.id, { is_admin: checked === true })}
                            id={`user-admin-${user.id}`}
                          />
                          <label htmlFor={`user-admin-${user.id}`} className="text-sm">
                            Admin
                          </label>
                        </div>
                      </TableCell>
                      <TableCell className="align-top">{user.account_count ?? 0}</TableCell>
                      <TableCell className="align-top">{user.entry_count ?? 0}</TableCell>
                      <TableCell className="align-top">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={updateUserMutation.isPending}
                            onClick={() =>
                              updateUserMutation.mutate({
                                userId: user.id,
                                payload: {
                                  name: draft.name,
                                  is_admin: draft.is_admin
                                }
                              })
                            }
                          >
                            Save
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={deleteUserMutation.isPending || user.is_current_user}
                            onClick={() => deleteUserMutation.mutate(user.id)}
                          >
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="grid gap-2">
                          <Input
                            type="password"
                            value={draft.reset_password}
                            onChange={(event) => model.actions.patchDraft(user.id, { reset_password: event.target.value })}
                            placeholder="New password"
                            aria-label={`Reset password for ${user.name}`}
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={resetPasswordMutation.isPending || !draft.reset_password.trim()}
                            onClick={() =>
                              resetPasswordMutation.mutate({
                                userId: user.id,
                                newPassword: draft.reset_password
                              })
                            }
                          >
                            Reset password
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={loginAsMutation.isPending || model.auth.session?.user.id === user.id}
                          onClick={() => loginAsMutation.mutate(user.id)}
                        >
                          Log in as
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : null}
          {updateUserMutation.error ? <p className="error">{getApiErrorMessage(updateUserMutation.error)}</p> : null}
          {resetPasswordMutation.error ? <p className="error">{getApiErrorMessage(resetPasswordMutation.error)}</p> : null}
          {deleteUserMutation.error ? <p className="error">{getApiErrorMessage(deleteUserMutation.error)}</p> : null}
          {loginAsMutation.error ? <p className="error">{getApiErrorMessage(loginAsMutation.error)}</p> : null}
        </CardContent>
      </Card>
    </>
  );
}
