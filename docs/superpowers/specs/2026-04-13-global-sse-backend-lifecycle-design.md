# Global SSE Migration + Backend Lifecycle Controls

## Goal

Replace all polling mechanisms with a single global SSE connection (`GET /events/stream`) and add start/stop backend controls directly from the Obsidian UI.

## Architecture

The plugin currently uses 4 independent polling timers (health 15s, live 2s, background executions 5s, agents 30s). All are replaced by one persistent SSE connection to the agentmd backend's global event stream. A per-execution SSE (`/executions/{id}/stream`) is retained for detailed streaming logs. A new `BackendLifecycle` module enables starting/stopping the backend via UI.

## Tech Stack

- Obsidian Plugin API (ItemView, Plugin, Notice, PluginSettingTab)
- Node.js `child_process.execFile()` for backend start (safer than `exec()`, no shell injection)
- HTTP over Unix domain socket (existing `AgentmdClient`)
- SSE (Server-Sent Events) via existing `SSEParser`

---

## 1. Global SSE Connection

### New module: `src/client/global-sse.ts`

Manages a persistent SSE connection to `GET /events/stream`.

**Event types received from backend:**

| Event | Payload | Plugin action |
|-------|---------|---------------|
| `heartbeat` | `{ timestamp }` | Reset 12s liveness timer, mark online |
| `execution_started` | `{ execution_id, agent_name, trigger }` | Add to `store.running`, open per-execution SSE |
| `execution_completed` | `{ execution_id, agent_name, status, duration_ms }` | Call `store.completeExecution()` |
| `agents_changed` | `{ event, agent_name }` | Fetch `GET /agents`, update `store.setAgents()` |
| `scheduler_changed` | `{ status }` | Emit Obsidian `Notice` ("Scheduler paused"/"Scheduler resumed") |

**Reconnection strategy:**

1. SSE connection drops → attempt reconnect with exponential backoff: 2s, 4s, 8s, 16s, 30s (max)
2. After **5 consecutive reconnection failures** → activate polling fallback
3. Continue reconnection attempts even while polling fallback is active
4. On successful reconnect → stop polling fallback, sync state via REST:
   - Fetch `GET /agents` → update store
   - Fetch `GET /executions?status=running` → update store, subscribe to per-execution SSE for any new running executions

**Interface:**

```ts
class GlobalSSEConnection {
  start(): void           // opens SSE connection
  stop(): void            // closes SSE + stops polling fallback
  isConnected(): boolean  // true if SSE is active
  onStateChanged(cb: (state: "connected" | "reconnecting" | "fallback" | "offline") => () => void): () => void
}
```

**Polling fallback (activated after 5 reconnection failures):**

- Poll `GET /health` at the configured poll interval (default 15s)
- Poll `GET /executions?status=running` every 5s
- On health success → attempt SSE reconnect
- If SSE reconnects → stop all fallback polling

### Relationship with per-execution SSE

- Global SSE tells the plugin WHAT is happening (started, completed, agents changed)
- Per-execution SSE (`/executions/{id}/stream`) shows the DETAILS (tool calls, AI responses, final answer)
- Both coexist: global SSE triggers per-execution SSE subscription on `execution_started`

---

## 2. BackendMonitor (refactored)

### File: `src/backend-monitor.ts`

Simplified to consume `GlobalSSEConnection` state instead of polling independently.

**When SSE is connected:**
- Each event (heartbeat or otherwise) resets a 12s liveness timer
- If 12s pass without any event → mark offline, trigger reconnection
- No polling of its own

**When in polling fallback:**
- Poll `/health` at configured interval (existing behavior)
- On health success → attempt SSE reconnect
- If SSE reconnects → stop polling

**Status bar behavior:**

| State | Indicator | Click action |
|-------|-----------|--------------|
| Online (SSE) | `● AgentMD` green, pulsing | Stop backend |
| Online (fallback) | `● AgentMD` amber/orange, steady | Stop backend |
| Offline | `○ AgentMD` gray | Start backend |

---

## 3. BackendLifecycle

### New module: `src/backend-lifecycle.ts`

