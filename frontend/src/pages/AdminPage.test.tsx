import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminPage } from "./AdminPage";
import { renderWithQueryClient } from "../test/renderWithQueryClient";
import type { AdminSession, User } from "../lib/types";
import {
  createAdminUser,
  deleteAdminSession,
  deleteAdminUser,
  listAdminSessions,
  listAdminUsers,
  loginAsAdminUser,
  resetAdminUserPassword,
  updateAdminUser
} from "../lib/api/admin";

const mockNavigate = vi.fn();
const mockAdoptLoginResponse = vi.fn();

vi.mock("../lib/api/admin", () => ({
  listAdminUsers: vi.fn(),
  createAdminUser: vi.fn(),
  updateAdminUser: vi.fn(),
  resetAdminUserPassword: vi.fn(),
  deleteAdminUser: vi.fn(),
  loginAsAdminUser: vi.fn(),
  listAdminSessions: vi.fn(),
  deleteAdminSession: vi.fn()
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

vi.mock("../features/auth", async () => {
  const actual = await vi.importActual<typeof import("../features/auth")>("../features/auth");
  return {
    ...actual,
    useAuth: () => ({
      status: "authenticated",
      session: {
        token: "admin-token",
        user: { id: "admin-1", name: "Admin", is_admin: true }
      },
      adoptLoginResponse: mockAdoptLoginResponse
    })
  };
});

const adminUser: User = {
  id: "admin-1",
  name: "Admin",
  is_admin: true,
  is_current_user: true,
  account_count: 1,
  entry_count: 2
};

const regularUser: User = {
  id: "user-2",
  name: "Alice",
  is_admin: false,
  is_current_user: false,
  account_count: 0,
  entry_count: 5
};

const sessionFixture: AdminSession = {
  id: "session-1",
  user_id: "user-2",
  user_name: "Alice",
  is_admin: false,
  is_admin_impersonation: false,
  is_current: false,
  created_at: "2026-03-01T12:00:00Z",
  expires_at: "2026-04-01T12:00:00Z"
};

function mockAdminPageData() {
  vi.mocked(listAdminUsers).mockResolvedValue([adminUser, regularUser]);
  vi.mocked(listAdminSessions).mockResolvedValue([sessionFixture]);
  vi.mocked(createAdminUser).mockResolvedValue({
    id: "user-3",
    name: "Bob",
    is_admin: false,
    is_current_user: false
  });
  vi.mocked(updateAdminUser).mockResolvedValue({ ...regularUser, name: "Alice Updated" });
  vi.mocked(resetAdminUserPassword).mockResolvedValue(regularUser);
  vi.mocked(deleteAdminUser).mockResolvedValue(undefined);
  vi.mocked(deleteAdminSession).mockResolvedValue(undefined);
  vi.mocked(loginAsAdminUser).mockResolvedValue({
    token: "impersonation-token",
    session_id: "session-impersonation",
    is_admin_impersonation: true,
    user: { id: "user-2", name: "Alice", is_admin: false }
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

function aliceRow() {
  const nameInput = screen.getByLabelText("Alice display name");
  return nameInput.closest("tr") as HTMLElement;
}

describe("AdminPage", () => {
  it("creates a user from the create form", async () => {
    mockAdminPageData();
    const user = userEvent.setup();

    renderWithQueryClient(
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>
    );

    await screen.findByText("Alice");
    await user.type(screen.getByLabelText("New user name"), "Bob");
    await user.type(screen.getByLabelText("New user password"), "secret123");
    await user.click(screen.getByRole("button", { name: "Create user" }));

    await waitFor(() => {
      expect(vi.mocked(createAdminUser).mock.calls[0]?.[0]).toEqual({
        name: "Bob",
        password: "secret123",
        is_admin: false
      });
    });
  });

  it("updates a user when Save is clicked", async () => {
    mockAdminPageData();
    const user = userEvent.setup();

    renderWithQueryClient(
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>
    );

    const nameInput = await screen.findByLabelText("Alice display name");
    await user.clear(nameInput);
    await user.type(nameInput, "Alice Updated");
    await user.click(within(aliceRow()).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(vi.mocked(updateAdminUser).mock.calls[0]?.[0]).toBe("user-2");
      expect(vi.mocked(updateAdminUser).mock.calls[0]?.[1]).toEqual({
        name: "Alice Updated",
        is_admin: false
      });
    });
  });

  it("deletes a non-current user", async () => {
    mockAdminPageData();
    const user = userEvent.setup();

    renderWithQueryClient(
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>
    );

    await screen.findByText("Alice");
    await user.click(within(aliceRow()).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(vi.mocked(deleteAdminUser).mock.calls[0]?.[0]).toBe("user-2");
    });
  });

  it("resets a user password", async () => {
    mockAdminPageData();
    const user = userEvent.setup();

    renderWithQueryClient(
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>
    );

    await screen.findByText("Alice");
    await user.type(screen.getByLabelText("Reset password for Alice"), "newpass");
    await user.click(within(aliceRow()).getByRole("button", { name: "Reset password" }));

    await waitFor(() => {
      expect(vi.mocked(resetAdminUserPassword).mock.calls[0]?.[0]).toBe("user-2");
      expect(vi.mocked(resetAdminUserPassword).mock.calls[0]?.[1]).toEqual({ new_password: "newpass" });
    });
  });

  it("revokes a session", async () => {
    mockAdminPageData();
    const user = userEvent.setup();

    renderWithQueryClient(
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>
    );

    await screen.findByText("Alice");
    await user.click(screen.getByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      expect(vi.mocked(deleteAdminSession).mock.calls[0]?.[0]).toBe("session-1");
    });
  });

  it("adopts impersonation token via auth provider on login-as", async () => {
    mockAdminPageData();
    const user = userEvent.setup();

    renderWithQueryClient(
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>
    );

    await screen.findByText("Alice");
    await user.click(within(aliceRow()).getByRole("button", { name: "Log in as" }));

    await waitFor(() => {
      expect(vi.mocked(loginAsAdminUser).mock.calls[0]?.[0]).toBe("user-2");
      expect(mockAdoptLoginResponse).toHaveBeenCalledWith({
        token: "impersonation-token",
        session_id: "session-impersonation",
        is_admin_impersonation: true,
        user: { id: "user-2", name: "Alice", is_admin: false }
      });
      expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
    });
  });
});
