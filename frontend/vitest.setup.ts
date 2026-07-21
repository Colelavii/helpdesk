import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement ResizeObserver, which some Radix primitives (e.g. the
// Checkbox indicator) instantiate on mount. Provide a no-op stub.
if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Unmount React trees between tests so the jsdom document doesn't leak state.
afterEach(() => {
  cleanup();
});
