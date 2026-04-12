# Plan 2 · Core Run Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the full "click ▶ and watch it stream" flow — from clicking Run on an agent card, through SSE event streaming, to a completed execution log. Add the three sidebar/main-area views (Agents, Live, Execution Detail) and the ribbon icon.

**Architecture:** `EventStore` is the central reactive state holder. Views observe it and re-render on changes. `AgentmdClient` gains SSE streaming via a push-based `openSSE()` method. Views are vanilla DOM `ItemView` subclasses — no UI framework. Settings are persisted via Obsidian's `loadData`/`saveData`. The plugin instance acts as the composition root, owning all singletons and passing them to views via closures.

**Tech Stack:** TypeScript 5, Obsidian plugin API (`ItemView`, `WorkspaceLeaf`, `Notice`, `Plugin`), Node `http` module for SSE transport, Vitest for unit tests (SSE parser + EventStore).

**Reference spec:** `docs/superpowers/specs/2026-04-11-agentmd-obsidian-plugin-design.md`

**Builds on:** Plan 1 (foundation) — `AgentmdClient`, `BackendMonitor`, `main.ts` plugin entry, `src/types.ts`

---

## File map

```
src/
  types.ts                          ← MODIFY: add SSE event types, RunRequest
  client/
    agentmd-client.ts               ← MODIFY: add runAgent, cancelExecution, listExecutions, openSSE
    sse-parser.ts                   ← CREATE: SSE text stream → typed events
  store/
    event-store.ts                  ← CREATE: reactive state (agents, running, history)
  settings.ts                      ← CREATE: settings interface + defaults + load/save
  views/
    constants.ts                   ← CREATE: VIEW_TYPE_* constants
    agents-view.ts                  ← CREATE: sidebar ItemView (agent list)
    live-view.ts                    ← CREATE: sidebar ItemView (running executions)
    execution-detail-view.ts        ← CREATE: main-area ItemView (stream or log)
  ui/
    format.ts                       ← CREATE: relative time, token count, cost formatting
main.ts                             ← MODIFY: register views, commands, ribbon, EventStore, settings
styles.css                          ← MODIFY: full color system + view styles
tests/
  client/
    sse-parser.test.ts              ← CREATE
    agentmd-client.test.ts          ← MODIFY: tests for new methods
  store/
    event-store.test.ts             ← CREATE
```

---

## Task 1: SSE types and parser module

**Files:**
- Modify: `src/types.ts`
- Create: `src/client/sse-parser.ts`
- Create: `tests/client/sse-parser.test.ts`

The SSE parser consumes raw text chunks from an HTTP response and yields typed event objects. It handles the standard SSE wire format (`event:`, `id:`, `data:` fields separated by blank lines) and JSON-parses the data field.

- [ ] **Step 1: Add SSE event types to `src/types.ts`**

Append to the end of `src/types.ts`:

```typescript
// ---------- SSE events ----------

export interface SSEToolCall {
  name: string;
  args: string;
}

export interface SSEEventData {
  event_type?: string;
  agent_name?: string;
  content?: string;
  tools?: SSEToolCall[];
  tool_name?: string;
  /** Only on complete events */
  status?: string;
  duration_ms?: number;
  total_tokens?: number;
  cost_usd?: number;
  error?: string;
}

export interface ParsedSSEEvent {
  /** SSE event type: message, ai, tool_call, tool_result, meta, final_answer, complete */
  type: string;
  /** Sequence ID from backend — used for dedup on reconnect */
  id: string;
  /** Parsed JSON payload */
  data: SSEEventData;
}

// ---------- Run request ----------

export interface RunRequest {
  args?: string[];
  message?: string;
}
```

- [ ] **Step 2: Write failing tests for SSE parser**

Create `tests/client/sse-parser.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { SSEParser } from "../../src/client/sse-parser";

describe("SSEParser", () => {
  it("parses a complete single event", () => {
    const parser = new SSEParser();
    const events = parser.push(
      'event: tool_call\nid: 5\ndata: {"event_type":"tool_call","tools":[{"name":"file_read","args":"{}"}]}\n\n',
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("tool_call");
    expect(events[0].id).toBe("5");
    expect(events[0].data.tools).toHaveLength(1);
    expect(events[0].data.tools![0].name).toBe("file_read");
  });

  it("buffers incomplete chunks and yields when complete", () => {
    const parser = new SSEParser();
    // First chunk: incomplete event
    const events1 = parser.push("event: ai\nid: 10\n");
    expect(events1).toHaveLength(0);
    // Second chunk: completes the event
    const events2 = parser.push('data: {"content":"hello"}\n\n');
    expect(events2).toHaveLength(1);
    expect(events2[0].type).toBe("ai");
    expect(events2[0].data.content).toBe("hello");
  });

  it("parses multiple events from one chunk", () => {
    const parser = new SSEParser();
    const chunk =
      'event: tool_call\nid: 1\ndata: {"tools":[{"name":"a","args":""}]}\n\n' +
      'event: tool_result\nid: 2\ndata: {"tool_name":"a","content":"ok"}\n\n';
    const events = parser.push(chunk);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("tool_call");
    expect(events[1].type).toBe("tool_result");
  });

  it("defaults type to 'message' when event: field is missing", () => {
    const parser = new SSEParser();
    const events = parser.push('id: 1\ndata: {"content":"x"}\n\n');
    expect(events[0].type).toBe("message");
  });

  it("skips events with no data field", () => {
    const parser = new SSEParser();
    const events = parser.push("event: heartbeat\nid: 99\n\n");
    expect(events).toHaveLength(0);
  });

  it("parses a complete event from the agentmd backend", () => {
    const parser = new SSEParser();
    const events = parser.push(
      'event: complete\nid: 9223372036854775807\ndata: {"status":"success","duration_ms":1234,"total_tokens":5000,"cost_usd":0.015}\n\n',
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("complete");
    expect(events[0].data.status).toBe("success");
    expect(events[0].data.duration_ms).toBe(1234);
    expect(events[0].data.cost_usd).toBe(0.015);
  });
});
```

- [ ] **Step 3: Run tests — verify failure**

```bash
npx vitest run tests/client/sse-parser.test.ts
```

Expected: FAIL — cannot resolve `../../src/client/sse-parser`.

- [ ] **Step 4: Implement SSE parser**

Create `src/client/sse-parser.ts`:

