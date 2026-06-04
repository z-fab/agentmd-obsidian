import { describe, it, expect } from "vitest";
import { type NavState, initialNav, switchTab, push, back, currentScreen, baseTab } from "../../src/views/nav";

describe("nav reducer", () => {
  it("starts on the agents tab", () => {
    const s = initialNav();
    expect(currentScreen(s)).toEqual({ kind: "tab", tab: "agents" });
    expect(baseTab(s)).toBe("agents");
  });

  it("switchTab resets the stack to a single tab screen", () => {
    let s = initialNav();
    s = push(s, { kind: "agent", name: "x" });
    s = switchTab(s, "history");
    expect(s.stack).toHaveLength(1);
    expect(currentScreen(s)).toEqual({ kind: "tab", tab: "history" });
  });

  it("push drills down and back pops", () => {
    let s = initialNav();
    s = switchTab(s, "history");
    s = push(s, { kind: "execution", id: 5 });
    expect(currentScreen(s)).toEqual({ kind: "execution", id: 5 });
    expect(baseTab(s)).toBe("history");
    s = back(s);
    expect(currentScreen(s)).toEqual({ kind: "tab", tab: "history" });
  });

  it("back is a no-op at the root", () => {
    let s = initialNav();
    s = back(s);
    expect(currentScreen(s)).toEqual({ kind: "tab", tab: "agents" });
  });

  it("supports agent -> execution chains", () => {
    let s = initialNav();
    s = push(s, { kind: "agent", name: "daily" });
    s = push(s, { kind: "execution", id: 9 });
    s = back(s);
    expect(currentScreen(s)).toEqual({ kind: "agent", name: "daily" });
  });
});