Handles starting and stopping the agentmd backend from within Obsidian.

**Start:**
1. Execute configured command via `child_process.execFile()` (default: `agentmd` with args `["start", "-d"]`)
2. After exec, poll `/health` every 1s for up to 10s
3. On success → `GlobalSSEConnection` connects automatically via BackendMonitor flow
4. On timeout → show error Notice

**Stop:**
1. `POST /shutdown` via `AgentmdClient`
2. Close global SSE connection
3. Mark offline immediately

**Settings:**

New setting `agentmdPath` (default: `agentmd`). Users whose `agentmd` is not in Obsidian's PATH can set the full path (e.g., `/home/user/.local/bin/agentmd`).

**UI entry points:**

| Entry point | When visible | Action |
|-------------|-------------|--------|
| Status bar click | Offline | Start backend |
| Status bar click | Online | Stop backend |
| Offline screen button | Backend offline | "Start AgentMD" button |
| Command palette | Always | `AgentMD: Start backend` |
| Command palette | Always | `AgentMD: Stop backend` |

---

## 4. LiveView (simplified)

### File: `src/views/live-view.ts`

**Changes:**
- Remove the 2s `setInterval` polling entirely
- On `onOpen()`: fetch `GET /executions?status=running` once to sync initial state
- React to `store.onRunningChanged()` — global SSE updates the store, LiveView re-renders
- Keep 1s tick timer for elapsed time counter display only (no API calls)

**In fallback mode:**
- The `GlobalSSEConnection` fallback polls running executions every 5s and updates the store
- LiveView continues to react to store changes — no awareness of SSE vs polling

---

## 5. Eliminated Timers

| Timer | Current interval | Replaced by |
|-------|-----------------|-------------|
| `bgPollTimer` (detect background executions) | 5s | `execution_started` event from global SSE |
| `agentRefreshTimer` (refresh agent list) | 30s | `agents_changed` event from global SSE |
| LiveView poll | 2s | `execution_started`/`execution_completed` from global SSE |
| BackendMonitor health poll | 15s | `heartbeat` from global SSE (12s timeout) |

All 4 timers are removed from `main.ts`. The only remaining timers are:
- LiveView 1s tick (visual elapsed time only)
- ExecutionDetailView 1s tick (visual elapsed time only)
- GlobalSSEConnection reconnect backoff timer
- Polling fallback timers (only active after 5 SSE reconnection failures)

---

## 6. Plugin Icon

Change the ribbon icon from `cpu` to `bot` (Lucide robot icon, available in Obsidian's icon set).

---

## 7. Settings Update

| Setting | Default | Description |
|---------|---------|-------------|
| Socket path | `~/.local/state/agentmd/agentmd.sock` | Path to Unix socket (existing) |
| Agents directory | `~/agentmd/agents` | Path to agent files (existing) |
| Auto-open on run | On | Open execution detail on run (existing) |
| Notifications | All runs | Notice on completion (existing) |
| Poll interval | 15s | Used only in polling fallback mode (existing) |
| **AgentMD executable** | `agentmd` | Path to CLI executable for start command (new) |

---

## 8. README Documentation

Update README to document:

- The `AgentMD executable` setting: what it is, when to change it, examples for common install locations
- Start/stop commands in the command palette table
- Status bar states (green pulsing = SSE connected, amber = polling fallback, gray = offline)
- That the plugin uses SSE global for real-time updates (architecture section update)
- Troubleshooting: what to do if start button doesn't work (check PATH, set full path in settings)

---

## 9. Views Unchanged

- **ExecutionsView**: fetches on demand with filters — no changes
- **ExecutionDetailView**: per-execution SSE for streaming, API fetch for completed — no changes
- **AgentDetailView**: fetches on demand — no changes
- **AgentsView**: already reacts to store — just remove dependency on agentRefreshTimer

---

## 10. Error Handling

- `child_process.execFile()` failure on start → Notice with error message, log to console
- SSE connection refused → increment reconnection counter, backoff
- `/shutdown` failure → Notice with error, keep current state
- SSE event with unknown type → ignore silently (forward compatibility)
- SSE event with malformed JSON → log warning, skip event
