import { MemoryRouter } from "react-router-dom";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GroupsPage } from "./GroupsPage";
import { renderWithQueryClient } from "../test/renderWithQueryClient";
import type { Entry, GroupRead, GroupSummary, RuntimeSettings } from "../lib/types";
import {
  addGroupMember,
  createGroup,
  deleteGroup,
  deleteGroupMember,
  getEntry,
  getGroup,
  getRuntimeSettings,
  listCurrencies,
  listEntities,
  listEntries,
  listGroups,
  listTags,
  listUsers,
  updateEntry,
  updateGroup
} from "../lib/api";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    listGroups: vi.fn(),
    getGroup: vi.fn(),
    listEntries: vi.fn(),
    createGroup: vi.fn(),
    updateGroup: vi.fn(),
    deleteGroup: vi.fn(),
    addGroupMember: vi.fn(),
    deleteGroupMember: vi.fn(),
    getEntry: vi.fn(),
    listCurrencies: vi.fn(),
    listEntities: vi.fn(),
    listUsers: vi.fn(),
    listTags: vi.fn(),
    getRuntimeSettings: vi.fn(),
    updateEntry: vi.fn()
  };
});

const groupsFixture = [
  {
    id: "group-1",
    name: "OpenAI ChatGPT Plus Subscription",
    description: null,
    color: null,
    source: "manual" as const,
    rule_summary: null,
    member_count: 2,
    position: 0,
    first_occurred_at: "2026-01-06",
    last_occurred_at: "2026-03-06",
    created_at: "2026-03-05T00:00:00Z",
    updated_at: "2026-03-05T00:00:00Z"
  },
  {
    id: "group-2",
    name: "Payroll Deposit",
    description: null,
    color: null,
    source: "manual" as const,
    rule_summary: null,
    member_count: 2,
    position: 1,
    first_occurred_at: "2026-01-15",
    last_occurred_at: "2026-02-15",
    created_at: "2026-03-05T00:00:00Z",
    updated_at: "2026-03-05T00:00:00Z"
  },
  {
    id: "group-4",
    name: "Travel expenses",
    description: null,
    color: "#889977",
    source: "rule" as const,
    rule_summary: "tags include travel",
    member_count: 3,
    position: 3,
    first_occurred_at: "2026-01-01",
    last_occurred_at: "2026-03-01",
    created_at: "2026-03-05T00:00:00Z",
    updated_at: "2026-03-05T00:00:00Z"
  }
] satisfies GroupSummary[];

const runtimeSettingsFixture: RuntimeSettings = {
  user_memory: null,
  default_currency_code: "CAD",
  dashboard_currency_code: "CAD",
  agent_model: "gpt-5",
  entry_tagging_model: null,
  available_agent_models: ["gpt-5"],
  agent_model_display_names: {},
  agent_max_steps: 20,
  agent_bulk_max_concurrent_threads: 4,
  agent_retry_max_attempts: 2,
  agent_retry_initial_wait_seconds: 1,
  agent_retry_max_wait_seconds: 8,
  agent_retry_backoff_multiplier: 2,
  agent_max_image_size_bytes: 5_000_000,
  agent_max_images_per_message: 4,
  agent_max_pdf_pages: 10,
  agent_base_url: null,
  agent_api_key_configured: false,
  overrides: {
    user_memory: null,
    default_currency_code: null,
    dashboard_currency_code: null,
    agent_model: null,
    entry_tagging_model: null,
    available_agent_models: null,
    agent_model_display_names: null,
    agent_max_steps: null,
    agent_bulk_max_concurrent_threads: null,
    agent_retry_max_attempts: null,
    agent_retry_initial_wait_seconds: null,
    agent_retry_max_wait_seconds: null,
    agent_retry_backoff_multiplier: null,
    agent_max_image_size_bytes: null,
    agent_max_images_per_message: null,
    agent_max_pdf_pages: null,
    agent_base_url: null,
    agent_api_key_configured: false
  }
};

const entryFixture: Entry = {
  id: "entry-1",
  kind: "EXPENSE",
  occurred_at: "2026-03-06",
  name: "OpenAI ChatGPT Subscription",
  amount_minor: 3178,
  currency_code: "CAD",
  from_entity_id: null,
  to_entity_id: null,
  owner_user_id: "user-1",
  from_entity: "Scotiabank Credit",
  from_entity_missing: false,
  to_entity: "OpenAI",
  to_entity_missing: false,
  owner: null,
  markdown_body: null,
  lifecycle: null,
  category: null,
  created_at: "2026-03-06T00:00:00Z",
  updated_at: "2026-03-06T00:00:00Z",
  tags: [],
  groups: [
    {
      id: "group-1",
      name: "OpenAI ChatGPT Plus Subscription",
      source: "manual",
      color: null
    }
  ]
};

const groupDetailFixture = {
  id: "group-1",
  name: "OpenAI ChatGPT Plus Subscription",
  description: null,
  color: null,
  source: "manual" as const,
  rule_summary: null,
  member_count: 2,
  position: 0,
  rule: null,
  members: [
    {
      id: "membership-1",
      entry_id: "entry-1",
      override: null,
      entry_name: "OpenAI ChatGPT Subscription",
      occurred_at: "2026-03-06",
      kind: "EXPENSE" as const,
      amount_minor: 3178,
      currency_code: "CAD"
    }
  ],
  first_occurred_at: "2026-01-06",
  last_occurred_at: "2026-03-06",
  created_at: "2026-03-06T00:00:00Z",
  updated_at: "2026-03-06T00:00:00Z"
} satisfies GroupRead;

afterEach(() => {
  vi.clearAllMocks();
});

