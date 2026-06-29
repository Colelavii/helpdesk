import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import UsersPage from "./UsersPage";
import { renderWithClient } from "../test/render";

// axios.get is heavily overloaded; cast the spy to a loose signature so the
// mock helpers don't fight the overload resolution.
type GetMock = Mock<(url: string, config?: unknown) => Promise<unknown>>;

function mockGet(): GetMock {
  return vi.spyOn(axios, "get") as unknown as GetMock;
}

const sampleUsers = [
  {
    id: "1",
    name: "Ada Admin",
    email: "ada@example.com",
    role: "admin",
    createdAt: "2024-01-15T10:00:00.000Z",
  },
  {
    id: "2",
    name: "Glen Agent",
    email: "glen@example.com",
    role: "agent",
    createdAt: "2024-03-20T10:00:00.000Z",
  },
];

// Mirror the page's own formatter so the expected string matches regardless of
// the runtime's locale/timezone.
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("UsersPage", () => {
  it("shows skeleton placeholders while the request is in flight", () => {
    // A promise that never resolves keeps the query in its pending state.
    mockGet().mockReturnValue(new Promise(() => {}));

    const { container } = renderWithClient(<UsersPage />);

    expect(
      container.querySelectorAll('[data-slot="skeleton"]').length,
    ).toBeGreaterThan(0);
    // The column headers render alongside the skeletons.
    expect(
      screen.getByRole("columnheader", { name: "Name" }),
    ).toBeInTheDocument();
    // Neither the resolved nor the empty/error copy should be visible yet.
    expect(screen.queryByText("No users yet.")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders a row for each user once the request resolves", async () => {
    mockGet().mockResolvedValue({ data: { users: sampleUsers } });

    renderWithClient(<UsersPage />);

    expect(await screen.findByText("Ada Admin")).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.getByText("Glen Agent")).toBeInTheDocument();
    expect(screen.getByText("glen@example.com")).toBeInTheDocument();

    // Roles are rendered verbatim (the capitalize is CSS-only).
    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(screen.getByText("agent")).toBeInTheDocument();

    // The join date is formatted through the same Intl formatter.
    expect(
      screen.getByText(
        dateFormatter.format(new Date(sampleUsers[0].createdAt)),
      ),
    ).toBeInTheDocument();

    // Two data rows, no skeletons left behind.
    const rowGroups = screen.getAllByRole("rowgroup");
    const body = rowGroups[rowGroups.length - 1];
    expect(within(body).getAllByRole("row")).toHaveLength(2);
    expect(document.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0);
  });

  it("shows the empty state when no users exist", async () => {
    mockGet().mockResolvedValue({ data: { users: [] } });

    renderWithClient(<UsersPage />);

    expect(await screen.findByText("No users yet.")).toBeInTheDocument();
    // No table is rendered in the empty state.
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows an error alert when the request fails", async () => {
    mockGet().mockRejectedValue(new Error("network down"));

    renderWithClient(<UsersPage />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Unable to load users.");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("UsersPage — create user dialog", () => {
  // Render with the list resolved so the page is settled before we interact
  // with the dialog (the "New user" trigger lives in the header regardless).
  async function renderSettledPage() {
    mockGet().mockResolvedValue({ data: { users: sampleUsers } });
    const view = renderWithClient(<UsersPage />);
    await screen.findByText("Ada Admin");
    return view;
  }

  it("does not show the dialog until the button is clicked", async () => {
    await renderSettledPage();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the dialog when the New user button is clicked", async () => {
    const user = userEvent.setup();
    await renderSettledPage();

    await user.click(screen.getByRole("button", { name: "New user" }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Create user" }),
    ).toBeInTheDocument();
  });

  it("hides the dialog when the Escape key is pressed", async () => {
    const user = userEvent.setup();
    await renderSettledPage();

    await user.click(screen.getByRole("button", { name: "New user" }));
    await screen.findByRole("dialog");

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("hides the dialog when clicking outside it (the overlay)", async () => {
    const user = userEvent.setup();
    await renderSettledPage();

    await user.click(screen.getByRole("button", { name: "New user" }));
    await screen.findByRole("dialog");

    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    expect(overlay).not.toBeNull();
    await user.click(overlay as Element);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
