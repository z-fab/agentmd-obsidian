# Global SSE Migration + Backend Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all polling with a single global SSE connection and add start/stop backend controls from the Obsidian UI.

**Architecture:** A new `GlobalSSEConnection` opens `GET /events/stream` and dispatches events to the EventStore. BackendMonitor is refactored to derive online/offline from SSE heartbeats instead of polling `/health`. A new `BackendLifecycle` module starts/stops the backend via `child_process.execFile()` / `POST /shutdown`. LiveView drops its 2s poll and reacts to the store. All 4 existing timers in main.ts are removed.

**Tech Stack:** TypeScript, Obsidian Plugin API, Node.js `http` + `child_process.execFile`, Vitest

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/client/global-sse.ts` | Persistent SSE connection to `/events/stream` with reconnection + fallback |
| Create | `src/backend-lifecycle.ts` | Start backend via `execFile`, stop via API |
| Create | `tests/client/global-sse.test.ts` | Unit tests for GlobalSSEConnection |
| Create | `tests/backend-lifecycle.test.ts` | Unit tests for BackendLifecycle |
| Modify | `src/types.ts` | Add global SSE event types |
| Modify | `src/client/agentmd-client.ts` | Add `shutdown()` method |
| Modify | `src/backend-monitor.ts` | Refactor: SSE-driven liveness with polling fallback |
| Modify | `tests/backend-monitor.test.ts` | Update tests for refactored monitor |
| Modify | `src/settings.ts` | Add `agentmdPath` field |
| Modify | `src/settings-tab.ts` | Add `agentmdPath` UI |
| Modify | `src/store/event-store.ts` | Add `syncRunning()` method |
| Modify | `src/views/live-view.ts` | Remove polling, react to store |
| Modify | `src/views/agents-view.ts` | Add start button to offline state |
| Modify | `src/views/executions-view.ts` | Add start button to offline state |
| Modify | `main.ts` | Remove 4 timers, integrate GlobalSSE + Lifecycle |
| Modify | `styles.css` | Status bar fallback state, offline start button |
| Modify | `README.md` | Update docs |

---

### Task 1: Add global SSE event types and shutdown client method

**Files:**
- Modify: `src/types.ts`
- Modify: `src/client/agentmd-client.ts`

- [ ] **Step 1: Add global SSE event types to `src/types.ts`**

At the end of the SSE events section (after `ParsedSSEEvent`, before the Log entries section), add:

```ts
// ---------- Global SSE events (GET /events/stream) ----------

export interface GlobalSSEHeartbeat {
  timestamp: string;
}

export interface GlobalSSEExecutionStarted {
  execution_id: number;
  agent_name: string;
  trigger: string;
}

export interface GlobalSSEExecutionCompleted {
  execution_id: number;
  agent_name: string;
  status: string;
  duration_ms: number;
}

export interface GlobalSSEAgentsChanged {
  event: "loaded" | "updated" | "removed";
  agent_name: string;
}

export interface GlobalSSESchedulerChanged {
  status: "paused" | "running";
}
```

- [ ] **Step 2: Add `shutdown()` method to `src/client/agentmd-client.ts`**

After the `resumeScheduler()` method (line 117), add:

```ts
  /** Sends a graceful shutdown request to the backend. */
  async shutdown(): Promise<void> {
    await this.post("/shutdown");
  }
```

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/client/agentmd-client.ts
git commit -m "feat: add global SSE event types and shutdown client method"
```

---

### Task 2: Add `syncRunning()` to EventStore

**Files:**
- Modify: `src/store/event-store.ts`
- Modify: `tests/store/event-store.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/store/event-store.test.ts`. Ensure the import at the top of the file includes `ExecutionSummary`:

```ts
import type { ExecutionSummary } from "../src/types";
```

Then add these tests:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/store/event-store.test.ts`
Expected: FAIL with `store.syncRunning is not a function`

- [ ] **Step 3: Implement `syncRunning` in `src/store/event-store.ts`**

Add the import for `ExecutionSummary` at the top of the file (update existing import):

```ts
import type { AgentSummary, ExecutionSummary, ParsedSSEEvent } from "../types";
```

Add this method after `removeRunning()`:

```ts
  /**
   * Sync running executions with the API response.
   * Removes entries not in the API list, adds new ones.
   * Returns the IDs of newly added executions (caller should subscribe SSE for them).
   */
  syncRunning(apiRunning: ExecutionSummary[]): number[] {
    const apiIds = new Set(apiRunning.map((e) => e.id));
    const newIds: number[] = [];

    // Remove stale entries
    for (const id of this._running.keys()) {
      if (!apiIds.has(id)) {
        this._running.delete(id);
      }
    }

    // Add new entries
    for (const exec of apiRunning) {
      if (!this._running.has(exec.id)) {
        this._running.set(exec.id, {
          id: exec.id,
          agent: exec.agent_id,
          triggerSource: exec.trigger ?? "unknown",
          startedAt: new Date(exec.started_at).getTime(),
          events: [],
          lastActivity: "",
          tokensTotal: 0,
          costUsd: 0,
        });
        newIds.push(exec.id);
      }
    }

    this.notify(this.runningListeners);
    return newIds;
  }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/store/event-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/event-store.ts tests/store/event-store.test.ts
git commit -m "feat: add syncRunning to EventStore for SSE reconnection sync"
```

---

### Task 3: Implement GlobalSSEConnection

**Files:**
- Create: `src/client/global-sse.ts`
- Create: `tests/client/global-sse.test.ts`

- [ ] **Step 1: Write tests for GlobalSSEConnection**

Create `tests/client/global-sse.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { GlobalSSEConnection, type GlobalSSEState } from "../../src/client/global-sse";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

// --- Test helpers ---

function tempSocketPath(): string {
  const name = `agentmd-test-sse-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`;
  return path.join(os.tmpdir(), name);
}

function startSSEServer(
  socketPath: string,
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.on("error", reject);
    server.listen(socketPath, () => resolve(server));
  });
}

function stopServer(server: http.Server, socketPath: string): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => {
      try { fs.unlinkSync(socketPath); } catch { /* ignore */ }
      resolve();
    });
  });
}

function sseMessage(event: string, data: object): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// --- Tests ---

