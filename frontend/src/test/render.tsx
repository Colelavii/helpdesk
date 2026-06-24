import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// Loads the jest-dom matcher augmentation (toBeInTheDocument, etc.) into the
// type graph of every test that imports this helper — without it, editors that
// don't pick up vitest.setup.ts report those matchers as missing.
import "@testing-library/jest-dom/vitest";

// Renders a component tree inside a fresh QueryClient so each test is isolated.
// retry is disabled so error states surface immediately instead of retrying.
export function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}
