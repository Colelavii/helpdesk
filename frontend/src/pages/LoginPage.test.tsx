import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoginPage from "./LoginPage";
import { renderWithClient } from "../test/render";

// Mock the auth client so login "succeeds" without hitting a backend, and the
// router navigate so the redirect is a no-op.
const signInEmail = vi.fn().mockResolvedValue({ error: null });
vi.mock("../lib/auth-client", () => ({
  signIn: { email: (...args: unknown[]) => signInEmail(...args) },
}));
vi.mock("react-router-dom", async (importActual) => {
  const actual = await importActual<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

const KEY = "helpdesk.rememberedEmail";

beforeEach(() => {
  localStorage.clear();
  signInEmail.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LoginPage — remember me", () => {
  it("pre-fills the remembered email and checks the box", () => {
    localStorage.setItem(KEY, "saved@example.com");

    renderWithClient(<LoginPage />);

    expect(screen.getByLabelText("Email")).toHaveValue("saved@example.com");
    expect(
      screen.getByRole("checkbox", { name: /remember me/i }),
    ).toBeChecked();
  });

  it("starts empty and unchecked when nothing is remembered", () => {
    renderWithClient(<LoginPage />);

    expect(screen.getByLabelText("Email")).toHaveValue("");
    expect(
      screen.getByRole("checkbox", { name: /remember me/i }),
    ).not.toBeChecked();
  });

  it("saves the email on login when Remember me is checked", async () => {
    const user = userEvent.setup();
    renderWithClient(<LoginPage />);

    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password", { exact: true }), "pw");
    await user.click(screen.getByRole("checkbox", { name: /remember me/i }));
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    // The session flag is sent to the auth client…
    expect(signInEmail).toHaveBeenLastCalledWith(
      expect.objectContaining({ email: "ada@example.com", rememberMe: true }),
    );
    // …and the email is persisted for next time.
    expect(localStorage.getItem(KEY)).toBe("ada@example.com");
  });

  it("forgets the email on login when Remember me is unchecked", async () => {
    localStorage.setItem(KEY, "old@example.com");
    const user = userEvent.setup();
    renderWithClient(<LoginPage />);

    // Starts checked (email remembered); uncheck it.
    await user.click(screen.getByRole("checkbox", { name: /remember me/i }));
    await user.type(screen.getByLabelText("Password", { exact: true }), "pw");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(signInEmail).toHaveBeenLastCalledWith(
      expect.objectContaining({ rememberMe: false }),
    );
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

// Field-level validation runs entirely client-side (react-hook-form + the shared
// zod schema), so it belongs here rather than in the e2e suite. Rejecting bad
// *credentials* is a server concern and stays in e2e/auth.spec.ts.
describe("LoginPage — field validation", () => {
  it("rejects a missing email without calling the auth client", async () => {
    const user = userEvent.setup();
    renderWithClient(<LoginPage />);

    await user.type(screen.getByLabelText("Password", { exact: true }), "pw");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByText("Enter a valid email address"),
    ).toBeInTheDocument();
    expect(signInEmail).not.toHaveBeenCalled();
  });

  it("rejects a malformed email without calling the auth client", async () => {
    const user = userEvent.setup();
    renderWithClient(<LoginPage />);

    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.type(screen.getByLabelText("Password", { exact: true }), "pw");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByText("Enter a valid email address"),
    ).toBeInTheDocument();
    expect(signInEmail).not.toHaveBeenCalled();
  });

  it("rejects a missing password without calling the auth client", async () => {
    const user = userEvent.setup();
    renderWithClient(<LoginPage />);

    await user.type(screen.getByLabelText("Email"), "admin@example.com");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Password is required")).toBeInTheDocument();
    expect(signInEmail).not.toHaveBeenCalled();
  });

  it("reports the email error first when both fields are empty", async () => {
    const user = userEvent.setup();
    renderWithClient(<LoginPage />);

    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByText("Enter a valid email address"),
    ).toBeInTheDocument();
    expect(signInEmail).not.toHaveBeenCalled();
  });
});