describe("GlobalSSEConnection - event dispatch", () => {
  let socketPath: string;
  let server: http.Server;

  afterEach(async () => {
    if (server) await stopServer(server, socketPath);
  });

  it("dispatches heartbeat events to onEvent callback", async () => {
    socketPath = tempSocketPath();
    const events: Array<{ type: string; data: unknown }> = [];

    server = await startSSEServer(socketPath, (_req, res) => {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(sseMessage("heartbeat", { timestamp: "2026-01-01T00:00:00Z" }));
    });

    const sse = new GlobalSSEConnection({
      socketPath,
      onEvent: (type, data) => events.push({ type, data }),
      reconnectBackoffMs: [100, 200],
      maxReconnectAttempts: 2,
    });

    sse.start();
    await new Promise((r) => setTimeout(r, 200));
    sse.stop();

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].type).toBe("heartbeat");
  });

  it("dispatches execution_started events", async () => {
    socketPath = tempSocketPath();
    const events: Array<{ type: string; data: unknown }> = [];

    server = await startSSEServer(socketPath, (_req, res) => {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(sseMessage("execution_started", {
        execution_id: 42,
        agent_name: "test-agent",
        trigger: "manual",
      }));
    });

    const sse = new GlobalSSEConnection({
      socketPath,
      onEvent: (type, data) => events.push({ type, data }),
      reconnectBackoffMs: [100],
      maxReconnectAttempts: 1,
    });

    sse.start();
    await new Promise((r) => setTimeout(r, 200));
    sse.stop();

    expect(events.some((e) => e.type === "execution_started")).toBe(true);
    const started = events.find((e) => e.type === "execution_started");
    expect((started!.data as any).execution_id).toBe(42);
  });

  it("reports state changes", async () => {
    socketPath = tempSocketPath();
    const states: GlobalSSEState[] = [];

    server = await startSSEServer(socketPath, (_req, res) => {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(sseMessage("heartbeat", { timestamp: "2026-01-01T00:00:00Z" }));
    });

    const sse = new GlobalSSEConnection({
      socketPath,
      onEvent: () => {},
      onStateChanged: (state) => states.push(state),
      reconnectBackoffMs: [100],
      maxReconnectAttempts: 1,
    });

    sse.start();
    await new Promise((r) => setTimeout(r, 200));

    expect(states).toContain("connected");

    sse.stop();
  });
});

