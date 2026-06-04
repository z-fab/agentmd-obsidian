import { describe, it, expect } from "vitest";
import { resolveAgentEmoji, EMOJI_PALETTE } from "../../src/ui/agent-emoji";

describe("resolveAgentEmoji", () => {
  it("uses the explicit icon when present", () => {
    expect(resolveAgentEmoji("daily", "📅")).toBe("📅");
  });

  it("is deterministic for the same name", () => {
    expect(resolveAgentEmoji("inbox-triage")).toBe(resolveAgentEmoji("inbox-triage"));
  });

  it("returns a palette emoji when no icon", () => {
    const e = resolveAgentEmoji("joke-writer");
    expect(EMOJI_PALETTE).toContain(e);
  });

  it("ignores empty icon and falls back", () => {
    const e = resolveAgentEmoji("weekly-report", "");
    expect(EMOJI_PALETTE).toContain(e);
  });
});
