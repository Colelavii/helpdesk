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

// jsdom implements neither the Pointer Capture API nor scrollIntoView, both of
// which Radix Select touches the moment its trigger is clicked — without these
// stubs opening one throws and its options can't be asserted at all.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// Unmount React trees between tests so the jsdom document doesn't leak state.
afterEach(() => {
  cleanup();
});