```typescript
import type { ParsedSSEEvent, SSEEventData } from "../types";

/**
 * Incremental SSE parser. Feed it text chunks via `push()` and it returns
 * fully parsed events. Buffers incomplete data across calls.
 *
 * Wire format:
 *   event: <type>\n
 *   id: <seq>\n
 *   data: <json>\n
 *   \n
 *
 * Events are delimited by a blank line (\n\n).
 */
export class SSEParser {
  private buffer = "";

  /** Feed a text chunk. Returns zero or more parsed events. */
  push(chunk: string): ParsedSSEEvent[] {
    this.buffer += chunk;
    const events: ParsedSSEEvent[] = [];
    const parts = this.buffer.split("\n\n");
    // Last part is potentially incomplete — keep in buffer
    this.buffer = parts.pop()!;
    for (const part of parts) {
      if (!part.trim()) continue;
      const event = this.parseBlock(part);
      if (event) events.push(event);
    }
    return events;
  }

  /** Reset internal buffer (e.g. on reconnect). */
  reset(): void {
    this.buffer = "";
  }

  private parseBlock(raw: string): ParsedSSEEvent | null {
    let type = "message";
    let id = "";
    let dataStr = "";
    for (const line of raw.split("\n")) {
      if (line.startsWith("event:")) {
        type = line.slice(6).trim();
      } else if (line.startsWith("id:")) {
        id = line.slice(3).trim();
      } else if (line.startsWith("data:")) {
        dataStr = line.slice(5).trim();
      }
    }
    if (!dataStr) return null;
    let data: SSEEventData;
    try {
      data = JSON.parse(dataStr) as SSEEventData;
    } catch {
      data = { content: dataStr };
    }
    return { type, id, data };
  }
}
```

- [ ] **Step 5: Run tests — all pass**

```bash
npx vitest run tests/client/sse-parser.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/client/sse-parser.ts tests/client/sse-parser.test.ts
git commit -m "feat: SSE parser with typed events"
```

---

## Task 2: Client SSE and execution methods

**Files:**
- Modify: `src/client/agentmd-client.ts`
- Modify: `tests/client/agentmd-client.test.ts`

Adds four methods: `runAgent`, `cancelExecution`, `listExecutions`, and `openSSE`. The first three are thin wrappers (like `health`/`info`/`listAgents`). `openSSE` is different — it opens a persistent HTTP connection and pipes chunks through the SSE parser, calling a callback on each event.

- [ ] **Step 1: Add imports to `agentmd-client.ts`**

Update the imports at top of `src/client/agentmd-client.ts`:

```typescript
import type { AgentSummary, ExecutionSummary, InfoResponse, ParsedSSEEvent, RunRequest } from "../types";
import { SSEParser } from "./sse-parser";
```

- [ ] **Step 2: Add `runAgent` method**

Add after `listAgents()`:

```typescript
  /** Starts an agent execution. Returns the new execution ID. */
  async runAgent(
    name: string,
    opts?: RunRequest,
  ): Promise<{ execution_id: number }> {
    return this.post<{ execution_id: number }>(
      `/agents/${encodeURIComponent(name)}/run`,
      opts,
    );
  }
```

- [ ] **Step 3: Add `cancelExecution` method**

```typescript
  /** Cancels a running execution. */
  async cancelExecution(id: number): Promise<void> {
    await this.del(`/executions/${id}`);
  }
```

- [ ] **Step 4: Add `listExecutions` method**

```typescript
  /** Fetches executions, optionally filtered. */
  async listExecutions(params?: {
    status?: string;
    agent?: string;
    limit?: number;
    offset?: number;
  }): Promise<ExecutionSummary[]> {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    if (params?.agent) query.set("agent", params.agent);
    if (params?.limit != null) query.set("limit", String(params.limit));
    if (params?.offset != null) query.set("offset", String(params.offset));
    const qs = query.toString();
    return this.get<ExecutionSummary[]>(`/executions${qs ? `?${qs}` : ""}`);
  }
```

- [ ] **Step 5: Add `openSSE` method**

This is the most important addition. It opens a persistent HTTP GET, pipes chunks through an SSEParser instance, and calls back on each event. Returns a `close` function.

```typescript
  /**
   * Opens an SSE stream on the given path. Calls `onEvent` for each parsed
   * event. Returns a function that closes the connection.
   *
   * The caller is responsible for reconnect logic — this method opens a
   * single connection.
   */
  openSSE(
    path: string,
    onEvent: (event: ParsedSSEEvent) => void,
    onError?: (err: Error) => void,
    onEnd?: () => void,
  ): () => void {
    const parser = new SSEParser();

    const req = http.request(
      {
        socketPath: this.socketPath,
        path,
        method: "GET",
        headers: { Accept: "text/event-stream" },
      },
      (res) => {
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          const events = parser.push(chunk);
          for (const event of events) {
            onEvent(event);
          }
        });
        res.on("error", (err) => onError?.(err));
        res.on("end", () => onEnd?.());
      },
    );

    req.on("error", (err) => onError?.(err));
    req.end();

    return () => {
      req.destroy();
    };
  }
```

- [ ] **Step 6: Write tests for `runAgent` and `cancelExecution`**

Append to `tests/client/agentmd-client.test.ts`:

```typescript
describe("AgentmdClient.runAgent()", () => {
  let socketPath: string;
  let server: http.Server;

  beforeEach(() => { socketPath = tempSocketPath(); });
  afterEach(async () => { if (server) await stopServer(server, socketPath); });

  it("POSTs to /agents/{name}/run and returns execution_id", async () => {
    let receivedPath: string | undefined;
    let receivedBody: string | undefined;

    server = await startFakeServer(socketPath, (req, res) => {
      receivedPath = req.url;
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        receivedBody = Buffer.concat(chunks).toString("utf8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ execution_id: 99 }));
      });
    });

    const client = new AgentmdClient({ socketPath });
    const result = await client.runAgent("research", { args: ["/path/to/file.md"] });

    expect(receivedPath).toBe("/agents/research/run");
    expect(JSON.parse(receivedBody!)).toEqual({ args: ["/path/to/file.md"] });
    expect(result.execution_id).toBe(99);
  });
});

describe("AgentmdClient.cancelExecution()", () => {
  let socketPath: string;
  let server: http.Server;

  beforeEach(() => { socketPath = tempSocketPath(); });
  afterEach(async () => { if (server) await stopServer(server, socketPath); });

  it("sends DELETE /executions/{id}", async () => {
    let receivedPath: string | undefined;
    let receivedMethod: string | undefined;

    server = await startFakeServer(socketPath, (req, res) => {
      receivedPath = req.url;
      receivedMethod = req.method;
      res.writeHead(204);
      res.end();
    });

    const client = new AgentmdClient({ socketPath });
    await client.cancelExecution(42);

    expect(receivedMethod).toBe("DELETE");
    expect(receivedPath).toBe("/executions/42");
  });
});

describe("AgentmdClient.listExecutions()", () => {
  let socketPath: string;
  let server: http.Server;

  beforeEach(() => { socketPath = tempSocketPath(); });
  afterEach(async () => { if (server) await stopServer(server, socketPath); });

  it("sends GET /executions with query params", async () => {
    let receivedPath: string | undefined;

    server = await startFakeServer(socketPath, (req, res) => {
      receivedPath = req.url;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([]));
    });

    const client = new AgentmdClient({ socketPath });
    await client.listExecutions({ status: "running", limit: 10 });

    expect(receivedPath).toContain("/executions");
    expect(receivedPath).toContain("status=running");
    expect(receivedPath).toContain("limit=10");
  });
});
```

- [ ] **Step 7: Run tests — all pass**

```bash
npx vitest run tests/client/agentmd-client.test.ts
```

Expected: PASS (13 tests — 10 from Plan 1 + 3 new).

- [ ] **Step 8: Commit**