describe("GlobalSSEConnection - reconnection", () => {
  it("attempts reconnection when connection is refused", async () => {
    const socketPath = tempSocketPath();
    const states: GlobalSSEState[] = [];

    const sse = new GlobalSSEConnection({
      socketPath, // no server listening
      onEvent: () => {},
      onStateChanged: (state) => states.push(state),
      reconnectBackoffMs: [50, 100],
      maxReconnectAttempts: 2,
    });

    sse.start();
    await new Promise((r) => setTimeout(r, 500));
    sse.stop();

    expect(states).toContain("reconnecting");
    // After max attempts, should go to fallback
    expect(states).toContain("fallback");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/client/global-sse.test.ts`
Expected: FAIL — cannot resolve `../../src/client/global-sse`

- [ ] **Step 3: Implement GlobalSSEConnection**

Create `src/client/global-sse.ts`:

```ts
import { SSEParser } from "./sse-parser";
import type { ParsedSSEEvent } from "../types";
import * as http from "node:http";

export type GlobalSSEState = "connected" | "reconnecting" | "fallback" | "offline";

export interface GlobalSSEOptions {
  socketPath: string;
  onEvent: (type: string, data: Record<string, unknown>) => void;
  onStateChanged?: (state: GlobalSSEState) => void;
  /** Backoff steps in ms for reconnection. Default: [2000, 4000, 8000, 16000, 30000] */
  reconnectBackoffMs?: number[];
  /** How many reconnection attempts before activating fallback. Default: 5 */
  maxReconnectAttempts?: number;
  /** Heartbeat timeout in ms. If no event arrives within this window, connection is considered dead. Default: 12000 */
  heartbeatTimeoutMs?: number;
}

export class GlobalSSEConnection {
  private readonly socketPath: string;
  private readonly onEvent: (type: string, data: Record<string, unknown>) => void;
  private readonly onStateChanged: (state: GlobalSSEState) => void;
  private readonly backoffMs: number[];
  private readonly maxReconnectAttempts: number;
  private readonly heartbeatTimeoutMs: number;

  private closeSSE: (() => void) | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private _state: GlobalSSEState = "offline";
  private active = false;

  constructor(options: GlobalSSEOptions) {
    this.socketPath = options.socketPath;
    this.onEvent = options.onEvent;
    this.onStateChanged = options.onStateChanged ?? (() => {});
    this.backoffMs = options.reconnectBackoffMs ?? [2000, 4000, 8000, 16000, 30000];
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 12000;
  }

  get state(): GlobalSSEState {
    return this._state;
  }

  get isConnected(): boolean {
    return this._state === "connected";
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.connect();
  }

  stop(): void {
    this.active = false;
    this.closeSSE?.();
    this.closeSSE = null;
    this.clearReconnectTimer();
    this.clearHeartbeatTimer();
    this.setState("offline");
  }

  /** Force an immediate reconnection attempt (e.g., after backend start). */
  reconnectNow(): void {
    if (!this.active || this._state === "connected") return;
    this.clearReconnectTimer();
    this.connect();
  }

  private connect(): void {
    if (!this.active) return;

    const parser = new SSEParser();

    const req = http.request(
      {
        socketPath: this.socketPath,
        path: "/events/stream",
        method: "GET",
        headers: { Accept: "text/event-stream" },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume(); // drain
          this.handleDisconnect();
          return;
        }

        // Connected successfully
        this.reconnectAttempts = 0;
        this.setState("connected");
        this.resetHeartbeatTimer();

        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          if (!this.active) return;
          this.resetHeartbeatTimer();
          const events = parser.push(chunk);
          for (const event of events) {
            this.dispatchEvent(event);
          }
        });
        res.on("end", () => {
          if (this.active) this.handleDisconnect();
        });
        res.on("error", () => {
          if (this.active) this.handleDisconnect();
        });
      },
    );

    req.on("error", () => {
      if (this.active) this.handleDisconnect();
    });

    req.end();

    this.closeSSE = () => {
      req.destroy();
    };
  }

  private dispatchEvent(event: ParsedSSEEvent): void {
    try {
      this.onEvent(event.type, event.data as unknown as Record<string, unknown>);
    } catch (err) {
      console.error("GlobalSSE: error in event handler:", err);
    }
  }

  private handleDisconnect(): void {
    this.closeSSE?.();
    this.closeSSE = null;
    this.clearHeartbeatTimer();

    if (!this.active) return;

    this.reconnectAttempts++;

    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      this.setState("fallback");
    } else {
      this.setState("reconnecting");
    }

    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (!this.active) return;
    this.clearReconnectTimer();

    const idx = Math.min(this.reconnectAttempts - 1, this.backoffMs.length - 1);
    const delay = this.backoffMs[Math.max(0, idx)];

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.active) this.connect();
    }, delay);
  }

  private resetHeartbeatTimer(): void {
    this.clearHeartbeatTimer();
    this.heartbeatTimer = setTimeout(() => {
      this.heartbeatTimer = null;
      // No event received within timeout - connection is dead
      if (this.active && this._state === "connected") {
        this.handleDisconnect();
      }
    }, this.heartbeatTimeoutMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer != null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimer != null) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private setState(next: GlobalSSEState): void {
    if (this._state === next) return;
    this._state = next;
    this.onStateChanged(next);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/client/global-sse.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/client/global-sse.ts tests/client/global-sse.test.ts
git commit -m "feat: implement GlobalSSEConnection with reconnection and fallback"
```

---

### Task 4: Implement BackendLifecycle

**Files:**
- Create: `src/backend-lifecycle.ts`
- Create: `tests/backend-lifecycle.test.ts`

- [ ] **Step 1: Write tests**

Create `tests/backend-lifecycle.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { BackendLifecycle } from "../src/backend-lifecycle";

describe("BackendLifecycle", () => {
  it("constructs with default agentmd path", () => {
    const lifecycle = new BackendLifecycle({
      healthCheck: async () => false,
      shutdown: async () => {},
    });
    expect(lifecycle).toBeDefined();
  });

  it("stop() calls the shutdown function", async () => {
    const shutdown = vi.fn(async () => {});
    const lifecycle = new BackendLifecycle({
      healthCheck: async () => true,
      shutdown,
    });

    await lifecycle.stop();
    expect(shutdown).toHaveBeenCalledOnce();
  });

  it("stop() returns false and does not throw if shutdown fails", async () => {
    const shutdown = vi.fn(async () => {
      throw new Error("connection refused");
    });
    const lifecycle = new BackendLifecycle({
      healthCheck: async () => true,
      shutdown,
    });

    const result = await lifecycle.stop();
    expect(result).toBe(false);
  });

  it("start() returns success when health check passes after exec", async () => {
    let healthCallCount = 0;
    const lifecycle = new BackendLifecycle({
      agentmdPath: "echo", // "echo" exists on all platforms and will succeed
      healthCheck: async () => {
        healthCallCount++;
        return healthCallCount >= 2; // fail first, pass second
      },
      shutdown: async () => {},
      startTimeoutMs: 5000,
      startPollMs: 50,
    });

    const result = await lifecycle.start();
    expect(result.success).toBe(true);
  });

  it("start() returns failure when health check never passes", async () => {
    const lifecycle = new BackendLifecycle({
      agentmdPath: "echo",
      healthCheck: async () => false,
      shutdown: async () => {},
      startTimeoutMs: 200,
      startPollMs: 50,
    });

    const result = await lifecycle.start();
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/backend-lifecycle.test.ts`
Expected: FAIL — cannot resolve `../src/backend-lifecycle`

- [ ] **Step 3: Implement BackendLifecycle**

Create `src/backend-lifecycle.ts`:

```ts
import { execFile } from "node:child_process";

export interface BackendLifecycleOptions {
  /** Path to the agentmd executable. Default: "agentmd" */
  agentmdPath?: string;
  /** Function that probes /health. */
  healthCheck: () => Promise<boolean>;
  /** Function that sends POST /shutdown. */
  shutdown: () => Promise<void>;
  /** Max time (ms) to wait for backend to come online after start. Default: 10000 */
  startTimeoutMs?: number;
  /** Interval (ms) between health polls after start. Default: 1000 */
  startPollMs?: number;
}

export interface StartResult {
  success: boolean;
  error?: string;
}

export class BackendLifecycle {
  private readonly agentmdPath: string;
  private readonly healthCheck: () => Promise<boolean>;
  private readonly shutdownFn: () => Promise<void>;
  private readonly startTimeoutMs: number;
  private readonly startPollMs: number;

  constructor(options: BackendLifecycleOptions) {
    this.agentmdPath = options.agentmdPath ?? "agentmd";
    this.healthCheck = options.healthCheck;
    this.shutdownFn = options.shutdown;
    this.startTimeoutMs = options.startTimeoutMs ?? 10000;
    this.startPollMs = options.startPollMs ?? 1000;
  }

  /**
   * Start the agentmd backend as a daemon.
   * Uses execFile (not exec) to avoid shell injection.
   * Executes `agentmdPath start -d`, then polls /health until it responds.
   */
  async start(): Promise<StartResult> {
    try {
      await this.execStart();
    } catch (err) {
      return {
        success: false,
        error: `Failed to run ${this.agentmdPath}: ${(err as Error).message}`,
      };
    }

    // Poll health until backend is ready
    const deadline = Date.now() + this.startTimeoutMs;
    while (Date.now() < deadline) {
      const alive = await this.healthCheck();
      if (alive) return { success: true };
      await this.sleep(this.startPollMs);
    }

    return {
      success: false,
      error: `Backend did not respond within ${this.startTimeoutMs / 1000}s`,
    };
  }

  /**
   * Stop the agentmd backend via API.
   * Returns true if shutdown was successful.
   */
  async stop(): Promise<boolean> {
    try {
      await this.shutdownFn();
      return true;
    } catch {
      return false;
    }
  }

  private execStart(): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile(this.agentmdPath, ["start", "-d"], (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/backend-lifecycle.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/backend-lifecycle.ts tests/backend-lifecycle.test.ts
git commit -m "feat: implement BackendLifecycle for start/stop backend from UI"
```

---

### Task 5: Add `agentmdPath` to settings

**Files:**
- Modify: `src/settings.ts`
- Modify: `src/settings-tab.ts`

- [ ] **Step 1: Add `agentmdPath` to settings interface and defaults**

In `src/settings.ts`, add to `AgentmdSettings` interface after `pollIntervalMs: number;`:

```ts
  /** Path to the agentmd executable (for starting the backend). */
  agentmdPath: string;
```

And in `DEFAULT_SETTINGS`, add after `pollIntervalMs: 15000,`:

```ts
  agentmdPath: "agentmd",
```

- [ ] **Step 2: Add the setting to the UI**

In `src/settings-tab.ts`, add after the health poll interval setting (before the closing `}` of `display()`):

```ts
    new Setting(containerEl)
      .setName("AgentMD executable")
      .setDesc(
        "Path to the agentmd CLI. Used for the 'Start backend' command. " +
        "If agentmd is in your PATH, the default works. Otherwise, set the full path " +
        "(e.g. /home/user/.local/bin/agentmd).",
      )
      .addText((text) =>
        text
          .setPlaceholder("agentmd")
          .setValue(this.plugin.settings.agentmdPath)
          .onChange(async (value) => {
            this.plugin.settings.agentmdPath = value || "agentmd";
            await this.plugin.saveSettings();
          }),
      );
```

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/settings.ts src/settings-tab.ts
git commit -m "feat: add agentmdPath setting for backend start command"
```

---

### Task 6: Refactor BackendMonitor to consume SSE state

**Files:**
- Modify: `src/backend-monitor.ts`
- Modify: `tests/backend-monitor.test.ts`

- [ ] **Step 1: Update tests**

Replace the entire contents of `tests/backend-monitor.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BackendMonitor } from "../src/backend-monitor";

function fakeClient(healthImpl: () => Promise<boolean>) {
  return { health: vi.fn(healthImpl) };
}

describe("BackendMonitor - SSE-driven mode", () => {
  it("starts as offline", () => {
    const client = fakeClient(async () => true);
    const monitor = new BackendMonitor({ client, intervalMs: 15000 });
    expect(monitor.online).toBe(false);
  });

  it("goes online when notifySSEConnected is called", () => {
    const client = fakeClient(async () => true);
    const monitor = new BackendMonitor({ client, intervalMs: 15000 });

    const states: boolean[] = [];
    monitor.subscribe((online) => states.push(online));

    monitor.notifySSEConnected();

    expect(monitor.online).toBe(true);
    expect(states).toEqual([true]);
  });

  it("goes offline when notifySSEDisconnected is called", () => {
    const client = fakeClient(async () => true);
    const monitor = new BackendMonitor({ client, intervalMs: 15000 });

    monitor.notifySSEConnected();
    expect(monitor.online).toBe(true);

    const states: boolean[] = [];
    monitor.subscribe((online) => states.push(online));

    monitor.notifySSEDisconnected();

    expect(monitor.online).toBe(false);
    expect(states).toEqual([false]);
  });

  it("reports mode as 'sse' when SSE is connected", () => {
    const client = fakeClient(async () => true);
    const monitor = new BackendMonitor({ client, intervalMs: 15000 });

    monitor.notifySSEConnected();
    expect(monitor.mode).toBe("sse");
  });

  it("reports mode as 'offline' when disconnected", () => {
    const client = fakeClient(async () => true);
    const monitor = new BackendMonitor({ client, intervalMs: 15000 });
    expect(monitor.mode).toBe("offline");
  });
});

describe("BackendMonitor - fallback polling mode", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("polls /health when activated via activateFallback()", async () => {
    const client = fakeClient(async () => true);
    const monitor = new BackendMonitor({ client, intervalMs: 15000 });

    monitor.activateFallback();
    expect(monitor.mode).toBe("fallback");

    // Immediate probe
    await vi.runOnlyPendingTimersAsync();
    expect(client.health).toHaveBeenCalledTimes(1);
    expect(monitor.online).toBe(true);

    // Next poll at intervalMs
    await vi.advanceTimersByTimeAsync(15000);
    expect(client.health).toHaveBeenCalledTimes(2);

    monitor.deactivateFallback();
  });

  it("deactivateFallback stops polling", async () => {
    const client = fakeClient(async () => true);
    const monitor = new BackendMonitor({ client, intervalMs: 15000 });

    monitor.activateFallback();
    await vi.runOnlyPendingTimersAsync();
    expect(client.health).toHaveBeenCalledTimes(1);

    monitor.deactivateFallback();
    await vi.advanceTimersByTimeAsync(60000);
    expect(client.health).toHaveBeenCalledTimes(1);
  });

  it("reports mode as 'fallback' during fallback polling", () => {
    const client = fakeClient(async () => true);
    const monitor = new BackendMonitor({ client, intervalMs: 15000 });

    monitor.activateFallback();
    expect(monitor.mode).toBe("fallback");
    monitor.deactivateFallback();
  });
});

describe("BackendMonitor - probeNow", () => {
  it("returns health check result", async () => {
    const client = fakeClient(async () => true);
    const monitor = new BackendMonitor({ client, intervalMs: 15000 });

    const result = await monitor.probeNow();
    expect(result).toBe(true);
    expect(client.health).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/backend-monitor.test.ts`
Expected: FAIL — `monitor.notifySSEConnected is not a function`

- [ ] **Step 3: Rewrite BackendMonitor**

Replace the entire contents of `src/backend-monitor.ts`:

```ts
export interface HealthProvider {
  health(): Promise<boolean>;
}

export interface BackendMonitorOptions {
  client: HealthProvider;
  /** Fallback poll interval in milliseconds. Default 15000. */
  intervalMs?: number;
}

export type OnlineListener = (online: boolean) => void;
export type ConnectionMode = "sse" | "fallback" | "offline";

export class BackendMonitor {
  private _online = false;
  private _mode: ConnectionMode = "offline";
  private readonly client: HealthProvider;
  private readonly intervalMs: number;
  private listeners = new Set<OnlineListener>();
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private fallbackRunning = false;

  constructor(options: BackendMonitorOptions) {
    this.client = options.client;
    this.intervalMs = options.intervalMs ?? 15000;
  }

  get online(): boolean {
    return this._online;
  }

  get mode(): ConnectionMode {
    return this._mode;
  }

  subscribe(listener: OnlineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Called by GlobalSSEConnection when SSE connects. */
  notifySSEConnected(): void {
    this._mode = "sse";
    this.setOnline(true);
  }

  /** Called by GlobalSSEConnection when SSE disconnects (before fallback). */
  notifySSEDisconnected(): void {
    if (this._mode === "sse") {
      this._mode = "offline";
    }
    this.setOnline(false);
  }

  /** Activate fallback polling mode (called when SSE reconnection exhausted). */
  activateFallback(): void {
    if (this.fallbackRunning) return;
    this._mode = "fallback";
    this.fallbackRunning = true;
    this.fallbackTimer = setTimeout(() => {
      void this.fallbackTick();
    }, 0);
  }

  /** Deactivate fallback polling (called when SSE reconnects). */
  deactivateFallback(): void {
    this.fallbackRunning = false;
    if (this.fallbackTimer != null) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
  }

  /** Fire a single health probe (used by BackendLifecycle after start). */
  async probeNow(): Promise<boolean> {
    return this.client.health();
  }

  /** Stop everything (called on plugin unload). */
  stop(): void {
    this.deactivateFallback();
  }

  private async fallbackTick(): Promise<void> {
    if (!this.fallbackRunning) return;

    const alive = await this.client.health();
    if (alive) {
      this.setOnline(true);
    } else {
      this.setOnline(false);
    }

    if (!this.fallbackRunning) return;
    this.fallbackTimer = setTimeout(() => {
      void this.fallbackTick();
    }, this.intervalMs);
  }

  private setOnline(next: boolean): void {
    if (this._online === next) return;
    this._online = next;
    for (const listener of this.listeners) {
      listener(next);
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/backend-monitor.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/backend-monitor.ts tests/backend-monitor.test.ts
git commit -m "refactor: BackendMonitor driven by SSE state with fallback polling"
```

---

### Task 7: Simplify LiveView

**Files:**
- Modify: `src/views/live-view.ts`

- [ ] **Step 1: Rewrite LiveView**

Replace the entire contents of `src/views/live-view.ts`:

```ts
import { ItemView, WorkspaceLeaf } from "obsidian";
import type { EventStore, RunningExecution } from "../store/event-store";
import { VIEW_TYPE_LIVE } from "./constants";
import { formatDuration, formatTokens, formatCost } from "../ui/format";

export interface LiveViewActions {
  onOpenExecution: (executionId: number) => void;
  onCancelExecution: (executionId: number) => void;
  onStartBackend: () => void;
  isOnline: () => boolean;
  onOnlineChanged: (listener: () => void) => () => void;
}

export class LiveView extends ItemView {
  private store: EventStore;
  private actions: LiveViewActions;
  private unsubRunning: (() => void) | null = null;
  private unsubOnline: (() => void) | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  constructor(leaf: WorkspaceLeaf, store: EventStore, actions: LiveViewActions) {
    super(leaf);
    this.store = store;
    this.actions = actions;
  }

  getViewType(): string { return VIEW_TYPE_LIVE; }
  getDisplayText(): string { return "Live"; }
  getIcon(): string { return "activity"; }

  async onOpen(): Promise<void> {
    this.unsubRunning = this.store.onRunningChanged(() => this.render());
    this.unsubOnline = this.actions.onOnlineChanged(() => this.render());
    this.render();
  }

  async onClose(): Promise<void> {
    this.unsubRunning?.();
    this.unsubOnline?.();
    this.stopTick();
  }

  private startTick(): void {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => this.render(), 1000);
  }

  private stopTick(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();

    if (!this.actions.isOnline()) {
      this.stopTick();
      this.renderOffline(container);
      return;
    }

    // Header
    const header = container.createDiv({ cls: "agentmd-view-header" });
    const left = header.createDiv({ cls: "agentmd-header-left" });
    left.createSpan({ cls: "agentmd-view-icon", text: "◆" });
    left.createSpan({ cls: "agentmd-header-title", text: "Live" });
    const runningCount = this.store.running.size;
    if (runningCount > 0) {
      left.createSpan({ cls: "agentmd-header-badge", text: String(runningCount) });
    }

    if (runningCount === 0) {
      this.stopTick();
      container.createDiv({
        cls: "agentmd-empty",
        text: "No running executions. Click ▶ on an agent to start one.",
      });
      return;
    }

    // Start tick for elapsed time updates
    this.startTick();

    for (const [, exec] of this.store.running) {
      this.renderCard(container, exec);
    }
  }

  private renderCard(container: HTMLElement, exec: RunningExecution): void {
    const card = container.createDiv({ cls: "agentmd-live-card" });
    card.addEventListener("click", () => this.actions.onOpenExecution(exec.id));

    // Row 1: dot + name + #id + trigger + cancel
    const headerEl = card.createDiv({ cls: "live-header" });
    headerEl.createSpan({ cls: "live-dot", text: "●" });
    headerEl.createSpan({ cls: "live-name", text: exec.agent });
    headerEl.createSpan({ cls: "live-id", text: `#${exec.id}` });

    const trigger = exec.triggerSource;
    const triggerCls =
      trigger === "scheduler" || trigger === "schedule" ? "agentmd-trigger-scheduler" :
      trigger === "watch" ? "agentmd-trigger-watch" :
      "agentmd-trigger-manual";
    headerEl.createSpan({ cls: `live-trigger ${triggerCls}`, text: `· ${trigger}` });

    const cancel = headerEl.createSpan({ cls: "live-cancel", text: "■" });
    cancel.title = "Stop execution";
    cancel.addEventListener("click", (e) => {
      e.stopPropagation();
      cancel.setText("…");
      cancel.style.pointerEvents = "none";
      this.actions.onCancelExecution(exec.id);
    });

    // Row 2: elapsed time
    const elapsed = Math.round((Date.now() - exec.startedAt) / 1000);
    const stats = card.createDiv({ cls: "live-stats" });
    stats.createSpan({ text: formatDuration(elapsed) });
    if (exec.tokensTotal > 0) {
      stats.createSpan({ text: formatTokens(exec.tokensTotal) });
    }
    if (exec.costUsd > 0) {
      stats.createSpan({ text: formatCost(exec.costUsd) });
    }
  }

  private renderOffline(container: HTMLElement): void {
    const wrapper = container.createDiv({ cls: "agentmd-offline-state" });
    wrapper.createDiv({ cls: "agentmd-offline-icon", text: "⚠" });
    wrapper.createDiv({ cls: "agentmd-offline-title", text: "Backend offline" });
    const startBtn = wrapper.createEl("button", {
      cls: "agentmd-btn primary agentmd-offline-start-btn",
      text: "▶ Start AgentMD",
    });
    startBtn.addEventListener("click", () => {
      startBtn.setText("Starting…");
      startBtn.disabled = true;
      this.actions.onStartBackend();
    });
  }
}
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: errors in `main.ts` (LiveView constructor changed) — these will be fixed in Task 10

- [ ] **Step 3: Commit**

```bash
git add src/views/live-view.ts
git commit -m "refactor: LiveView uses store instead of polling, adds start button"
```

---

### Task 8: Add start button to offline states in AgentsView and ExecutionsView

**Files:**
- Modify: `src/views/agents-view.ts`
- Modify: `src/views/executions-view.ts`

- [ ] **Step 1: Update AgentsView**

In `src/views/agents-view.ts`, update the `AgentsViewActions` interface — add after `onOnlineChanged`:

```ts
  onStartBackend: () => void;
```

Replace the `renderOffline` method (lines 134-143):

```ts
  private renderOffline(container: HTMLElement): void {
    const wrapper = container.createDiv({ cls: "agentmd-offline-state" });
    wrapper.createDiv({ cls: "agentmd-offline-icon", text: "⚠" });
    wrapper.createDiv({ cls: "agentmd-offline-title", text: "Backend offline" });
    const startBtn = wrapper.createEl("button", {
      cls: "agentmd-btn primary agentmd-offline-start-btn",
      text: "▶ Start AgentMD",
    });
    startBtn.addEventListener("click", () => {
      startBtn.setText("Starting…");
      startBtn.disabled = true;
      this.actions.onStartBackend();
    });
  }
```

- [ ] **Step 2: Update ExecutionsView**

In `src/views/executions-view.ts`, update the `ExecutionsViewActions` interface — add after `onOnlineChanged`:

```ts
  onStartBackend: () => void;
```

Replace the `renderOffline` method (lines 235-244):

```ts
  private renderOffline(container: HTMLElement): void {
    const wrapper = container.createDiv({ cls: "agentmd-offline-state" });
    wrapper.createDiv({ cls: "agentmd-offline-icon", text: "⚠" });
    wrapper.createDiv({ cls: "agentmd-offline-title", text: "Backend offline" });
    const startBtn = wrapper.createEl("button", {
      cls: "agentmd-btn primary agentmd-offline-start-btn",
      text: "▶ Start AgentMD",
    });
    startBtn.addEventListener("click", () => {
      startBtn.setText("Starting…");
      startBtn.disabled = true;
      this.actions.onStartBackend();
    });
  }
```

- [ ] **Step 3: Commit**

```bash
git add src/views/agents-view.ts src/views/executions-view.ts
git commit -m "feat: add start backend button to offline states in all sidebar views"
```

---

### Task 9: Update styles — status bar fallback state + offline start button

**Files:**
- Modify: `styles.css`

- [ ] **Step 1: Update status bar styles**

In `styles.css`, replace the status bar section (lines 17-35) with:

```css
/* ---------- Status bar ---------- */
.agentmd-status-bar {
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.agentmd-status-dot {
  margin-right: 4px;
}
.agentmd-status-online .agentmd-status-dot {
  animation: agentmd-pulse 2s ease-in-out infinite;
}
.agentmd-status-fallback .agentmd-status-dot {
  animation: none;
}
@keyframes agentmd-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
.agentmd-status-bar.agentmd-status-online {
  color: #10b981;
}
.agentmd-status-bar.agentmd-status-fallback {
  color: #f59e0b;
}
.agentmd-status-bar.agentmd-status-offline {
  color: var(--text-faint);
}
```

- [ ] **Step 2: Add start button style**

At the end of the offline state section (after `.agentmd-offline-cmd code { ... }`, around line 636), add:

```css
.agentmd-offline-start-btn {
  margin-top: 12px;
  padding: 6px 16px;
  font-size: var(--font-ui-small);
}
```

- [ ] **Step 3: Commit**

```bash
git add styles.css
git commit -m "style: add status bar fallback state and offline start button"
```

---

### Task 10: Rewire main.ts — integrate GlobalSSE, Lifecycle, remove timers

**Files:**
- Modify: `main.ts`

This is the integration task. All previous modules come together here.

- [ ] **Step 1: Rewrite main.ts**

Replace the entire contents of `main.ts`:

```ts
import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { AgentmdClient } from "./src/client/agentmd-client";
import { GlobalSSEConnection } from "./src/client/global-sse";
import { BackendMonitor } from "./src/backend-monitor";
import { BackendLifecycle } from "./src/backend-lifecycle";
import { EventStore } from "./src/store/event-store";
import { AgentsView } from "./src/views/agents-view";
import { LiveView } from "./src/views/live-view";
import { ExecutionDetailView } from "./src/views/execution-detail-view";
import { ExecutionsView } from "./src/views/executions-view";
import { AgentDetailView } from "./src/views/agent-detail-view";
import { AgentmdSettingTab } from "./src/settings-tab";
import { VIEW_TYPE_AGENTS, VIEW_TYPE_LIVE, VIEW_TYPE_EXEC_DETAIL, VIEW_TYPE_EXECUTIONS, VIEW_TYPE_AGENT_DETAIL } from "./src/views/constants";
import { DEFAULT_SETTINGS, type AgentmdSettings } from "./src/settings";
import type { ExecutionSummary, GlobalSSEExecutionStarted, GlobalSSEExecutionCompleted, GlobalSSESchedulerChanged } from "./src/types";

export default class AgentmdPlugin extends Plugin {
  private client!: AgentmdClient;
  private monitor!: BackendMonitor;
  private globalSSE!: GlobalSSEConnection;
  private lifecycle!: BackendLifecycle;
  private store!: EventStore;
  settings!: AgentmdSettings;
  private statusBarEl!: HTMLElement;
  private unsubMonitor: (() => void) | null = null;
  /** Map of execution ID -> SSE close function */
  private sseConnections = new Map<number, () => void>();

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    this.client = new AgentmdClient({ socketPath: this.settings.socketPath });
    this.store = new EventStore();

    // Backend monitor (SSE-driven, with fallback polling)
    this.monitor = new BackendMonitor({
      client: this.client,
      intervalMs: this.settings.pollIntervalMs,
    });

    // Backend lifecycle (start/stop)
    this.lifecycle = new BackendLifecycle({
      agentmdPath: this.settings.agentmdPath,
      healthCheck: () => this.client.health(),
      shutdown: () => this.client.shutdown(),
    });

    // Global SSE connection
    this.globalSSE = new GlobalSSEConnection({
      socketPath: this.settings.socketPath,
      onEvent: (type, data) => this.handleGlobalSSEEvent(type, data),
      onStateChanged: (state) => this.handleSSEStateChanged(state),
    });

    // Status bar
    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass("agentmd-status-bar");
    this.renderStatusBar();
    this.unsubMonitor = this.monitor.subscribe(() => this.renderStatusBar());

    // Status bar click -> start or stop
    this.statusBarEl.addEventListener("click", () => {
      if (this.monitor.online) {
        void this.stopBackend();
      } else {
        void this.startBackend();
      }
    });

    // Register views
    this.registerView(VIEW_TYPE_AGENTS, (leaf) =>
      new AgentsView(leaf, this.store, {
        onRunAgent: (name, withFile) => this.runAgent(name, withFile),
        onRefreshAgents: () => void this.refreshAgents(),
        getCurrentFilePath: () => this.getCurrentFilePath(),
        onOpenAgentDetail: (name) => this.openAgentDetail(name),
        isOnline: () => this.monitor.online,
        onOnlineChanged: (cb) => this.monitor.subscribe(() => cb()),
        onStartBackend: () => void this.startBackend(),
      }),
    );
    this.registerView(VIEW_TYPE_LIVE, (leaf) =>
      new LiveView(leaf, this.store, {
        onOpenExecution: (id) => this.openExecutionDetail(id),
        onCancelExecution: (id) => this.cancelExecution(id),
        onStartBackend: () => void this.startBackend(),
        isOnline: () => this.monitor.online,
        onOnlineChanged: (cb) => this.monitor.subscribe(() => cb()),
      }),
    );
    this.registerView(VIEW_TYPE_EXEC_DETAIL, (leaf) =>
      new ExecutionDetailView(leaf, this.store, {
        onCancel: (id) => this.cancelExecution(id),
        onRerun: (name) => this.runAgent(name, false),
        fetchExecution: async (id) => {
          try {
            return await this.client.getExecution(id);
          } catch {
            return null;
          }
        },
        fetchExecutionMessages: (id) => this.client.getExecutionMessages(id),
      }),
    );
    this.registerView(VIEW_TYPE_EXECUTIONS, (leaf) =>
      new ExecutionsView(leaf, this.store, {
        onOpenExecution: (id) => this.openExecutionDetail(id),
        onRefreshExecutions: () => {},
        getExecutions: (params) => this.client.listExecutions(params),
        isOnline: () => this.monitor.online,
        onOnlineChanged: (cb) => this.monitor.subscribe(() => cb()),
        onStartBackend: () => void this.startBackend(),
      }),
    );
    this.registerView(VIEW_TYPE_AGENT_DETAIL, (leaf) =>
      new AgentDetailView(leaf, this.store, {
        onRunAgent: (name, withFile) => this.runAgent(name, withFile),
        onOpenSourceFile: (name) => this.openSourceFile(name),
        onOpenExecution: (id) => this.openExecutionDetail(id),
        onOpenExecutions: (name) => this.openExecutionsForAgent(name),
        getCurrentFilePath: () => this.getCurrentFilePath(),
        fetchAgentDetail: (name) => this.client.getAgent(name),
        fetchAgentRuns: (name, limit) => this.client.getAgentRuns(name, limit),
      }),
    );

    // Commands
    this.addCommand({
      id: "open-agents",
      name: "Open Agents panel",
      callback: () => this.activateView(VIEW_TYPE_AGENTS),
    });
    this.addCommand({
      id: "open-live",
      name: "Open Live panel",
      callback: () => this.activateView(VIEW_TYPE_LIVE),
    });
    this.addCommand({
      id: "run-with-file",
      name: "Run current file through agent…",
      callback: () => this.promptRunWithFile(),
    });
    this.addCommand({
      id: "open-executions",
      name: "Open Executions panel",
      callback: () => this.activateView(VIEW_TYPE_EXECUTIONS),
    });
    this.addCommand({
      id: "pause-scheduler",
      name: "Pause scheduler",
      callback: async () => {
        try { await this.client.pauseScheduler(); new Notice("Scheduler paused"); }
        catch { new Notice("Failed to pause scheduler"); }
      },
    });
    this.addCommand({
      id: "resume-scheduler",
      name: "Resume scheduler",
      callback: async () => {
        try { await this.client.resumeScheduler(); new Notice("Scheduler resumed"); }
        catch { new Notice("Failed to resume scheduler"); }
      },
    });
    this.addCommand({
      id: "start-backend",
      name: "Start backend",
      callback: () => void this.startBackend(),
    });
    this.addCommand({
      id: "stop-backend",
      name: "Stop backend",
      callback: () => void this.stopBackend(),
    });

    // Settings tab
    this.addSettingTab(new AgentmdSettingTab(this.app, this));

    // Ribbon icon
    this.addRibbonIcon("bot", "AgentMD", () => {
      this.activateView(VIEW_TYPE_AGENTS);
    });

    // Default layout on first install
    if (!this.app.workspace.getLeavesOfType(VIEW_TYPE_AGENTS).length) {
      this.app.workspace.onLayoutReady(() => {
        void this.activateView(VIEW_TYPE_AGENTS);
        void this.activateView(VIEW_TYPE_LIVE);
        void this.activateView(VIEW_TYPE_EXECUTIONS);
      });
    }

    // Start global SSE connection
    this.globalSSE.start();
  }

  onunload(): void {
    this.globalSSE?.stop();
    this.monitor?.stop();
    this.unsubMonitor?.();
    for (const close of this.sseConnections.values()) close();
    this.sseConnections.clear();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  // ---- Global SSE event handling ----

  private handleGlobalSSEEvent(type: string, data: Record<string, unknown>): void {
    if (type === "heartbeat") {
      // Heartbeat just keeps connection alive - state is managed by onStateChanged
      return;
    }

    if (type === "execution_started") {
      const evt = data as unknown as GlobalSSEExecutionStarted;
      if (!this.store.running.has(evt.execution_id) && !this.sseConnections.has(evt.execution_id)) {
        this.store.startExecution(evt.execution_id, evt.agent_name, evt.trigger);
        this.subscribeToExecution(evt.execution_id);
      }
      return;
    }

    if (type === "execution_completed") {
      const evt = data as unknown as GlobalSSEExecutionCompleted;
      if (this.store.running.has(evt.execution_id)) {
        const running = this.store.running.get(evt.execution_id)!;
        const summary: ExecutionSummary = {
          id: evt.execution_id,
          agent_id: evt.agent_name,
          status: evt.status,
          trigger: running.triggerSource,
          started_at: new Date(running.startedAt).toISOString(),
          duration_ms: evt.duration_ms,
        };
        this.store.completeExecution(evt.execution_id, summary);
        this.sseConnections.get(evt.execution_id)?.();
        this.sseConnections.delete(evt.execution_id);
        this.notifyCompletion(summary);
      }
      return;
    }

    if (type === "agents_changed") {
      void this.refreshAgents();
      return;
    }

    if (type === "scheduler_changed") {
      const evt = data as unknown as GlobalSSESchedulerChanged;
      new Notice(`Scheduler ${evt.status}`);
      return;
    }
  }

  private handleSSEStateChanged(state: string): void {
    if (state === "connected") {
      this.monitor.deactivateFallback();
      this.monitor.notifySSEConnected();
      // Sync state on (re)connect
      void this.syncOnReconnect();
    } else if (state === "fallback") {
      this.monitor.notifySSEDisconnected();
      this.monitor.activateFallback();
    } else if (state === "reconnecting") {
      // Still trying - keep current online state for now
    } else if (state === "offline") {
      this.monitor.notifySSEDisconnected();
    }
  }

  private async syncOnReconnect(): Promise<void> {
    try {
      // Sync agents
      const agents = await this.client.listAgents();
      this.store.setAgents(agents);

      // Sync running executions
      const running = await this.client.listExecutions({ status: "running" });
      const newIds = this.store.syncRunning(running);
      for (const id of newIds) {
        if (!this.sseConnections.has(id)) {
          this.subscribeToExecution(id);
        }
      }
    } catch {
      // Backend may not be fully ready - will sync on next event
    }
  }

  // ---- Backend lifecycle ----

  private async startBackend(): Promise<void> {
    new Notice("Starting AgentMD…");
    const result = await this.lifecycle.start();
    if (result.success) {
      new Notice("AgentMD started");
      // SSE will connect automatically via reconnection
      this.globalSSE.reconnectNow();
    } else {
      new Notice(`Failed to start AgentMD: ${result.error}`);
    }
  }

  private async stopBackend(): Promise<void> {
    const stopped = await this.lifecycle.stop();
    if (stopped) {
      this.globalSSE.stop();
      this.monitor.notifySSEDisconnected();
      new Notice("AgentMD stopped");
      // Restart SSE so it will reconnect when backend comes back
      this.globalSSE.start();
    } else {
      new Notice("Failed to stop AgentMD");
    }
  }

  // ---- Actions ----

  private async runAgent(name: string, withCurrentFile: boolean): Promise<void> {
    if (!this.monitor.online) {
      new Notice("AgentMD backend is offline.");
      return;
    }
    const args: string[] = [];
    if (withCurrentFile) {
      const filePath = this.getCurrentFilePath();
      if (!filePath) {
        new Notice("No file is currently open.");
        return;
      }
      const vaultPath = (this.app.vault.adapter as any).basePath as string;
      args.push(`${vaultPath}/${filePath}`);
    }
    try {
      const { execution_id } = await this.client.runAgent(name, args.length > 0 ? { args } : undefined);
      this.store.startExecution(execution_id, name, "manual");
      this.subscribeToExecution(execution_id);
      if (this.settings.autoOpenOnRun) {
        await this.openExecutionDetail(execution_id);
      }
    } catch (err) {
      new Notice(`Failed to run ${name}: ${(err as Error).message}`);
    }
  }

  private async cancelExecution(id: number): Promise<void> {
    try {
      await this.client.cancelExecution(id);
    } catch {
      // May already be finished
    }
  }

  private subscribeToExecution(executionId: number): void {
    const close = this.client.openSSE(
      `/executions/${executionId}/stream`,
      (event) => {
        this.store.pushEvent(executionId, event);
        if (event.type === "complete") {
          const summary: ExecutionSummary = {
            id: executionId,
            agent_id: this.store.running.get(executionId)?.agent ?? "unknown",
            status: event.data.status === "success" ? "success" :
                    event.data.status === "error" ? "failed" : "aborted",
            trigger: this.store.running.get(executionId)?.triggerSource ?? "manual",
            started_at: new Date(this.store.running.get(executionId)?.startedAt ?? Date.now()).toISOString(),
            duration_ms: event.data.duration_ms,
            total_tokens: event.data.total_tokens,
            cost_usd: event.data.cost_usd,
            error: event.data.error,
          };
          this.store.completeExecution(executionId, summary);
          this.sseConnections.delete(executionId);
          this.notifyCompletion(summary);
        }
      },
      (err) => {
        console.error(`SSE error for execution ${executionId}:`, err);
      },
      () => {
        this.sseConnections.delete(executionId);
      },
    );
    this.sseConnections.set(executionId, close);
  }

  private notifyCompletion(summary: ExecutionSummary): void {
    if (this.settings.notifications === "off") return;
    if (this.settings.notifications === "failures" && summary.status === "success") return;

    const icon = summary.status === "success" ? "✓" : "✗";
    const durationSec = summary.duration_ms != null ? Math.round(summary.duration_ms / 1000) : null;
    const duration = durationSec != null ? `${durationSec}s` : "";
    const cost = summary.cost_usd != null ? `$${summary.cost_usd.toFixed(3)}` : "";
    new Notice(`${icon} ${summary.agent_id} ${summary.status} · ${duration} · ${cost}`);
  }

  // ---- Data ----

  private async refreshAgents(): Promise<void> {
    try {
      const agents = await this.client.listAgents();
      this.store.setAgents(agents);
    } catch {
      // Offline
    }
  }

  // ---- View management ----

  private async openExecutionDetail(executionId: number): Promise<void> {
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_EXEC_DETAIL, active: true });
    const view = leaf.view as ExecutionDetailView;
    view.setExecutionId(executionId);
  }

  private async openAgentDetail(name: string): Promise<void> {
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_AGENT_DETAIL, active: true });
    const view = leaf.view as AgentDetailView;
    await view.setAgent(name);
  }

  private openSourceFile(agentName: string): void {
    const filePath = `${this.settings.agentsDir}/${agentName}.md`;
    const vaultPath = (this.app.vault.adapter as any).basePath as string;
    if (filePath.startsWith(vaultPath)) {
      const relative = filePath.slice(vaultPath.length + 1);
      const file = this.app.vault.getAbstractFileByPath(relative);
      if (file) {
        void this.app.workspace.getLeaf("tab").openFile(file as any);
        return;
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { shell } = require("electron") as { shell: { showItemInFolder: (path: string) => void } };
    shell.showItemInFolder(filePath);
    new Notice(`Source file revealed in file manager: ${agentName}.md`);
  }

  private async openExecutionsForAgent(agentName: string): Promise<void> {
    await this.activateView(VIEW_TYPE_EXECUTIONS);
  }

  private async activateView(viewType: string): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(viewType);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: viewType, active: true });
    }
  }

  private async promptRunWithFile(): Promise<void> {
    const filePath = this.getCurrentFilePath();
    if (!filePath) {
      new Notice("No file is currently open.");
      return;
    }
    if (this.store.agents.length === 0) {
      new Notice("No agents available.");
      return;
    }
    new Notice(`Use the Agents panel to run an agent with ${filePath.split("/").pop()}`);
    await this.activateView(VIEW_TYPE_AGENTS);
  }

  private getCurrentFilePath(): string | null {
    const file = this.app.workspace.getActiveFile();
    return file?.path ?? null;
  }

  // ---- Status bar ----

  private renderStatusBar(): void {
    this.statusBarEl.empty();
    const dot = this.statusBarEl.createSpan({ cls: "agentmd-status-dot" });
    const label = this.statusBarEl.createSpan();
    label.setText("AgentMD");

    const mode = this.monitor.mode;
    const online = this.monitor.online;

    if (mode === "sse" && online) {
      dot.setText("●");
      this.statusBarEl.removeClass("agentmd-status-offline", "agentmd-status-fallback");
      this.statusBarEl.addClass("agentmd-status-online");
    } else if (mode === "fallback" && online) {
      dot.setText("●");
      this.statusBarEl.removeClass("agentmd-status-offline", "agentmd-status-online");
      this.statusBarEl.addClass("agentmd-status-fallback");
    } else {
      dot.setText("○");
      this.statusBarEl.removeClass("agentmd-status-online", "agentmd-status-fallback");
      this.statusBarEl.addClass("agentmd-status-offline");
    }
  }
}
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: no errors

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add main.ts
git commit -m "feat: integrate GlobalSSE + BackendLifecycle, remove all polling timers"
```

---

### Task 11: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README**

Apply these changes to `README.md`:

1. In the feature bullet list (lines 21-27), add after the status bar line:
```markdown
- **Start/Stop backend** — start or stop agentmd from the command palette or status bar
- **Real-time SSE** — global event stream replaces polling for instant updates
```

2. In the Commands table (lines 100-107), add two rows:
```markdown
| `Start backend` | Start the agentmd daemon |
| `Stop backend` | Gracefully stop the agentmd backend |
```

3. In the Settings table (lines 111-117), add a row after Poll interval:
```markdown
| AgentMD executable | `agentmd` | Path to the agentmd CLI for start command |
```

4. Update the Poll interval description:
```markdown
| Poll interval | 15s | Fallback polling interval when SSE is unavailable (10-120s) |
```

5. Replace the Architecture ASCII diagram (lines 132-143):
```
┌──────────────────────────────────────┐
│           Obsidian Plugin            │
│                                      │
│  GlobalSSEConnection ─ /events/stream ─ agentmd backend
│    ├─ heartbeat → online status      │
│    ├─ execution_* → EventStore       │
│    ├─ agents_changed → refresh       │
│    └─ scheduler_changed → notify     │
│                                      │
│  Per-execution SSE (detail view)     │
│    └─ /executions/{id}/stream        │
│                                      │
│  BackendLifecycle                    │
│    ├─ start → execFile agentmd       │
│    └─ stop → POST /shutdown          │
│                                      │
│  BackendMonitor (SSE + fallback)     │
│  Status Bar (● AgentMD)              │
└──────────────────────────────────────┘
```

6. Replace the Transport bullet (line 146):
```markdown
- **Transport**: Unix domain socket + SSE (global event stream for real-time, per-execution for streaming logs)
```

7. Update the status bar description (line 27 area):
```markdown
- **Status bar** — green pulsing dot = SSE connected, amber = polling fallback, gray = offline. Click to start/stop.
```

8. Add a Troubleshooting section before Roadmap (before line 196):
```markdown
## Troubleshooting

### Start button doesn't work

The plugin runs `agentmd start -d` to launch the backend. If the `agentmd` command isn't in Obsidian's PATH:

1. Find where agentmd is installed: `which agentmd`
2. In Obsidian: **Settings → AgentMD → AgentMD executable**
3. Set the full path (e.g., `/home/user/.local/bin/agentmd` or `/opt/homebrew/bin/agentmd`)

### Status bar shows amber instead of green

Amber means the plugin is connected via polling fallback instead of the real-time SSE stream. This can happen if:
- The backend version is older than v0.11.0 (SSE global not available)
- The SSE connection was interrupted and hasn't recovered yet

The plugin will keep trying to reconnect to SSE automatically.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README with SSE, start/stop, and troubleshooting"
```

---

### Task 12: Build and smoke test

**Files:** none (manual verification)

- [ ] **Step 1: Build the plugin**

Run: `npm run build`
Expected: build succeeds with no errors

- [ ] **Step 2: Run all tests**

Run: `npm test`
Expected: all tests pass

- [ ] **Step 3: Manual smoke test in Obsidian**

1. Copy `main.js`, `manifest.json`, `styles.css` to vault plugin folder
2. Reload Obsidian
3. Verify ribbon icon is a robot (not CPU)
4. Verify status bar shows `○ AgentMD` in gray (backend offline)
5. Click status bar → should attempt to start backend
6. If agentmd is installed: verify `● AgentMD` turns green with pulse
7. Run an agent → verify LiveView updates without polling (instant)
8. Kill the backend manually → verify status bar goes gray, views show "Start AgentMD" button
9. Click "Start AgentMD" button → verify backend starts and status turns green

- [ ] **Step 4: Commit any fixes from smoke test**

```bash
git add -A
git commit -m "fix: smoke test fixes"
```
