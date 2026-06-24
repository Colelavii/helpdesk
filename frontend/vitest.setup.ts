import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Unmount React trees between tests so the jsdom document doesn't leak state.
afterEach(() => {
  cleanup();
});