```bash
git add src/client/agentmd-client.ts tests/client/agentmd-client.test.ts
git commit -m "feat: client methods for run, cancel, list executions, and SSE streaming"
```

---

## Task 3: Settings data store

**Files:**
- Create: `src/settings.ts`

A simple data interface for plugin settings with defaults and Obsidian-compatible load/save. No UI tab yet (that's Plan 3) — settings are just hardcoded defaults that `main.ts` can override later.

- [ ] **Step 1: Create `src/settings.ts`**

```typescript
export interface AgentmdSettings {
  /** Absolute path to the agentmd Unix domain socket. */
  socketPath: string;
  /** Open ExecutionDetailView automatically when a run starts. */
  autoOpenOnRun: boolean;
  /** Notification behavior on execution completion. */
  notifications: "all" | "failures" | "off";
  /** Health poll interval in milliseconds. */
  pollIntervalMs: number;
}

export const DEFAULT_SETTINGS: AgentmdSettings = {
  socketPath: `${typeof process !== "undefined" ? process.env?.HOME ?? "" : ""}/.local/state/agentmd/agentmd.sock`,
  autoOpenOnRun: true,
  notifications: "all",
  pollIntervalMs: 15000,
};
```

- [ ] **Step 2: Verify compilation**

```bash
npx tsc --noEmit --skipLibCheck
```

- [ ] **Step 3: Commit**

```bash
git add src/settings.ts
git commit -m "feat: settings interface with defaults"
```

---

## Task 4: Color system CSS tokens + view base styles

**Files:**
- Modify: `styles.css`

Replace the entire file with the full color system from the spec plus base structural styles for all views. This is CSS-only — no TypeScript changes.

- [ ] **Step 1: Write the complete `styles.css`**

Overwrite `styles.css` with the full content. The file defines:

1. CSS custom properties under `.agentmd-*` classes (not `:root` to avoid leaking into other plugins)
2. Status bar styles (preserve existing pulse animation)
3. Agent card styles (spacious layout from the spec)
4. Live view card styles (neutral with colored trigger text)
5. Execution detail styles (streaming + completed modes)
6. Shared component styles (chips, buttons, headers)

```css
/* ============================================================
   agentmd-obsidian — Full style system
   Color tokens, view layouts, and component styles.
   ============================================================ */

/* ---------- Color tokens ---------- */
.agentmd-status-running  { color: #3b82f6; }
.agentmd-status-success  { color: #10b981; }
.agentmd-status-failed   { color: #ef4444; }
.agentmd-status-aborted  { color: #f59e0b; }
.agentmd-trigger-manual    { color: #888888; }
.agentmd-trigger-scheduler { color: #fbbf24; }
.agentmd-trigger-watch     { color: #06b6d4; }
.agentmd-brand           { color: #8b5cf6; }

/* ---------- Status bar ---------- */
.agentmd-status-bar {
  font-variant-numeric: tabular-nums;
}
.agentmd-status-dot {
  margin-right: 4px;
}
.agentmd-status-online .agentmd-status-dot {
  animation: agentmd-pulse 2s ease-in-out infinite;
}
@keyframes agentmd-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
.agentmd-status-bar.agentmd-status-online {
  color: #10b981;
}
.agentmd-status-bar.agentmd-status-offline {
  color: var(--text-faint);
}

/* ---------- View headers ---------- */
.agentmd-view-header {
  padding: 8px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--font-ui-small);
  color: var(--text-normal);
  border-bottom: 1px solid var(--background-modifier-border);
}
.agentmd-view-header .agentmd-view-icon {
  color: #8b5cf6;
}
.agentmd-view-header .agentmd-view-count {
  color: var(--text-faint);
  margin-left: auto;
  font-size: var(--font-ui-smaller);
}

/* ---------- Chips ---------- */
.agentmd-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 7px;
  border-radius: 10px;
  font-size: var(--font-ui-smaller);
  background: var(--background-secondary);
  color: var(--text-muted);
  white-space: nowrap;
}
.agentmd-chip.running  { background: rgba(59,130,246,0.15); color: #3b82f6; }
.agentmd-chip.scheduled { background: rgba(251,191,36,0.15); color: #fbbf24; }
.agentmd-chip.watch    { background: rgba(6,182,212,0.15);  color: #06b6d4; }
.agentmd-chip.manual   { background: var(--background-secondary); color: var(--text-faint); }
.agentmd-chip.model    { background: transparent; color: var(--text-faint); border: 1px solid var(--background-modifier-border); }

/* ---------- Action buttons ---------- */
.agentmd-btn {
  background: var(--background-secondary);
  border: 1px solid var(--background-modifier-border);
  border-radius: 4px;
  padding: 3px 8px;
  color: var(--text-normal);
  font-size: var(--font-ui-smaller);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.agentmd-btn:hover {
  background: var(--background-modifier-hover);
}
.agentmd-btn.primary {
  background: rgba(139,92,246,0.2);
  border-color: rgba(139,92,246,0.4);
}
.agentmd-btn.primary:hover {
  background: rgba(139,92,246,0.3);
}
.agentmd-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ---------- Agent cards ---------- */
.agentmd-agent-card {
  padding: 10px 12px;
  border-bottom: 1px solid var(--background-modifier-border);
  cursor: pointer;
}
.agentmd-agent-card:hover {
  background: var(--background-secondary);
}
.agentmd-agent-card.is-running {
  border-left: 2px solid #3b82f6;
  background: rgba(59,130,246,0.05);
}
.agentmd-agent-card .agent-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.agentmd-agent-card .agent-name {
  font-size: var(--font-ui-small);
  font-weight: var(--font-semibold);
  color: var(--text-normal);
}
.agentmd-agent-card .agent-desc {
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
  margin-bottom: 6px;
  line-height: 1.3;
}
.agentmd-agent-card .agent-footer {
  display: flex;
  align-items: center;
  gap: 6px;
}
.agentmd-agent-card .agent-actions {
  margin-left: auto;
  display: flex;
  gap: 4px;
}

/* ---------- Live view cards ---------- */
.agentmd-live-card {
  padding: 10px 12px;
  border-bottom: 1px solid var(--background-modifier-border);
  cursor: pointer;
}
.agentmd-live-card:hover {
  background: var(--background-secondary);
}
.agentmd-live-card .live-header {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: var(--font-ui-small);
}
.agentmd-live-card .live-dot {
  color: #3b82f6;
}
.agentmd-live-card .live-name {
  font-weight: var(--font-semibold);
  color: var(--text-normal);
}
.agentmd-live-card .live-id {
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
}
.agentmd-live-card .live-trigger {
  font-size: var(--font-ui-smaller);
}
.agentmd-live-card .live-cancel {
  margin-left: auto;
  color: var(--text-faint);
  cursor: pointer;
  font-size: var(--font-ui-smaller);
}
.agentmd-live-card .live-cancel:hover {
  color: #ef4444;
}
.agentmd-live-card .live-activity {
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
  font-family: var(--font-monospace);
  margin-top: 3px;
  padding-left: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agentmd-live-card .live-stats {
  display: flex;
  gap: 8px;
  font-size: var(--font-ui-smaller);
  color: var(--text-faint);
  margin-top: 3px;
  padding-left: 14px;
}

/* ---------- Execution Detail ---------- */
.agentmd-exec-detail .exec-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--background-modifier-border);
}
.agentmd-exec-detail .exec-header.streaming {
  background: rgba(59,130,246,0.08);
}
.agentmd-exec-detail .exec-header.success {
  background: rgba(16,185,129,0.08);
}
.agentmd-exec-detail .exec-header.failed {
  background: rgba(239,68,68,0.08);
}
.agentmd-exec-detail .exec-header.aborted {
  background: rgba(245,158,11,0.08);
}
.agentmd-exec-detail .exec-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--font-ui-medium);
  font-weight: var(--font-semibold);
  color: var(--text-normal);
  margin-bottom: 5px;
}
.agentmd-exec-detail .exec-meta {
  font-size: var(--font-ui-smaller);
  color: var(--text-faint);
}
.agentmd-exec-detail .exec-stats {
  display: flex;
  gap: 10px;
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
  margin-top: 5px;
}
.agentmd-exec-detail .exec-final-answer {
  padding: 14px 16px;
  background: rgba(16,185,129,0.06);
  border-bottom: 1px solid rgba(16,185,129,0.15);
}
.agentmd-exec-detail .exec-final-answer .final-label {
  font-size: var(--font-ui-smaller);
  color: #10b981;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
}
.agentmd-exec-detail .exec-final-answer .final-content {
  color: var(--text-normal);
  font-size: var(--font-ui-small);
  line-height: 1.6;
}
.agentmd-exec-detail .exec-log {
  padding: 10px 16px;
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
  line-height: 1.7;
}
.agentmd-exec-detail .exec-log .log-tool-call { color: #10b981; }
.agentmd-exec-detail .exec-log .log-tool-result { color: #8b5cf6; }
.agentmd-exec-detail .exec-log .log-ai { color: var(--text-normal); }
.agentmd-exec-detail .exec-log .log-cursor {
  color: var(--text-faint);
  animation: agentmd-blink 1s step-end infinite;
}
@keyframes agentmd-blink {
  50% { opacity: 0; }
}

/* ---------- Empty states ---------- */
.agentmd-empty {
  padding: 24px 16px;
  text-align: center;
  color: var(--text-faint);
  font-size: var(--font-ui-small);
}

/* ---------- Offline banner ---------- */
.agentmd-offline-banner {
  padding: 8px 12px;
  background: rgba(245,158,11,0.1);
  border-bottom: 1px solid rgba(245,158,11,0.2);
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  display: flex;
  align-items: center;
  gap: 6px;
}
```

- [ ] **Step 2: Build to verify CSS is valid**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add styles.css
git commit -m "feat: full color system and view styles"
```

---

## Task 5: Formatting utilities

**Files:**
- Create: `src/ui/format.ts`
- Create: `tests/ui/format.test.ts`

Small pure functions for displaying relative time, token counts, and costs in the UI. Unit-tested, no Obsidian deps.

- [ ] **Step 1: Write tests**

Create `tests/ui/format.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run — verify failure**

```bash
npx vitest run tests/ui/format.test.ts
```

- [ ] **Step 3: Implement**

Create `src/ui/format.ts`:

```typescript
export function formatDuration(seconds: number | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

export function formatTokens(tokens: number | undefined): string {
  if (tokens == null) return "—";
  if (tokens < 1000) return `${tokens} tok`;
  return `${(tokens / 1000).toFixed(1)}k tok`;
}

export function formatCost(cost: number | undefined): string {
  if (cost == null) return "—";
  if (cost < 0.01) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

export function formatRelativeTime(iso: string | undefined): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
```

- [ ] **Step 4: Run tests — all pass**

```bash
npx vitest run tests/ui/format.test.ts
```

Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/format.ts tests/ui/format.test.ts
git commit -m "feat: formatting utilities for duration, tokens, cost, relative time"
```

---

## Task 6: EventStore — reactive state

**Files:**
- Create: `src/store/event-store.ts`
- Create: `tests/store/event-store.test.ts`

EventStore is the single source of truth for agents, running executions, and recent history. Views subscribe to specific slices and re-render on change.

- [ ] **Step 1: Write tests**

Create `tests/store/event-store.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run — verify failure**

```bash
npx vitest run tests/store/event-store.test.ts
```

- [ ] **Step 3: Implement EventStore**

Create `src/store/event-store.ts`:

```typescript
import type { AgentSummary, ExecutionSummary, ParsedSSEEvent } from "../types";

export interface RunningExecution {
  id: number;
  agent: string;
  triggerSource: string;
  startedAt: number; // Date.now()
  events: ParsedSSEEvent[];
  lastActivity: string;
  tokensTotal: number;
  costUsd: number;
  finalAnswer?: string;
}

type Listener = () => void;

export class EventStore {
  private _agents: AgentSummary[] = [];
  private _running = new Map<number, RunningExecution>();
  private _history: ExecutionSummary[] = [];

  private agentListeners = new Set<Listener>();
  private runningListeners = new Set<Listener>();
  private historyListeners = new Set<Listener>();

  // ---- Getters ----

  get agents(): readonly AgentSummary[] {
    return this._agents;
  }

  get running(): ReadonlyMap<number, RunningExecution> {
    return this._running;
  }

  get history(): readonly ExecutionSummary[] {
    return this._history;
  }

  // ---- Subscriptions ----

  onAgentsChanged(listener: Listener): () => void {
    this.agentListeners.add(listener);
    return () => this.agentListeners.delete(listener);
  }

  onRunningChanged(listener: Listener): () => void {
    this.runningListeners.add(listener);
    return () => this.runningListeners.delete(listener);
  }

  onHistoryChanged(listener: Listener): () => void {
    this.historyListeners.add(listener);
    return () => this.historyListeners.delete(listener);
  }

  // ---- Mutations ----

  setAgents(agents: AgentSummary[]): void {
    this._agents = [...agents].sort((a, b) => a.name.localeCompare(b.name));
    this.notify(this.agentListeners);
  }

  setHistory(executions: ExecutionSummary[]): void {
    this._history = executions;
    this.notify(this.historyListeners);
  }

  startExecution(id: number, agent: string, triggerSource: string): void {
    this._running.set(id, {
      id,
      agent,
      triggerSource,
      startedAt: Date.now(),
      events: [],
      lastActivity: "",
      tokensTotal: 0,
      costUsd: 0,
    });
    this.notify(this.runningListeners);
  }

  pushEvent(executionId: number, event: ParsedSSEEvent): void {
    const run = this._running.get(executionId);
    if (!run) return;

    run.events.push(event);

    // Update lastActivity based on event type
    if (event.type === "tool_call" && event.data.tools?.length) {
      run.lastActivity = `🔧 ${event.data.tools[0].name}`;
    } else if (event.type === "tool_result") {
      run.lastActivity = `📎 ${event.data.tool_name ?? "result"}`;
    } else if (event.type === "ai" && event.data.content) {
      run.lastActivity = `🤖 ${event.data.content.slice(0, 60)}`;
    } else if (event.type === "final_answer" && event.data.content) {
      run.finalAnswer = event.data.content;
      run.lastActivity = `✅ Final answer`;
    }

    // Update stats from complete event
    if (event.type === "complete") {
      if (event.data.total_tokens != null) run.tokensTotal = event.data.total_tokens;
      if (event.data.cost_usd != null) run.costUsd = event.data.cost_usd;
    }

    this.notify(this.runningListeners);
  }

  completeExecution(executionId: number, summary: ExecutionSummary): void {
    this._running.delete(executionId);
    // Prepend to history (most recent first)
    this._history = [summary, ...this._history];
    this.notify(this.runningListeners);
    this.notify(this.historyListeners);
  }

  removeRunning(executionId: number): void {
    this._running.delete(executionId);
    this.notify(this.runningListeners);
  }

  // ---- Internal ----

  private notify(listeners: Set<Listener>): void {
    for (const fn of listeners) {
      fn();
    }
  }
}
```

- [ ] **Step 4: Run tests — all pass**

```bash
npx vitest run tests/store/event-store.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Run full suite**

```bash
npm test
```

Expected: all tests pass (Plan 1 tests + new SSE parser + format + event store tests).

- [ ] **Step 6: Commit**

```bash
git add src/store/event-store.ts tests/store/event-store.test.ts
git commit -m "feat: EventStore reactive state with agents, running, history"
```

---

## Task 7: View constants + AgentsView

**Files:**
- Create: `src/views/constants.ts`
- Create: `src/views/agents-view.ts`

AgentsView is the first Obsidian `ItemView`. It renders the alphabetical list of agent cards with trigger chips, model chips, and two run buttons. No unit tests — views are Obsidian-dependent and validated via smoke test.

- [ ] **Step 1: Create view type constants**

Create `src/views/constants.ts`:

```typescript
export const VIEW_TYPE_AGENTS = "agentmd-agents";
export const VIEW_TYPE_LIVE = "agentmd-live";
export const VIEW_TYPE_EXEC_DETAIL = "agentmd-exec-detail";
```

- [ ] **Step 2: Create AgentsView**

Create `src/views/agents-view.ts`:

```typescript
import { ItemView, WorkspaceLeaf } from "obsidian";
import type { AgentSummary } from "../types";
import type { EventStore } from "../store/event-store";
import { VIEW_TYPE_AGENTS } from "./constants";

/** Callback provided by the plugin to handle user actions. */
export interface AgentsViewActions {
  onRunAgent: (name: string, withCurrentFile: boolean) => void;
  getCurrentFilePath: () => string | null;
}

export class AgentsView extends ItemView {
  private store: EventStore;
  private actions: AgentsViewActions;
  private unsubAgents: (() => void) | null = null;
  private unsubRunning: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, store: EventStore, actions: AgentsViewActions) {
    super(leaf);
    this.store = store;
    this.actions = actions;
  }

  getViewType(): string { return VIEW_TYPE_AGENTS; }
  getDisplayText(): string { return "Agents"; }
  getIcon(): string { return "cpu"; }

  async onOpen(): Promise<void> {
    this.render();
    this.unsubAgents = this.store.onAgentsChanged(() => this.render());
    this.unsubRunning = this.store.onRunningChanged(() => this.render());
  }

  async onClose(): Promise<void> {
    this.unsubAgents?.();
    this.unsubRunning?.();
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("agentmd-agents-view");

    // Header
    const header = container.createDiv({ cls: "agentmd-view-header" });
    header.createSpan({ cls: "agentmd-view-icon", text: "◆" });
    header.createSpan({ text: "Agents" });
    header.createSpan({ cls: "agentmd-view-count", text: String(this.store.agents.length) });

    // Agent cards
    if (this.store.agents.length === 0) {
      container.createDiv({ cls: "agentmd-empty", text: "No agents found. Is the backend running?" });
      return;
    }

    for (const agent of this.store.agents) {
      this.renderCard(container, agent);
    }
  }

  private renderCard(container: HTMLElement, agent: AgentSummary): void {
    const isRunning = this.isAgentRunning(agent.name);
    const card = container.createDiv({ cls: `agentmd-agent-card ${isRunning ? "is-running" : ""}` });

    // Row 1: name + trigger chip + menu
    const headerEl = card.createDiv({ cls: "agent-header" });
    headerEl.createSpan({ cls: "agent-name", text: agent.name });
    this.renderTriggerChip(headerEl, agent, isRunning);

    // Row 2: description
    if (agent.description) {
      card.createDiv({ cls: "agent-desc", text: agent.description });
    }

    // Row 3: model chip + run buttons
    const footer = card.createDiv({ cls: "agent-footer" });
    const modelText = `${agent.model.provider} · ${agent.model.name}`;
    footer.createSpan({ cls: "agentmd-chip model", text: modelText });

    const actions = footer.createDiv({ cls: "agent-actions" });

    // Run button (no args)
    const runBtn = actions.createEl("button", { cls: "agentmd-btn", text: "▶" });
    runBtn.title = "Run without arguments";
    if (isRunning) runBtn.disabled = true;
    runBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.actions.onRunAgent(agent.name, false);
    });

    // Run with current file button
    const currentFile = this.actions.getCurrentFilePath();
    const runFileBtn = actions.createEl("button", { cls: "agentmd-btn primary", text: "▶ 📄" });
    if (currentFile) {
      const parts = currentFile.split("/");
      runFileBtn.title = `Run with ${parts[parts.length - 1]}`;
    } else {
      runFileBtn.title = "Open a note first";
      runFileBtn.disabled = true;
    }
    if (isRunning) runFileBtn.disabled = true;
    runFileBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.actions.onRunAgent(agent.name, true);
    });
  }

  private renderTriggerChip(container: HTMLElement, agent: AgentSummary, isRunning: boolean): void {
    if (isRunning) {
      const runCount = this.runningCountForAgent(agent.name);
      const text = runCount > 1 ? `● Running · ${runCount} active` : "● Running";
      container.createSpan({ cls: "agentmd-chip running", text });
      return;
    }
    if (!agent.trigger || agent.trigger.type === "manual") {
      container.createSpan({ cls: "agentmd-chip manual", text: "Manual" });
    } else if (agent.trigger.type === "schedule") {
      const info = agent.trigger.every ?? agent.trigger.cron ?? "";
      const text = agent.next_run
        ? `⏱ ${info} · in ${this.timeUntil(agent.next_run)}`
        : `⏱ ${info}`;
      container.createSpan({ cls: "agentmd-chip scheduled", text });
    } else if (agent.trigger.type === "watch") {
      const paths = agent.trigger.paths?.join(", ") ?? "";
      container.createSpan({ cls: "agentmd-chip watch", text: `👁 ${paths}` });
    }
  }

  private isAgentRunning(name: string): boolean {
    for (const run of this.store.running.values()) {
      if (run.agent === name) return true;
    }
    return false;
  }

  private runningCountForAgent(name: string): number {
    let count = 0;
    for (const run of this.store.running.values()) {
      if (run.agent === name) count++;
    }
    return count;
  }

  private timeUntil(iso: string): string {
    const diffMs = new Date(iso).getTime() - Date.now();
    if (diffMs < 0) return "now";
    const minutes = Math.floor(diffMs / 60_000);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h`;
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit --skipLibCheck
```

- [ ] **Step 4: Commit**

```bash
git add src/views/constants.ts src/views/agents-view.ts
git commit -m "feat: AgentsView with spacious cards, trigger chips, and run buttons"
```

---

## Task 8: LiveView

**Files:**
- Create: `src/views/live-view.ts`

Sidebar view showing neutral cards for currently-running executions. Clicking a card opens the detail tab. The `✕` icon cancels the execution.

- [ ] **Step 1: Create LiveView**

Create `src/views/live-view.ts`:

```typescript
import { ItemView, WorkspaceLeaf } from "obsidian";
import type { EventStore, RunningExecution } from "../store/event-store";
import { VIEW_TYPE_LIVE } from "./constants";
import { formatDuration, formatTokens, formatCost } from "../ui/format";

export interface LiveViewActions {
  onOpenExecution: (executionId: number) => void;
  onCancelExecution: (executionId: number) => void;
}

export class LiveView extends ItemView {
  private store: EventStore;
  private actions: LiveViewActions;
  private unsub: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, store: EventStore, actions: LiveViewActions) {
    super(leaf);
    this.store = store;
    this.actions = actions;
  }

  getViewType(): string { return VIEW_TYPE_LIVE; }
  getDisplayText(): string { return "Live"; }
  getIcon(): string { return "activity"; }

  async onOpen(): Promise<void> {
    this.render();
    this.unsub = this.store.onRunningChanged(() => this.render());
  }

  async onClose(): Promise<void> {
    this.unsub?.();
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();

    // Header
    const header = container.createDiv({ cls: "agentmd-view-header" });
    header.createSpan({ cls: "agentmd-view-icon", text: "●" });
    header.createSpan({ text: "Live" });
    const count = this.store.running.size;
    header.createSpan({ cls: "agentmd-view-count", text: count > 0 ? `${count} active` : "" });

    if (count === 0) {
      container.createDiv({
        cls: "agentmd-empty",
        text: "No running executions. Click ▶ on an agent to start one.",
      });
      return;
    }

    // Cards sorted by most recent first
    const runs = [...this.store.running.values()].sort(
      (a, b) => b.startedAt - a.startedAt,
    );

    for (const run of runs) {
      this.renderCard(container, run);
    }
  }

  private renderCard(container: HTMLElement, run: RunningExecution): void {
    const card = container.createDiv({ cls: "agentmd-live-card" });
    card.addEventListener("click", () => this.actions.onOpenExecution(run.id));

    // Row 1: dot + name + #id + trigger + cancel
    const headerEl = card.createDiv({ cls: "live-header" });
    headerEl.createSpan({ cls: "live-dot", text: "●" });
    headerEl.createSpan({ cls: "live-name", text: run.agent });
    headerEl.createSpan({ cls: "live-id", text: `#${run.id}` });

    const triggerCls =
      run.triggerSource === "scheduler" ? "agentmd-trigger-scheduler" :
      run.triggerSource === "watch" ? "agentmd-trigger-watch" :
      "agentmd-trigger-manual";
    headerEl.createSpan({ cls: `live-trigger ${triggerCls}`, text: `· ${run.triggerSource}` });

    const cancel = headerEl.createSpan({ cls: "live-cancel", text: "✕" });
    cancel.addEventListener("click", (e) => {
      e.stopPropagation();
      this.actions.onCancelExecution(run.id);
    });

    // Row 2: last activity
    if (run.lastActivity) {
      card.createDiv({ cls: "live-activity", text: run.lastActivity });
    }

    // Row 3: stats
    const elapsed = Math.round((Date.now() - run.startedAt) / 1000);
    const stats = card.createDiv({ cls: "live-stats" });
    stats.createSpan({ text: formatDuration(elapsed) });
    if (run.tokensTotal > 0) stats.createSpan({ text: formatTokens(run.tokensTotal) });
    if (run.costUsd > 0) stats.createSpan({ text: formatCost(run.costUsd) });
  }
}
```

- [ ] **Step 2: Verify compilation**

```bash
npx tsc --noEmit --skipLibCheck
```

- [ ] **Step 3: Commit**

```bash
git add src/views/live-view.ts
git commit -m "feat: LiveView with neutral running execution cards"
```

---

## Task 9: ExecutionDetailView

**Files:**
- Create: `src/views/execution-detail-view.ts`

Main-area tab view with two modes: streaming (live SSE) and completed (readable log with final answer highlighted). Single component, mode driven by execution state.

- [ ] **Step 1: Create ExecutionDetailView**

Create `src/views/execution-detail-view.ts`:

```typescript
import { ItemView, WorkspaceLeaf } from "obsidian";
import type { EventStore, RunningExecution } from "../store/event-store";
import type { ExecutionSummary, ParsedSSEEvent } from "../types";
import { VIEW_TYPE_EXEC_DETAIL } from "./constants";
import { formatDuration, formatTokens, formatCost } from "../ui/format";

