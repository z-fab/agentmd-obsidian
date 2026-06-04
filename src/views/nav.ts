export type TabKey = "agents" | "live" | "history";

export type Screen =
  | { kind: "tab"; tab: TabKey }
  | { kind: "agent"; name: string }
  | { kind: "execution"; id: number };

export interface NavState {
  stack: Screen[];
}

export function initialNav(tab: TabKey = "agents"): NavState {
  return { stack: [{ kind: "tab", tab }] };
}

export function currentScreen(s: NavState): Screen {
  return s.stack[s.stack.length - 1];
}

/** The tab to highlight: always the base of the stack. */
export function baseTab(s: NavState): TabKey {
  const base = s.stack[0];
  return base.kind === "tab" ? base.tab : "agents";
}

export function switchTab(_s: NavState, tab: TabKey): NavState {
  return { stack: [{ kind: "tab", tab }] };
}

export function push(s: NavState, screen: Screen): NavState {
  return { stack: [...s.stack, screen] };
}

export function back(s: NavState): NavState {
  if (s.stack.length <= 1) return s;
  return { stack: s.stack.slice(0, -1) };
}

export function isDetail(s: NavState): boolean {
  return s.stack.length > 1;
}
