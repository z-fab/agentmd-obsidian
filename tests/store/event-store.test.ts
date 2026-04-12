import { describe, it, expect, vi } from "vitest";
import { EventStore } from "../../src/store/event-store";
import type { AgentSummary, ExecutionSummary, ParsedSSEEvent } from "../../src/types";

const AGENT_RESEARCH: AgentSummary = {
  name: "research",
  description: "Research topics",
  trigger: null,
  model: { provider: "anthropic", name: "claude-sonnet-4-6" },
};

const AGENT_DAILY: AgentSummary = {
  name: "daily-summary",
  description: "Summarize vault",
  trigger: { type: "schedule", every: "1h" },
  model: { provider: "google", name: "gemini-2.5-flash" },
  next_run: "2026-04-11T13:00:00Z",
};

describe("EventStore — agents", () => {
  it("stores agents and notifies subscribers", () => {
    const store = new EventStore();
    const cb = vi.fn();
    store.onAgentsChanged(cb);

    store.setAgents([AGENT_RESEARCH, AGENT_DAILY]);

    expect(store.agents).toHaveLength(2);
    expect(store.agents[0].name).toBe("daily-summary"); // alphabetical
    expect(store.agents[1].name).toBe("research");
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe("EventStore — running executions", () => {
  it("tracks a new running execution", () => {
    const store = new EventStore();
    const cb = vi.fn();
    store.onRunningChanged(cb);

    store.startExecution(42, "research", "manual");

    expect(store.running.size).toBe(1);
    const run = store.running.get(42)!;
    expect(run.agent).toBe("research");
    expect(run.triggerSource).toBe("manual");
    expect(run.events).toEqual([]);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("appends SSE events to a running execution", () => {
    const store = new EventStore();
    store.startExecution(42, "research", "manual");

    const event: ParsedSSEEvent = {
      type: "tool_call",
      id: "1",
      data: { tools: [{ name: "web_fetch", args: '{"url":"..."}' }] },
    };
    store.pushEvent(42, event);

    expect(store.running.get(42)!.events).toHaveLength(1);
    expect(store.running.get(42)!.lastActivity).toBe("🔧 web_fetch");
  });

  it("completes an execution — moves from running to history", () => {
    const store = new EventStore();
    const runCb = vi.fn();
    const historyCb = vi.fn();
    store.onRunningChanged(runCb);
    store.onHistoryChanged(historyCb);

    store.startExecution(42, "research", "manual");
    store.completeExecution(42, {
      id: 42,
      agent: "research",
      status: "success",
      started_at: "2026-04-11T12:00:00Z",
      duration_seconds: 28,
      tokens_total: 1400,
      cost_usd: 0.003,
    });

    expect(store.running.size).toBe(0);
    expect(store.history).toHaveLength(1);
    expect(store.history[0].status).toBe("success");
    expect(runCb).toHaveBeenCalledTimes(2); // start + complete
    expect(historyCb).toHaveBeenCalledTimes(1);
  });
});