export interface ExecDetailActions {
  onCancel: (executionId: number) => void;
  onRerun: (agentName: string, args?: string[]) => void;
}

export interface ExecDetailState {
  executionId: number;
}

export class ExecutionDetailView extends ItemView {
  private store: EventStore;
  private actions: ExecDetailActions;
  private executionId: number = 0;
  private unsub: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, store: EventStore, actions: ExecDetailActions) {
    super(leaf);
    this.store = store;
    this.actions = actions;
  }

  getViewType(): string { return VIEW_TYPE_EXEC_DETAIL; }
  getDisplayText(): string { return "Execution"; }
  getIcon(): string { return "terminal"; }

  setExecutionId(id: number): void {
    this.executionId = id;
    this.render();
  }

  async onOpen(): Promise<void> {
    this.unsub = this.store.onRunningChanged(() => {
      if (this.store.running.has(this.executionId)) {
        this.render();
      }
    });
    this.render();
  }

  async onClose(): Promise<void> {
    this.unsub?.();
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("agentmd-exec-detail");

    const running = this.store.running.get(this.executionId);
    if (running) {
      this.renderStreaming(container, running);
    } else {
      // Check history for a completed execution
      const completed = this.store.history.find((e) => e.id === this.executionId);
      if (completed) {
        this.renderCompleted(container, completed);
      } else {
        container.createDiv({ cls: "agentmd-empty", text: "Execution not found." });
      }
    }
  }

  private renderStreaming(container: HTMLElement, run: RunningExecution): void {
    // Header — streaming mode (blue)
    const header = container.createDiv({ cls: "exec-header streaming" });
    const title = header.createDiv({ cls: "exec-title" });
    title.createSpan({ cls: "agentmd-status-running", text: "●" });
    title.createSpan({ text: run.agent });
    title.createSpan({ cls: "exec-id", text: `#${run.id}` });

    const cancelBtn = title.createEl("button", { cls: "agentmd-btn", text: "■ Cancel" });
    cancelBtn.style.marginLeft = "auto";
    cancelBtn.addEventListener("click", () => this.actions.onCancel(run.id));

    // Stats
    const elapsed = Math.round((Date.now() - run.startedAt) / 1000);
    const stats = header.createDiv({ cls: "exec-stats" });
    stats.createSpan({ cls: "agentmd-status-running", text: "● running" });
    stats.createSpan({ text: formatDuration(elapsed) });
    stats.createSpan({ text: formatTokens(run.tokensTotal) });
    stats.createSpan({ text: formatCost(run.costUsd) });

    // Event log
    const log = container.createDiv({ cls: "exec-log" });
    for (const event of run.events) {
      this.renderLogEvent(log, event);
    }
    // Blinking cursor
    log.createSpan({ cls: "log-cursor", text: "▌" });
  }

  private renderCompleted(container: HTMLElement, exec: ExecutionSummary): void {
    const statusClass =
      exec.status === "success" ? "success" :
      exec.status === "failed" ? "failed" : "aborted";

    // Header
    const header = container.createDiv({ cls: `exec-header ${statusClass}` });
    const title = header.createDiv({ cls: "exec-title" });
    const statusIcon = exec.status === "success" ? "✓" : exec.status === "failed" ? "✗" : "⚠";
    title.createSpan({ cls: `agentmd-status-${exec.status === "success" ? "success" : exec.status === "failed" ? "failed" : "aborted"}`, text: statusIcon });
    title.createSpan({ text: exec.agent });
    title.createSpan({ cls: "exec-id", text: `#${exec.id}` });

    const rerunBtn = title.createEl("button", { cls: "agentmd-btn", text: "↻ Re-run" });
    rerunBtn.style.marginLeft = "auto";
    rerunBtn.addEventListener("click", () => this.actions.onRerun(exec.agent));

    // Stats
    const stats = header.createDiv({ cls: "exec-stats" });
    stats.createSpan({ cls: `agentmd-status-${statusClass}`, text: `${statusIcon} ${exec.status}` });
    stats.createSpan({ text: formatDuration(exec.duration_seconds) });
    stats.createSpan({ text: formatTokens(exec.tokens_total) });
    stats.createSpan({ text: formatCost(exec.cost_usd) });

    // Final answer (if the running execution captured it before completing)
    // We look up the running execution's finalAnswer from a stored snapshot
    // For now, show a placeholder — the full message log comes in Plan 3
    container.createDiv({
      cls: "agentmd-empty",
      text: "Full execution log available in a future update.",
    });
  }

  private renderLogEvent(container: HTMLElement, event: ParsedSSEEvent): void {
    const line = container.createDiv();
    if (event.type === "tool_call" && event.data.tools?.length) {
      line.createSpan({ cls: "log-tool-call", text: `🔧 >> ${event.data.tools[0].name}` });
      if (event.data.tools[0].args) {
        line.createSpan({ text: ` (${event.data.tools[0].args})`, cls: "exec-meta" });
      }
    } else if (event.type === "tool_result") {
      line.createSpan({ cls: "log-tool-result", text: `📎 << ${event.data.tool_name ?? "result"}` });
      if (event.data.content) {
        line.createSpan({ text: ` → ${event.data.content}`, cls: "exec-meta" });
      }
    } else if (event.type === "ai" && event.data.content) {
      line.createSpan({ cls: "log-ai", text: `🤖 ${event.data.content}` });
    } else if (event.type === "final_answer" && event.data.content) {
      line.createSpan({ cls: "log-ai", text: `✅ ${event.data.content}` });
    }
  }
}
```

- [ ] **Step 2: Verify compilation**

```bash
npx tsc --noEmit --skipLibCheck
```

- [ ] **Step 3: Commit**

```bash
git add src/views/execution-detail-view.ts
git commit -m "feat: ExecutionDetailView with streaming and completed modes"
```

---

## Task 10: Wire everything in main.ts

**Files:**
- Modify: `main.ts`

The big integration task. Registers all views, creates the EventStore, wires up the run flow (click ▶ → POST /run → open SSE → update store → views react), adds the ribbon icon, and connects the auto-open and notification settings.

- [ ] **Step 1: Rewrite `main.ts`**

Replace the contents of `main.ts` with the full integrated plugin. This is the composition root — it owns all singletons and passes them to views via closures.

```typescript
import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { AgentmdClient } from "./src/client/agentmd-client";
import { BackendMonitor } from "./src/backend-monitor";
import { EventStore } from "./src/store/event-store";
import { AgentsView } from "./src/views/agents-view";
import { LiveView } from "./src/views/live-view";
import { ExecutionDetailView } from "./src/views/execution-detail-view";
import { VIEW_TYPE_AGENTS, VIEW_TYPE_LIVE, VIEW_TYPE_EXEC_DETAIL } from "./src/views/constants";
import { DEFAULT_SETTINGS, type AgentmdSettings } from "./src/settings";
import type { ExecutionSummary } from "./src/types";

