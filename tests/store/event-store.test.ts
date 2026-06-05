import { describe, it, expect, vi } from "vitest";
import { EventStore } from "../../src/store/event-store";
import type { AgentSummary, ExecutionSummary, ParsedSSEEvent } from "../../src/types";

const AGENT_RESEARCH: AgentSummary = {
  name: "research",
  description: "Research topics",
  enabled: true,
  trigger_type: "manual",
  model_provider: "anthropic",
  model_name: "claude-sonnet-4-6",
};

const AGENT_DAILY: AgentSummary = {
  name: "daily-summary",
  description: "Summarize vault",
  enabled: true,
  trigger_type: "schedule",
  model_provider: "google",
  model_name: "gemini-2.5-flash",
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
      agent_id: "research",
      status: "success",
      trigger: "manual",
      started_at: "2026-04-11T12:00:00Z",
      duration_ms: 28000,
      total_tokens: 1400,
      cost_usd: 0.003,
    });

    expect(store.running.size).toBe(0);
    expect(store.history).toHaveLength(1);
    expect(store.history[0].status).toBe("success");
    expect(runCb).toHaveBeenCalledTimes(2); // start + complete
    expect(historyCb).toHaveBeenCalledTimes(1);
  });
});

describe("EventStore.syncRunning", () => {
  it("adds new running executions and removes stale ones", () => {
    const store = new EventStore();

    // Pre-existing running execution #1 (will be removed - not in API list)
    store.startExecution(1, "old-agent", "manual");
    // Pre-existing running execution #2 (will remain - in API list)
    store.startExecution(2, "keep-agent", "scheduler");

    const apiRunning: ExecutionSummary[] = [
      {
        id: 2,
        agent_id: "keep-agent",
        status: "running",
        trigger: "scheduler",
        started_at: "2026-01-01T00:00:00Z",
      },
      {
        id: 3,
        agent_id: "new-agent",
        status: "running",
        trigger: "watch",
        started_at: "2026-01-01T00:00:00Z",
      },
    ];

    const newIds = store.syncRunning(apiRunning);

    // #1 removed, #2 kept, #3 added
    expect(store.running.has(1)).toBe(false);
    expect(store.running.has(2)).toBe(true);
    expect(store.running.has(3)).toBe(true);
    expect(store.running.get(3)?.agent).toBe("new-agent");
    // Returns only newly added IDs
    expect(newIds).toEqual([3]);
  });

  it("treats tool_result as canonical for lastActivity", () => {
    const store = new EventStore();
    store.startExecution(1, "agent", "manual");
    store.pushEvent(1, { type: "tool_result", id: "1", data: { tool_name: "file_read" } });
    expect(store.running.get(1)!.lastActivity).toContain("file_read");
  });

  it("returns empty array when no new executions", () => {
    const store = new EventStore();
    store.startExecution(1, "agent-a", "manual");

    const apiRunning: ExecutionSummary[] = [
      {
        id: 1,
        agent_id: "agent-a",
        status: "running",
        trigger: "manual",
        started_at: "2026-01-01T00:00:00Z",
      },
    ];

    const newIds = store.syncRunning(apiRunning);
    expect(newIds).toEqual([]);
    expect(store.running.size).toBe(1);
  });
});

import type { PendingRequest } from "../../src/types";

const PENDING: PendingRequest = { request_id: "r1", kind: "confirm", message: "Approve?", multi: false };

describe("EventStore — HILT waiting", () => {
  it("marks a tracked execution as waiting and stores the pending request", () => {
    const store = new EventStore();
    const cb = vi.fn();
    store.startExecution(42, "research", "manual");
    store.onRunningChanged(cb);
    store.markWaiting(42, PENDING);
    const run = store.running.get(42)!;
    expect(run.state).toBe("waiting");
    expect(run.pending).toEqual(PENDING);
    expect(store.waitingCount).toBe(1);
    expect(cb).toHaveBeenCalled();
  });

  it("creates the entry if markWaiting targets an untracked execution", () => {
    const store = new EventStore();
    store.markWaiting(99, { ...PENDING, request_id: "r9" }, "scheduled-agent");
    const run = store.running.get(99)!;
    expect(run.state).toBe("waiting");
    expect(run.agent).toBe("scheduled-agent");
  });

  it("markResuming clears pending and returns to running", () => {
    const store = new EventStore();
    store.startExecution(42, "research", "manual");
    store.markWaiting(42, PENDING);
    store.markResuming(42);
    const run = store.running.get(42)!;
    expect(run.state).toBe("running");
    expect(run.pending).toBeUndefined();
    expect(store.waitingCount).toBe(0);
  });

  it("new running executions default to state=running", () => {
    const store = new EventStore();
    store.startExecution(1, "a", "manual");
    expect(store.running.get(1)!.state).toBe("running");
  });
});

describe("EventStore — syncRunning preserves waiting", () => {
  it("does not remove a waiting execution that is absent from the running list", () => {
    const store = new EventStore();
    store.startExecution(7, "a", "manual");
    store.markWaiting(7, { request_id: "r", kind: "confirm", message: "?", multi: false });
    // a sync of status=running executions that does NOT include #7
    store.syncRunning([]);
    expect(store.running.has(7)).toBe(true);
    expect(store.running.get(7)!.state).toBe("waiting");
  });
});
