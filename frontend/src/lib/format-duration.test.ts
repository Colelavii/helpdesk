import { describe, expect, it } from "vitest";
import { formatDuration } from "./format-duration";

describe("formatDuration", () => {
  // The metric is null when nothing has been resolved yet, which is not the same
  // claim as "resolved in zero minutes".
  it("renders an em dash for null", () => {
    expect(formatDuration(null)).toBe("—");
  });

  it("renders zero as minutes", () => {
    expect(formatDuration(0)).toBe("0m");
  });

  it("renders sub-hour durations as minutes", () => {
    expect(formatDuration(42)).toBe("42m");
    expect(formatDuration(59)).toBe("59m");
  });

  it("drops the minutes on an exact hour", () => {
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(180)).toBe("3h");
  });

  it("renders hours with minutes", () => {
    expect(formatDuration(135)).toBe("2h 15m");
  });

  it("renders multi-day durations as days and hours", () => {
    expect(formatDuration(4560)).toBe("3d 4h");
  });

  it("drops the hours on an exact day", () => {
    expect(formatDuration(1440)).toBe("1d");
  });

  // Never three units: a dashboard figure is read at a glance, and the extra
  // precision isn't acted on.
  it("uses at most two units", () => {
    expect(formatDuration(4572)).toBe("3d 4h");
  });

  it("rounds a fractional value", () => {
    expect(formatDuration(142.5)).toBe("2h 23m");
  });
});