export default class AgentmdPlugin extends Plugin {
  private client!: AgentmdClient;
  private monitor!: BackendMonitor;
  private store!: EventStore;
  private settings!: AgentmdSettings;
  private statusBarEl!: HTMLElement;
  private unsubMonitor: (() => void) | null = null;
  /** Map of execution ID → SSE close function */
  private sseConnections = new Map<number, () => void>();
  /** Timer for polling background (scheduler/watch) executions */
  private bgPollTimer: ReturnType<typeof setInterval> | null = null;

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    this.client = new AgentmdClient({ socketPath: this.settings.socketPath });
    this.monitor = new BackendMonitor({
      client: this.client,
      intervalMs: this.settings.pollIntervalMs,
    });
    this.store = new EventStore();

    // Status bar
    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass("agentmd-status-bar");
    this.renderStatusBar(this.monitor.online);
    this.unsubMonitor = this.monitor.subscribe((online) => {
      this.renderStatusBar(online);
      if (online) void this.refreshData();
    });

    // Register views
    this.registerView(VIEW_TYPE_AGENTS, (leaf) =>
      new AgentsView(leaf, this.store, {
        onRunAgent: (name, withFile) => this.runAgent(name, withFile),
        getCurrentFilePath: () => this.getCurrentFilePath(),
      }),
    );
    this.registerView(VIEW_TYPE_LIVE, (leaf) =>
      new LiveView(leaf, this.store, {
        onOpenExecution: (id) => this.openExecutionDetail(id),
        onCancelExecution: (id) => this.cancelExecution(id),
      }),
    );
    this.registerView(VIEW_TYPE_EXEC_DETAIL, (leaf) =>
      new ExecutionDetailView(leaf, this.store, {
        onCancel: (id) => this.cancelExecution(id),
        onRerun: (name) => this.runAgent(name, false),
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

    // Ribbon icon
    this.addRibbonIcon("cpu", "AgentMD", () => {
      this.activateView(VIEW_TYPE_AGENTS);
    });

    // Default layout on first install
    if (!this.app.workspace.getLeavesOfType(VIEW_TYPE_AGENTS).length) {
      this.app.workspace.onLayoutReady(() => {
        void this.activateView(VIEW_TYPE_AGENTS);
        void this.activateView(VIEW_TYPE_LIVE);
      });
    }

    // Start monitoring
    this.monitor.start();

    // Background execution poller (picks up scheduler/watch-triggered runs)
    this.bgPollTimer = setInterval(() => {
      if (this.monitor.online) void this.detectBackgroundExecutions();
    }, 5000);
  }

  onunload(): void {
    this.monitor?.stop();
    this.unsubMonitor?.();
    if (this.bgPollTimer != null) clearInterval(this.bgPollTimer);
    for (const close of this.sseConnections.values()) close();
    this.sseConnections.clear();
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
      // Resolve to absolute path
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
      // May already be finished — ignore
    }
  }

  private subscribeToExecution(executionId: number): void {
    const close = this.client.openSSE(
      `/executions/${executionId}/stream`,
      (event) => {
        this.store.pushEvent(executionId, event);
        if (event.type === "complete") {
          // Build a summary from the event data
          const summary: ExecutionSummary = {
            id: executionId,
            agent: this.store.running.get(executionId)?.agent ?? "unknown",
            status: event.data.status === "success" ? "success" :
                    event.data.status === "error" ? "failed" : "aborted",
            started_at: new Date(this.store.running.get(executionId)?.startedAt ?? Date.now()).toISOString(),
            duration_seconds: event.data.duration_ms != null ? event.data.duration_ms / 1000 : undefined,
            tokens_total: event.data.total_tokens,
            cost_usd: event.data.cost_usd,
            error_tag: event.data.error,
          };
          this.store.completeExecution(executionId, summary);
          this.sseConnections.delete(executionId);
          this.notifyCompletion(summary);
        }
      },
      (err) => {
        console.error(`SSE error for execution ${executionId}:`, err);
        // Execution may still be running — don't remove from store
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
    const duration = summary.duration_seconds != null ? `${Math.round(summary.duration_seconds)}s` : "";
    const cost = summary.cost_usd != null ? `$${summary.cost_usd.toFixed(3)}` : "";
    new Notice(`${icon} ${summary.agent} ${summary.status} · ${duration} · ${cost}`);
  }

  // ---- Background execution detection ----

  private async detectBackgroundExecutions(): Promise<void> {
    try {
      const running = await this.client.listExecutions({ status: "running" });
      for (const exec of running) {
        if (!this.store.running.has(exec.id) && !this.sseConnections.has(exec.id)) {
          // New background execution we don't know about
          this.store.startExecution(exec.id, exec.agent, exec.trigger_source ?? "scheduler");
          this.subscribeToExecution(exec.id);
        }
      }
    } catch {
      // Backend may be offline — ignore
    }
  }

  // ---- View management ----

  private async openExecutionDetail(executionId: number): Promise<void> {
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_EXEC_DETAIL, active: true });
    const view = leaf.view as ExecutionDetailView;
    view.setExecutionId(executionId);
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
    // Simple prompt: pick from agent names
    // Using Obsidian's SuggestModal would be ideal but requires a subclass.
    // For Plan 2, use the first agent as a basic implementation.
    // Plan 3 will add a proper agent suggester modal.
    if (this.store.agents.length === 0) {
      new Notice("No agents available.");
      return;
    }
    // Show a notice listing agents — user triggers from AgentsView instead
    new Notice(`Use the Agents panel to run an agent with ${filePath.split("/").pop()}`);
    await this.activateView(VIEW_TYPE_AGENTS);
  }

  // ---- Data ----

  private async refreshData(): Promise<void> {
    try {
      const agents = await this.client.listAgents();
      this.store.setAgents(agents);
    } catch {
      // Offline — will retry on next poll
    }
  }

  private getCurrentFilePath(): string | null {
    const file = this.app.workspace.getActiveFile();
    return file?.path ?? null;
  }

  // ---- Status bar ----

  private renderStatusBar(online: boolean): void {
    this.statusBarEl.empty();
    const dot = this.statusBarEl.createSpan({ cls: "agentmd-status-dot" });
    dot.setText("●");
    const label = this.statusBarEl.createSpan();
    label.setText("AgentMD");
    this.statusBarEl.toggleClass("agentmd-status-online", online);
    this.statusBarEl.toggleClass("agentmd-status-offline", !online);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit --skipLibCheck
```

- [ ] **Step 3: Verify esbuild bundles**

```bash
npm run build
```

Expected: `main.js` produced, no errors.

- [ ] **Step 4: Run all tests to catch regressions**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add main.ts
git commit -m "feat: wire views, run flow, SSE streaming, notifications, ribbon icon"
```

---

## Task 11: Build + manual smoke test

**Files:** none created — this is a verification task.

- [ ] **Step 1: Production build**

```bash
npm run build
```

- [ ] **Step 2: Copy to vault**

```bash
VAULT=<path-to-obsidian-vault>
PLUGIN_ID=agentmd-obsidian
mkdir -p "$VAULT/.obsidian/plugins/$PLUGIN_ID"
cp main.js manifest.json styles.css "$VAULT/.obsidian/plugins/$PLUGIN_ID/"
```

- [ ] **Step 3: Manual smoke test checklist**

**YOU CANNOT RUN THIS STEP.** Document the checklist for the user:

1. **Enable plugin** — Settings → Community plugins → toggle "agentmd". No console errors.
2. **Status bar** — `● AgentMD` pulsing green when backend is running.
3. **Ribbon icon** — `cpu` icon appears in left ribbon. Click opens Agents panel.
4. **Agents panel** — shows alphabetical list of agents with trigger chips and model chips.
5. **Run button** — click ▶ on an agent. LiveView shows a card. ExecutionDetailView tab opens with streaming log.
6. **Run with file** — open a note, click ▶📄. Agent runs with the file path.
7. **Live view** — card shows agent name, #id, trigger origin, last tool call, growing stats.
8. **Completion** — when run finishes: card disappears from Live, Notice fires, detail tab transitions to completed mode.
9. **Cancel** — click ✕ on a live card. Execution cancels. Card disappears.
10. **Offline** — stop backend. Status bar flips. Views show correctly.
11. **Background detection** — start a scheduled agent from CLI. Within 5s, the Live view picks it up.

- [ ] **Step 4: Final commit (if any test-driven fixes were needed)**

```bash
git add -A
git commit -m "chore: Plan 2 smoke test fixes"
```

Only commit this if step 3 revealed issues that needed fixing.

---

## Done — what Plan 2 delivers

After finishing all 11 tasks:

- The plugin has three views: **Agents** (sidebar), **Live** (sidebar), **Execution Detail** (main-area tab).
- Clicking ▶ or ▶📄 on an agent card triggers a run, opens a live-streaming detail tab, and shows the running card in Live view.
- SSE events flow through the parser → EventStore → views in real-time.
- Completed executions fire a Notice and the detail tab transitions to a readable log.
- A ribbon icon opens the Agents panel.
- Background executions (from scheduler/watch triggers) are detected every 5s and picked up by the Live view.
- The plugin persists settings (auto-open, notifications) via `loadData`/`saveData` (no UI settings tab yet — that's Plan 3).

**Plan 3 will add:** ExecutionsView with filters, AgentDetailView dashboard, "Open source file" dual mode, scheduler pause/resume commands, full Settings tab UI, offline banner UX, vault==workspace detection, command palette additions.
