import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import DeleteUserDialog from "./DeleteUserDialog";
import { renderWithClient } from "../test/render";

// axios.delete is overloaded; cast the spy to a loose signature so the mock
// helpers don't fight overload resolution (mirrors the other dialog specs).
type DeleteMock = Mock<(url: string, config?: unknown) => Promise<unknown>>;

function mockDelete(): DeleteMock {
  return vi.spyOn(axios, "delete") as unknown as DeleteMock;
}

type User = ReturnType<typeof userEvent.setup>;

const targetUser = { id: "u2", name: "Glen Agent" };

async function openDeleteDialog(user = targetUser): Promise<User> {
  const u = userEvent.setup();
  renderWithClient(<DeleteUserDialog user={user} />);
  await u.click(screen.getByRole("button", { name: `Delete ${user.name}` }));
  await screen.findByRole("alertdialog");
  return u;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DeleteUserDialog", () => {
  it("opens a confirmation naming the user", async () => {
    await openDeleteDialog();

    expect(
      screen.getByRole("heading", { name: "Delete user" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Glen Agent/)).toBeInTheDocument();
  });

  it("DELETEs the user and closes on confirm", async () => {
    const del = mockDelete().mockResolvedValue({ data: { success: true } });
    const user = await openDeleteDialog();

    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(del).toHaveBeenCalledWith("/api/users/u2"),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
  });

  it("does not delete when cancelled", async () => {
    const del = mockDelete();
    const user = await openDeleteDialog();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(del).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
  });

  it("surfaces the server error and keeps the dialog open", async () => {
    mockDelete().mockRejectedValue({
      isAxiosError: true,
      response: { data: { error: "Admin users cannot be deleted" } },
    });
    const user = await openDeleteDialog();

    await user.click(screen.getByRole("button", { name: "Delete" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Admin users cannot be deleted");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("falls back to a generic message for non-axios failures", async () => {
    mockDelete().mockRejectedValue(new Error("network exploded"));
    const user = await openDeleteDialog();

    await user.click(screen.getByRole("button", { name: "Delete" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Unable to delete the user. Please try again.",
    );
  });
});
