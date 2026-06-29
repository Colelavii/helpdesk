import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import CreateUserDialog from "./CreateUserDialog";
import { renderWithClient } from "../test/render";

// axios.post is overloaded; cast the spy to a loose signature so the mock
// helpers don't fight overload resolution (mirrors UsersPage.test.tsx).
type PostMock = Mock<(url: string, data?: unknown, config?: unknown) => Promise<unknown>>;

function mockPost(): PostMock {
  return vi.spyOn(axios, "post") as unknown as PostMock;
}

type User = ReturnType<typeof userEvent.setup>;

const validInput = {
  name: "Jane Doe",
  email: "jane@example.com",
  password: "supersecret",
};

// The trigger + form live behind the dialog, so open it before interacting.
async function openForm(): Promise<User> {
  const user = userEvent.setup();
  renderWithClient(<CreateUserDialog />);
  await user.click(screen.getByRole("button", { name: "New user" }));
  await screen.findByRole("dialog");
  return user;
}

async function fillForm(
  user: User,
  { name, email, password }: typeof validInput,
) {
  await user.type(screen.getByLabelText("Name"), name);
  await user.type(screen.getByLabelText("Email"), email);
  await user.type(screen.getByLabelText("Password"), password);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CreateUserDialog form", () => {
  it("shows validation errors and does not submit when fields are invalid", async () => {
    const post = mockPost();
    const user = await openForm();

    await fillForm(user, {
      name: "Jo",
      email: "not-an-email",
      password: "short",
    });
    await user.click(screen.getByRole("button", { name: "Create user" }));

    expect(
      await screen.findByText("Name must be at least 3 characters"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Enter a valid email address"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Password must be at least 8 characters"),
    ).toBeInTheDocument();

    expect(post).not.toHaveBeenCalled();
    // The dialog stays open so the user can correct the input.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("trims and posts the values, then closes on success", async () => {
    const post = mockPost().mockResolvedValue({ data: {} });
    const user = await openForm();

    // Surrounding whitespace exercises the shared schema's .trim().
    await fillForm(user, {
      name: "  Jane Doe  ",
      email: "jane@example.com",
      password: "supersecret",
    });
    await user.click(screen.getByRole("button", { name: "Create user" }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/api/users", validInput),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("surfaces the server error message and keeps the dialog open", async () => {
    mockPost().mockRejectedValue({
      isAxiosError: true,
      response: { data: { error: "A user with that email already exists" } },
    });
    const user = await openForm();

    await fillForm(user, validInput);
    await user.click(screen.getByRole("button", { name: "Create user" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("A user with that email already exists");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("falls back to a generic message for non-axios failures", async () => {
    mockPost().mockRejectedValue(new Error("network exploded"));
    const user = await openForm();

    await fillForm(user, validInput);
    await user.click(screen.getByRole("button", { name: "Create user" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Unable to create the user. Please try again.",
    );
  });
});