function mockGroupsPageData() {
  vi.mocked(listGroups).mockResolvedValue(groupsFixture);
  vi.mocked(getGroup).mockResolvedValue(groupDetailFixture);
  vi.mocked(listEntries).mockResolvedValue({
    items: [entryFixture],
    total: 1,
    limit: 200,
    offset: 0
  });
  vi.mocked(createGroup).mockResolvedValue({ ...groupsFixture[0], members: [], rule: null });
  vi.mocked(updateGroup).mockResolvedValue({ ...groupsFixture[0], members: [], rule: null });
  vi.mocked(deleteGroup).mockResolvedValue(undefined);
  vi.mocked(addGroupMember).mockResolvedValue(groupDetailFixture);
  vi.mocked(deleteGroupMember).mockResolvedValue(undefined);
  vi.mocked(getEntry).mockResolvedValue(entryFixture);
  vi.mocked(listCurrencies).mockResolvedValue([{ code: "CAD", name: "Canadian Dollar", entry_count: 1, is_placeholder: false }]);
  vi.mocked(listEntities).mockResolvedValue([
    { id: "entity-1", name: "Scotiabank Credit", category: null, is_account: true, from_count: 1, to_count: 0, account_count: 1, entry_count: 1 },
    { id: "entity-2", name: "OpenAI", category: "Software", is_account: false, from_count: 0, to_count: 1, account_count: 0, entry_count: 1 }
  ]);
  vi.mocked(listUsers).mockResolvedValue([{ id: "user-1", name: "Alice", is_admin: false, is_current_user: true }]);
  vi.mocked(listTags).mockResolvedValue([]);
  vi.mocked(getRuntimeSettings).mockResolvedValue(runtimeSettingsFixture);
  vi.mocked(updateEntry).mockResolvedValue(entryFixture);
}

describe("GroupsPage", () => {
  it("filters groups by selected source", async () => {
    mockGroupsPageData();
    const user = userEvent.setup();

    renderWithQueryClient(
      <MemoryRouter>
        <GroupsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("OpenAI ChatGPT Plus Subscription")).toBeInTheDocument();
    expect(screen.getByText("Travel expenses")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Group source filter" }));
    await user.click(await screen.findByRole("button", { name: /rule/i }));

    await waitFor(() => {
      expect(screen.queryByText("OpenAI ChatGPT Plus Subscription")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Travel expenses")).toBeInTheDocument();
  });

  it("uses a double-click groups browser without raw ids", async () => {
    mockGroupsPageData();
    const user = userEvent.setup();

    renderWithQueryClient(
      <MemoryRouter>
        <GroupsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("OpenAI ChatGPT Plus Subscription")).toBeInTheDocument();
    expect(await screen.findByRole("columnheader", { name: "Group" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Source" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Members" })).toBeInTheDocument();
    expect(screen.queryByText("group-1")).not.toBeInTheDocument();

    const groupRow = screen.getByText("OpenAI ChatGPT Plus Subscription").closest("tr");
    expect(groupRow).not.toBeNull();
    if (!groupRow) {
      throw new Error("Expected parent group row");
    }

    await user.click(groupRow);
    expect(screen.queryByRole("dialog", { name: /OpenAI ChatGPT Plus Subscription/i })).not.toBeInTheDocument();

    await user.dblClick(groupRow);

    const groupDialog = await screen.findByRole("dialog", { name: "OpenAI ChatGPT Plus Subscription" });
    expect(within(groupDialog).getByRole("heading", { name: "Statistics" })).toBeInTheDocument();
    expect(within(groupDialog).getByRole("heading", { name: "Members" })).toBeInTheDocument();
    expect(within(groupDialog).getByText("Total cost")).toBeInTheDocument();
    expect(within(groupDialog).getByText("OpenAI ChatGPT Subscription")).toBeInTheDocument();

    const entryMemberRow = within(groupDialog).getByText("OpenAI ChatGPT Subscription").closest("tr");
    expect(entryMemberRow).not.toBeNull();
    if (!entryMemberRow) {
      throw new Error("Expected direct entry member row");
    }

    const amountCell = within(entryMemberRow).getByText("31.78").closest(".entries-amount-cell");
    const amountMarker = amountCell?.querySelector(".entries-amount-marker");
    expect(within(entryMemberRow).getByText("CAD")).toBeInTheDocument();
    expect(amountMarker).not.toBeNull();
    expect(amountMarker).toHaveTextContent("-");

    await waitFor(() => expect(getGroup).toHaveBeenCalledWith("group-1"));
  });

  it("opens the entry editor when clicking a direct entry member", async () => {
    mockGroupsPageData();
    const user = userEvent.setup();

    renderWithQueryClient(
      <MemoryRouter>
        <GroupsPage />
      </MemoryRouter>
    );

    const groupRow = await screen.findByText("OpenAI ChatGPT Plus Subscription");
    await user.dblClick(groupRow.closest("tr") as HTMLElement);

    const groupDialog = await screen.findByRole("dialog", { name: "OpenAI ChatGPT Plus Subscription" });
    const entryMemberRow = within(groupDialog).getByText("OpenAI ChatGPT Subscription").closest("tr");
    await user.click(entryMemberRow as HTMLElement);

    expect(await screen.findByRole("dialog", { name: "Edit Entry" })).toBeInTheDocument();
    await waitFor(() => expect(getEntry).toHaveBeenCalledWith("entry-1"));
  });

  it("shows rule summary for rule groups in the table", async () => {
    mockGroupsPageData();

    renderWithQueryClient(
      <MemoryRouter>
        <GroupsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("Travel expenses")).toBeInTheDocument();
    expect(screen.getByText("tags include travel")).toBeInTheDocument();
  });
});
