import { describe, it, expect } from "vitest";
import { formatRelativeTime, formatTokens, formatCost, formatDuration } from "../../src/ui/format";

describe("formatDuration", () => {
  it("formats seconds", () => expect(formatDuration(23)).toBe("23s"));
  it("formats minutes", () => expect(formatDuration(125)).toBe("2m 5s"));
  it("formats hours", () => expect(formatDuration(3661)).toBe("1h 1m"));
});

describe("formatTokens", () => {
  it("formats small counts", () => expect(formatTokens(340)).toBe("340 tok"));
  it("formats thousands", () => expect(formatTokens(1400)).toBe("1.4k tok"));
  it("formats undefined", () => expect(formatTokens(undefined)).toBe("—"));
});

describe("formatCost", () => {
  it("formats small costs", () => expect(formatCost(0.003)).toBe("$0.003"));
  it("formats larger costs", () => expect(formatCost(1.5)).toBe("$1.50"));
  it("formats undefined", () => expect(formatCost(undefined)).toBe("—"));
});

describe("formatRelativeTime", () => {
  it("formats just now", () => {
    const now = new Date().toISOString();
    expect(formatRelativeTime(now)).toBe("just now");
  });
  it("formats minutes ago", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatRelativeTime(fiveMinAgo)).toBe("5m ago");
  });
  it("formats hours ago", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
    expect(formatRelativeTime(twoHoursAgo)).toBe("2h ago");
  });
});
