import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import UserFormDialog from "./UserFormDialog";
import { renderWithClient } from "../test/render";

// axios.patch is overloaded; cast the spy to a loose signature so the mock
// helpers don't fight overload resolution (mirrors the other dialog specs).
type PatchMock = Mock<
  (url: string, data?: unknown, config?: unknown) => Promise<unknown>
>;

function mockPatch(): PatchMock {
  return vi.spyOn(axios, "patch") as unknown as PatchMock;
}

type User = ReturnType<typeof userEvent.setup>;

const existingUser = {
  id: "u1",
  name: "Ada Admin",
  email: "ada@example.com",
};

// Opens the per-row edit dialog (triggered by the pencil icon button).
async function openEditDialog(user = existingUser): Promise<User> {
  const u = userEvent.setup();
  renderWithClient(<UserFormDialog mode="edit" user={user} />);
  await u.click(screen.getByRole("button", { name: `Edit ${user.name}` }));
  await screen.findByRole("dialog");
  return u;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("UserFormDialog — edit mode", () => {
  it("opens populated with the user's current details and a blank password", async () => {
    await openEditDialog();

    expect(
      screen.getByRole("heading", { name: "Edit user" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Ada Admin");
    expect(screen.getByLabelText("Email")).toHaveValue("ada@example.com");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(
      screen.getByText("Leave blank to keep the current password."),
    ).toBeInTheDocument();
  });

  it("PATCHes the edited fields and closes on success", async () => {
    const patch = mockPatch().mockResolvedValue({ data: {} });
    const user = await openEditDialog();

    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Ada Lovelace");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    // Password left blank is sent empty; the server treats that as "no change".
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith("/api/users/u1", {
        name: "Ada Lovelace",
        email: "ada@example.com",
        password: "",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("includes the new password when one is provided", async () => {
    const patch = mockPatch().mockResolvedValue({ data: {} });
    const user = await openEditDialog();

    await user.type(screen.getByLabelText("Password"), "brandnewpass");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith("/api/users/u1", {
        name: "Ada Admin",
        email: "ada@example.com",
        password: "brandnewpass",
      }),
    );
  });

  it("rejects a too-short password without submitting", async () => {
    const patch = mockPatch();
    const user = await openEditDialog();

    await user.type(screen.getByLabelText("Password"), "short");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(
      await screen.findByText("Password must be at least 8 characters"),
    ).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("surfaces the server error message and keeps the dialog open", async () => {
    mockPatch().mockRejectedValue({
      isAxiosError: true,
      response: { data: { error: "A user with that email already exists" } },
    });
    const user = await openEditDialog();

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("A user with that email already exists");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("falls back to a generic update message for non-axios failures", async () => {
    mockPatch().mockRejectedValue(new Error("network exploded"));
    const user = await openEditDialog();

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Unable to update the user. Please try again.",
    );
  });
});
