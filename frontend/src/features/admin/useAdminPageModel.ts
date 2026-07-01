/**
 * CALLING SPEC:
 * - Purpose: own admin queries, mutations, user draft state, and auth-gated access.
 * - Inputs: auth context, navigate callback, and TanStack Query client.
 * - Outputs: admin user/session data, form drafts, and CRUD/revoke/impersonation handlers.
 * - Side effects: remote data fetching, cache invalidation, and session adoption on impersonation.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../auth";
import {
  createAdminUser,
  deleteAdminSession,
  deleteAdminUser,
  listAdminSessions,
  listAdminUsers,
  loginAsAdminUser,
  resetAdminUserPassword,
  updateAdminUser
} from "../../lib/api/admin";
import { invalidateAdminReadModels, invalidateUserReadModels } from "../../lib/queryInvalidation";
import { queryKeys } from "../../lib/queryKeys";
import type { User } from "../../lib/types";

interface UserDraft {
  name: string;
  is_admin: boolean;
  reset_password: string;
}

export function useAdminPageModel() {
  const auth = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [createName, setCreateName] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createIsAdmin, setCreateIsAdmin] = useState(false);
  const [userDrafts, setUserDrafts] = useState<Record<string, UserDraft>>({});

  const isAdminAuthenticated = auth.status === "authenticated" && Boolean(auth.session?.user.is_admin);

  const usersQuery = useQuery({
    queryKey: queryKeys.admin.users,
    queryFn: listAdminUsers,
    enabled: isAdminAuthenticated
  });
  const sessionsQuery = useQuery({
    queryKey: queryKeys.admin.sessions,
    queryFn: listAdminSessions,
    enabled: isAdminAuthenticated
  });

  useEffect(() => {
    if (!usersQuery.data) {
      return;
    }
    setUserDrafts((state) => {
      const nextState = { ...state };
      for (const user of usersQuery.data) {
        nextState[user.id] ??= {
          name: user.name,
          is_admin: user.is_admin,
          reset_password: ""
        };
      }
      return nextState;
    });
  }, [usersQuery.data]);

  const createUserMutation = useMutation({
    mutationFn: createAdminUser,
    onSuccess: () => {
      setCreateName("");
      setCreatePassword("");
      setCreateIsAdmin(false);
      invalidateAdminReadModels(queryClient);
      invalidateUserReadModels(queryClient);
    }
  });

  const updateUserMutation = useMutation({
    mutationFn: ({ userId, payload }: { userId: string; payload: { name?: string; is_admin?: boolean } }) =>
      updateAdminUser(userId, payload),
    onSuccess: () => {
      invalidateAdminReadModels(queryClient);
      invalidateUserReadModels(queryClient);
    }
  });

  const resetPasswordMutation = useMutation({
    mutationFn: ({ userId, newPassword }: { userId: string; newPassword: string }) =>
      resetAdminUserPassword(userId, { new_password: newPassword }),
    onSuccess: (_user, variables) => {
      setUserDrafts((state) => ({
        ...state,
        [variables.userId]: {
          ...(state[variables.userId] ?? { name: "", is_admin: false, reset_password: "" }),
          reset_password: ""
        }
      }));
    }
  });

  const deleteUserMutation = useMutation({
    mutationFn: deleteAdminUser,
    onSuccess: () => {
      invalidateAdminReadModels(queryClient, "usersAndSessions");
      invalidateUserReadModels(queryClient);
    }
  });

  const loginAsMutation = useMutation({
    mutationFn: loginAsAdminUser,
    onSuccess: (response) => {
      auth.adoptLoginResponse(response);
      navigate("/", { replace: true });
    }
  });

  const deleteSessionMutation = useMutation({
    mutationFn: deleteAdminSession,
    onSuccess: () => {
      invalidateAdminReadModels(queryClient, "sessions");
    }
  });

  function draftFor(user: User): UserDraft {
    return (
      userDrafts[user.id] ?? {
        name: user.name,
        is_admin: user.is_admin,
        reset_password: ""
      }
    );
  }

  function patchDraft(userId: string, patch: Partial<UserDraft>) {
    setUserDrafts((state) => ({
      ...state,
      [userId]: {
        ...(state[userId] ?? { name: "", is_admin: false, reset_password: "" }),
        ...patch
      }
    }));
  }

  function submitCreateUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createUserMutation.mutate({
      name: createName,
      password: createPassword,
      is_admin: createIsAdmin
    });
  }

  return {
    auth,
    createName,
    setCreateName,
    createPassword,
    setCreatePassword,
    createIsAdmin,
    setCreateIsAdmin,
    users: usersQuery.data ?? [],
    queries: {
      usersQuery,
      sessionsQuery
    },
    mutations: {
      createUserMutation,
      updateUserMutation,
      resetPasswordMutation,
      deleteUserMutation,
      loginAsMutation,
      deleteSessionMutation
    },
    actions: {
      draftFor,
      patchDraft,
      submitCreateUser
    }
  };
}

export type AdminPageModel = ReturnType<typeof useAdminPageModel>;
