# agentmd-obsidian plugin — design

**Status:** draft
**Date:** 2026-04-11
**Targets:** agentmd v0.8.0+ (HTTP backend), Obsidian 1.5+ (Desktop)

## Overview

An Obsidian plugin that turns Obsidian into the primary interface for running
and observing agentmd agents. The plugin talks to the agentmd HTTP backend over
a Unix domain socket and exposes every day-to-day CLI operation inside Obsidian:
list agents, run them (with the currently-open file as `$ARGUMENTS`), watch
executions stream live, inspect history, and manage the scheduler.

The plugin does **not** modify or depend on changes to agentmd. It treats the
backend as a read/write HTTP service with a stable REST + SSE contract.

## Goals

1. Become more convenient than the CLI for 90% of agentmd usage during a
   normal Obsidian session.
2. Make "run this agent on the note I'm editing" a single click.
3. Show live execution state (tool calls, tokens, cost) without leaving Obsidian.
4. Respect Obsidian idioms: multiple `ItemView`s the user arranges via
   drag-and-drop, status bar integration, command palette, settings tab,
   ribbon icon.
5. Work out-of-the-box on a fresh install: zero configuration when the user
   is on default paths and has the backend running.

## Non-goals (explicit)

- **No subprocess management.** The plugin does not spawn `agentmd start`.
  When the backend is down, the plugin shows instructions but does not start
  it. This may change post-v1.
- **No mobile support.** Unix sockets require Node.js APIs that Obsidian
  mobile does not expose. TCP transport is out of scope for v1.
- **No agent authoring.** The plugin does not create, edit, or delete agent
  files. Agent editing uses Obsidian's native editor (when `vault == workspace`)
  or an external editor (otherwise).
- **No offline read-only mode.** The plugin is useful only when the backend
  is running. When it's down, the UI shows an "offline" state and waits.

## Transport decision: Unix socket only

The agentmd backend exposes its HTTP API over `~/.local/state/agentmd/agentmd.sock`
by default. The plugin uses `http.request({ socketPath, path, method, headers })`
from Node's `http` module — available in Obsidian Desktop because Electron
exposes Node APIs to plugins.

Rationale:
- Zero configuration: no port, no API key, no firewall considerations.
- No authentication needed — filesystem permissions protect the socket.
- Matches the default setup the agentmd CLI uses.

Trade-off: the plugin cannot run on Obsidian mobile (which lacks Node.js).
TCP transport is a post-v1 extension if mobile becomes a priority, which would
also require exposing the backend on the network.

## Workspace-vault relationship

agentmd has a workspace directory (default `~/agentmd`) containing an
`agents/` subdirectory with agent `.md` files. Obsidian has a vault directory.
These may or may not overlap. The plugin supports both configurations.

**Default, recommended setup: `vault == workspace`** (or `agents/` lives inside
the vault). This unlocks a single feature: clicking "Open source file" on an
agent opens the `.md` in Obsidian's native editor with full frontmatter,
preview, and wikilink support.

**Alternative: `vault ≠ workspace`.** Everything else still works because it's
all mediated by the HTTP API. The "Open source file" button falls back to
`shell.showItemInFolder` (reveal in Finder/Explorer) or `shell.openPath`
(open in default external app).

The plugin detects the relationship at startup by calling `GET /info` and
comparing the backend's workspace path against the current vault path. The
detection is cached until the user reloads the plugin.

Users with `vault ≠ workspace` who want agents to read the currently-open
file must configure a `paths:` alias in the agent's frontmatter (e.g.
`vault: /path/to/vault`) and reference it as `{vault}/...` in tool calls.
This is an agent-level concern, not a plugin concern.

## Backend lifecycle

The plugin does not manage the `agentmd` process. It assumes the user runs
`agentmd start -d` in their terminal when they want to use the plugin.

**Status monitoring.** A `BackendMonitor` polls `GET /health` every 15 seconds
while Obsidian is open. The result drives a status bar item that always shows
the current state:

- `● agentmd · online` — polling succeeded within the last interval
- `● agentmd · offline` — three consecutive polls failed, or the initial
  connect failed

**Backoff on failure.** After the plugin detects offline, polling backs off:
5s → 10s → 30s → 60s (cap). Any user action (clicking an agent, running,
opening a view) triggers an immediate probe regardless of the backoff schedule.

**Idle timeout interaction.** agentmd's backend idles out after 5 minutes of
no activity by default. Polling `/health` every 15s counts as activity, so as
long as Obsidian is open the backend stays alive. This matches the intended
"Obsidian is my agentmd interface" model. When Obsidian closes, polling stops,
and the backend idles out normally.

**Configurable escape.** A setting lets power users disable "keep alive while
Obsidian open" by flipping "Only poll when plugin views are visible" to ON.
When no plugin view is visible, polling stops and the backend is allowed to
idle out.

## Architecture

### Module layout

```
main.ts                         ← plugin entry; registers views, commands, settings
src/
  client/
    agentmd-client.ts           ← HTTP client over Unix socket
    sse-stream.ts               ← SSE parser with catchup + live dedup
  store/
    event-store.ts              ← reactive in-memory state
  backend-monitor.ts            ← /health polling + status bar
  views/
    agents-view.ts              ← sidebar ItemView (agent list)
    live-view.ts                ← sidebar ItemView (running executions)
    executions-view.ts          ← sidebar ItemView (history, filters)
    agent-detail-view.ts        ← main-area ItemView (agent dashboard)
    execution-detail-view.ts    ← main-area ItemView (live or completed)
  settings/
    settings-store.ts
    settings-tab.ts
  ui/
    components/                 ← shared chips, cards, lists, icons
styles.css                      ← color tokens + layout
manifest.json
```

### Component responsibilities

**`AgentmdClient`** — low-level HTTP client. Single responsibility: issue
requests over a Unix socket and return parsed JSON (or throw). Knows nothing
about UI or state.

- `get(path)`, `post(path, body)`, `del(path)` — typed request methods
- `openSSE(path)` — returns a readable event stream (see `sse-stream.ts`)
- Configurable socket path from settings

**`sse-stream.ts`** — small module that consumes a chunked HTTP response body
and yields typed events (`message`, `tool_call`, `tool_result`, `ai`,
`final_answer`, `complete`). Handles:

- Mid-stream reconnection (retry once on drop)
- Catchup dedup: the backend replays persisted events when a stream opens,
  then switches to live. The parser tags events by origin and the EventStore
  dedups by `(execution_id, event_seq)`.
- Fallback: if reconnect fails, caller can switch to polling
  `GET /executions/{id}` every 2s until status transitions to terminal.

**`EventStore`** — in-memory reactive state. One source of truth for:

- `agents: Map<string, AgentDetail>` — from `GET /agents` + detail fetches
- `running: Map<execution_id, RunningExecution>` — currently executing, fed by SSE
- `history: Execution[]` — finished executions (paginated)
- Observers: views subscribe to slices and re-render on change.

Implementation: can start with plain event emitters or Svelte stores; picked
in the implementation plan.

**`BackendMonitor`** — polling + status bar. Owns the `/health` lifecycle
and exposes a single `online: boolean` observable. Reacts to a user action
dispatcher (EventStore emits an "activity" signal on any user action to
trigger an immediate probe when offline).

**Views.** Each view is an Obsidian `ItemView` subclass. Views observe the
EventStore and the BackendMonitor. Views do not call the client directly for
anything except triggering actions (run, cancel, reload); read flows through
the store. Each view has a fixed `getViewType()` so Obsidian can restore
them from workspace state.

**Settings.** `AgentmdSettingTab` extends Obsidian's `PluginSettingTab` and
edits a `SettingsStore` persisted via `plugin.loadData` / `saveData`.

### Data flow

**Startup**

1. `onload()` loads settings, constructs `AgentmdClient` with the socket path.
2. `BackendMonitor` starts polling.
3. Plugin registers the five views, the settings tab, commands, and the
   ribbon icon.
4. Default layout on first install: the three sidebar views (Agents, Live,
   Executions) are placed in the right sidebar in that order. Subsequent
   launches restore whatever layout the user chose.
5. On the first successful `/health`, EventStore fetches `GET /agents` and
   `GET /executions?limit=50`.

**Running an agent (manual)**

1. User clicks `▶ Run` on an agent card in AgentsView.
2. View calls `client.runAgent('research')` (no args) or
   `client.runAgent('research', { args: [currentFilePath] })` for the
   "run with current file" button.
3. Client `POST /agents/research/run` returns `{execution_id}`.
4. EventStore creates a RunningExecution entry, LiveView re-renders with
   the new card.
5. Plugin calls `client.openSSE('/executions/{id}/stream')`. The SSE parser
   pushes events into EventStore as they arrive.
6. If `settings.autoOpenOnRun` is ON, the plugin calls
   `workspace.getLeaf('tab').open(ExecutionDetailView, { executionId })` to
   open the detail tab.
7. Every SSE event updates RunningExecution and observing views re-render.
8. On `complete` event, EventStore moves the execution from `running` to
   `history`. LiveView removes the card. ExecutionsView gains a new entry.
   ExecutionDetailView transitions from "streaming" mode to "completed log"
   mode (header recolors by status, final answer highlighted, Cancel → Re-run).
9. A `Notice` fires based on `settings.notifications`:
   `All runs` → always, `Failures only` → only on `failed`/`aborted`,
   `Off` → never.

**Running an agent from another trigger source (scheduler, watch).** The
scheduler or watcher inside agentmd triggers a run. The plugin detects it via:

- EventStore polling: not great, too laggy.
- Better: when starting, the plugin subscribes to SSE on all running
  executions returned by `GET /executions?status=running`, and periodically
  (every 5s) re-fetches `GET /executions?status=running` to pick up newly
  started background executions, then opens an SSE stream for each new one.

If the backend exposes a global event stream in a future version, the plugin
switches to that. For v1, the poll-and-subscribe pattern is sufficient.

**Cancelling a run**

1. User clicks `✕` on a live card or `■ Cancel` on the ExecutionDetailView.
2. Plugin calls `client.cancelExecution(id)` (`DELETE /executions/{id}`).
3. The SSE stream emits `complete` with a cancelled status. Flow continues
   as a normal completion.

**Backend goes offline**

1. BackendMonitor detects three consecutive `/health` failures.
2. Status bar flips to `● agentmd · offline`.
3. All views show a dismissible banner at the top: "Backend offline.
   Run `agentmd start -d` in your terminal. [Copy command]".
4. Running SSE streams receive `onerror`. Affected running entries in the
   EventStore are marked "disconnected" (distinct from "completed"). The
   LiveView shows them with a dim, dashed outline and a "reconnect" icon.
5. When the backend comes back, BackendMonitor flips online; the plugin
   re-subscribes to running executions and the dim state clears.

## Views

### Agents view (sidebar)

Spacious cards, alphabetical, one flat list.

**Per-card content** (top to bottom):
- Row 1: name (bold) · trigger chip · `⋯` menu
- Row 2: description (first line of the `description` frontmatter field, or empty)
- Row 3: model chip (`provider · shortname`) · `▶ Run` · `▶ 📄 Run w/ current file`

**Trigger chip content:**
- `Manual` (gray) — if trigger type is `manual` or missing
- `⏱ every 1h · in 42m` (yellow) — schedule with relative time to next_run
- `👁 watch inbox/` (cyan) — file watcher with path

**Running state:** when an agent is currently executing, the card gets a
2px blue left border + subtle blue gradient tint on the background, the
trigger chip swaps to `● Running · 23s` (blue), and the Run buttons are
disabled. Multiple concurrent runs for the same agent increment a counter
(`● Running · 2 active`).

**Interactions:**
- Click card body or name → opens AgentDetailView in a main-area tab
- Click `▶ Run` → runs with no args
- Click `▶ 📄 Run with <file>` → runs with the currently-open file's
  **absolute filesystem path** as a single positional argument (mapped to
  `$ARGUMENTS` / `$0` by agentmd). Absolute path is chosen so the argument
  works identically whether `vault == workspace` or not — the agent sees a
  path it can pass directly to `file_read` regardless of its sandbox config.
- Hover `▶ 📄` → tooltip shows the vault-relative path for readability,
  while the argument passed is absolute
- When no file is open, `▶ 📄` is disabled with tooltip "Open a note first"
- Click `⋯` → menu: Open source file, View executions, Copy run command

**Header:** `◆ Agents  [count]  ⟳`. The `⟳` button calls
`GET /agents` to refresh the list (distinct from `POST /agents/reload`
which re-parses files on the server — that's out of v1 scope).

### Live view (sidebar)

Calm, neutral cards for in-flight executions — one per running execution.

**Per-card content:**
- Row 1: `●` (blue, status=running) · name (bold) · `#id` · trigger origin
  text (colored) · `✕` cancel icon
- Row 2: last tool call or current AI message, truncated, monospace, dim
- Row 3: elapsed time · tokens · cost (grows live)

**Trigger origin text** is the only colored element besides the `●`:
- `· manual` in gray
- `· scheduler` in yellow
- `· watch inbox/` in cyan

No colored borders, no colored backgrounds, no tint. The view itself conveys
"all of these are running" — per-card color would be redundant.

**Interactions:**
- Click card → open ExecutionDetailView in main-area tab (streaming mode)
- Click `✕` → cancel execution (with confirm dialog)

**Ordering:** most recently started at the top.

**Empty state:** "No running executions. Click ▶ on an agent to start one."

### Executions view (sidebar)

Filterable history of all executions.

**Header:** `◆ Executions  [total count]  ⟳`

**Filter row** (three chips):
- Status: `All` / `Success` / `Failed` / `Aborted` / `Running`
- Agent: `All agents` / specific agent picked from a suggester
- Period: `Today` (default) / `7 days` / `30 days` / `All`

Filters combine with AND. They translate to query params on
`GET /executions?status=...&agent=...&limit=...&offset=...`. The "period"
filter is client-side: the backend doesn't expose a date filter in v0.8.0,
so the plugin fetches with a generous `limit` (300) and filters by
`started_at` locally. This is acceptable for v1 given typical volumes
(normal users have well under 300 executions in a 30-day window). If
execution volume grows, the fix is either a backend date filter or a
server-side date-index — both out of scope here.

**Per-row content:**
- Row 1: status icon · agent name (bold) · `#id` · optional error tag
  (`tool_error`, `aborted · cost cap`) · relative time (right-aligned)
- Row 2: optional trigger origin icon (`⏱` or `👁`, gray when present, omitted
  when manual) · duration · tokens · cost

**Status icons:** ✓ green (success), ✗ red (failed), ⚠ amber (aborted), ● blue
(running). Running executions appear here too and stay in sync via the same
SSE streams driving LiveView.

**Pagination:** "Load 20 more" footer. Fetches the next page via `offset`.

**Interactions:**
- Click row → open ExecutionDetailView in main-area tab
- Right-click → context menu (Copy id, Re-run this agent, View agent)

### Agent Detail view (main-area tab)

Dashboard per agent. Always a custom view — never delegates to the native
`.md` editor. The "Open source file" button is how the user jumps to the
native editor (when available).

**Sticky header:**
- Name (large) · trigger chip · model chip
- Description (two lines max, ellipsis)
- Button row: `▶ Run` · `▶ 📄 Run with <current file>` · `📝 Open source` ·
  `📊 All executions` · `⋯` (right-aligned)
- `📝 Open source` dual mode:
  - `vault == workspace` and file is located in the vault: opens the `.md`
    as a native Obsidian tab
  - otherwise: `shell.showItemInFolder(absolutePath)` with a Notice
    "Source file is outside the vault — revealed in Finder"
- `📊 All executions` opens the ExecutionsView with the agent filter pre-set
  to this agent

**Stats row** (4 cards, neutral styling — no status-color leakage):
- `Runs` — total count
- `Success` — percentage; the value text (not the card) turns amber below 80% and red below 50%
- `Avg duration` — seconds
- `Total spent` — USD

All stats aggregate across the agent's history from `GET /agents/{name}/runs`.
Card chrome uses `var(--background-secondary)`; the only semantic color is on
the success-rate value when it crosses thresholds.

**Recent executions** (5 rows, same row format as ExecutionsView):
- "showing 5 of {total}" with a "view all" link
- Click a row → opens ExecutionDetailView for that execution

**Configuration** section (collapsible subsections):
- `Trigger` — expanded by default for scheduled/watch agents, collapsed for manual
- `Model` — `provider/full-name`
- `Paths` — alias table when present
- `Tools` — comma list, truncated with `+N more`
- `MCP servers` — comma list
- `Limits` — `max_tool_calls`, `max_execution_tokens`, `max_cost_usd`

Each collapsed row shows a one-line summary on the right so the user can scan
without expanding.

**System prompt** section: the agent's prompt body rendered as markdown
(read-only), with `$ARGUMENTS`, `$0`, `$1`, and `{alias}` references
syntax-highlighted in the brand color.

### Execution Detail view (main-area tab)

Single component, two modes driven by execution status.

**Streaming mode** (status = running):
- Header background tinted blue
- Title row: `●` · agent name · `#id` · `■ Cancel` button (right)
- Meta row: `args: <joined>` (if any)
- Stats row: `● running` · elapsed · tokens · cost (live)
- Body: full live log — each SSE event rendered as a line with icons and
  colors matching the CLI output (`🔧 >>` for tool calls, `📎 <<` for tool
  results, `🤖` for AI messages). Ending cursor `▌` while streaming.

**Completed log mode** (status ∈ success/failed/aborted/orphaned):
- Header background tinted by status color (green/red/amber)
- Title row: status icon · agent name · `#id` · `↻ Re-run` button (right)
- Meta row: same as streaming
- Stats row: `✓ success` (or equivalent) · total duration · tokens · cost
- **Final answer box** at the top, tinted by status — the `final_answer`
  event content rendered as markdown, highlighted. This is what the user
  usually came to see.
- **Timeline** section (collapsible, collapsed by default): the full tool
  call + tool result sequence in monospace.

The same view is used for both modes; when a streaming execution completes,
the component re-renders as completed-log in place without closing the tab.

**Re-run** fires `client.runAgent(agentName, { args: originalArgs })` — same
agent, same arguments. Opens a new ExecutionDetailView tab for the new run,
leaving the old one as history.

## Color system

Defined once in `styles.css` as CSS custom properties under `:root`:

```css
:root {
  /* Status (execution lifecycle) */
  --agentmd-running:  #3b82f6;  /* blue  */
  --agentmd-success:  #10b981;  /* green */
  --agentmd-failed:   #ef4444;  /* red   */
  --agentmd-aborted:  #f59e0b;  /* amber */
  /* Trigger origin */
  --agentmd-manual:    #888888; /* gray  */
  --agentmd-scheduler: #fbbf24; /* yellow*/
  --agentmd-watch:     #06b6d4; /* cyan  */
  /* Brand */
  --agentmd-brand:     #8b5cf6; /* purple */
}
```

**Invariants:**
1. Each color has exactly one meaning.
2. Status and trigger colors never compete in the same view:
   - Live view uses only trigger colors (plus the `●` blue dot indicating
     "running" universally)
   - Executions view uses only status colors (plus optional gray trigger icons)
   - Agent Detail view chips reflect status when the agent is running,
     trigger type when idle; the header background stays neutral
3. Purple is reserved for plugin chrome (view icons, primary buttons). It
   never indicates status or trigger.

The tokens reference Obsidian's own variables when semantically equivalent
(e.g., `var(--background-primary)`, `var(--text-muted)`) so the plugin
respects the active Obsidian theme.

## Settings

Four fields, one tab in Obsidian's settings pane.

1. **Socket path** — text input
   - Default: `~/.local/state/agentmd/agentmd.sock`
   - Validation: warns if path doesn't exist at save time, does not block

2. **Auto-open Execution Detail on run** — toggle
   - Default: ON
   - When ON, clicking `▶ Run` also opens the detail tab
   - When OFF, runs stay in the LiveView until the user clicks

3. **Notifications on completion** — dropdown
   - Options: `All runs` (default) / `Failures only` / `Off`
   - A `new Notice(...)` fires at the matched threshold

4. **Poll interval when idle** — number input (seconds) + sub-toggle
   - Default: 15 seconds
   - Range: 10–120
   - Sub-toggle "Only poll when plugin views are visible" (default OFF)

## Commands (command palette)

- `Agentmd: Open Agents panel`
- `Agentmd: Open Live panel`
- `Agentmd: Open Executions panel`
- `Agentmd: Run current file through agent…` — opens an agent suggester
  and runs the chosen agent with the active file as `$ARGUMENTS`
- `Agentmd: Pause scheduler`
- `Agentmd: Resume scheduler`

Not in v1: a per-agent `Run <agent-name>` command (would bloat the palette),
reload agents, chat mode.

## Ribbon icon

A single ribbon entry on the left ribbon with a `◆` icon in the brand color.
Click reveals or focuses the Agents view. Tooltip: `Agentmd`.

## Error handling

| Error | Behavior |
|---|---|
| Initial socket connect fails | Status bar `offline`; views show offline banner; backoff polling; views remain responsive (empty state) |
| API call returns 4xx/5xx | `Notice` with the response body; UI state unchanged (no partial updates) |
| SSE stream drops mid-run | Retry once immediately; on second failure, switch to polling `GET /executions/{id}` every 2s until terminal status or user navigates away |
| SSE catchup replays events already seen | Deduped by `(execution_id, event_seq)` |
| Agent `.md` file not found when clicking "Open source" | Fallback to `shell.showItemInFolder` on the absolute path from `GET /agents/{name}` |
| "Run with current file" clicked with no active file | Button is disabled at render time; tooltip explains |
| User cancels an execution that has already finished | No-op; `DELETE /executions/{id}` returns 404, Notice suppressed |
| Plugin loads with stale saved workspace state referencing a now-invalid execution | Execution Detail tab shows "Execution not found" with a button to close |

## Testing strategy

**Unit tests** (must-have for v1):
- `AgentmdClient`: mocks a Unix socket server, asserts request construction
  and response parsing across all endpoints
- `sse-stream`: feeds canned event streams, asserts parsed output including
  multi-line events, dedup behavior, and drop-and-reconnect
- `EventStore`: asserts state transitions for run start, live updates,
  complete, cancel

**Integration tests** (nice-to-have for v1):
- Runs against a real `agentmd` backend started from a fixture workspace,
  exercising the full flow of a run and SSE stream

**Manual QA checklist** (must-have before release):
- Each view renders correctly in empty, loading, populated, and error states
- Running flow: click ▶, tab opens, stream arrives, completion transitions
- Run with current file: path is correctly passed
- Cancel mid-run
- Backend offline scenarios: initial, mid-run, transient drop
- Dual mode "Open source": both `vault == workspace` and `vault ≠ workspace`
- Each setting actually changes behavior
- Theme changes reflect across all views (respecting Obsidian variables)

## In scope for v1 (14 features)

Green foundation (sine qua non):
1. Socket connect + status bar online/offline
2. List agents (`GET /agents`)
3. Run an agent without args
4. List recent executions

Yellow core promise (the point of the plugin):
5. Sidebar Agents view with cards and play buttons
6. Run with currently-open file as `$ARGUMENTS`
7. Live execution view via SSE
8. Open agent `.md` (dual mode: native editor or reveal in finder)
9. Cancel running execution
10. Notifications (Notice) on completion based on settings

Blue polish included (numbering preserved from the brainstorm's long feature
list; gaps correspond to items explicitly deferred — see "Out of v1" below):
11. Full executions history view with status + agent + period filters
12. Scheduler pause/resume + `next_run` visible on agent cards
13. Full execution message log in completed-mode tab
16. Ribbon icon

## Out of v1 (explicit)

- Reload agents (`POST /agents/reload`)
- Per-agent commands in command palette
- Frontmatter-driven runs (nota with `agent: foo` triggers direct run)
- Chat view (multi-turn conversations)
- Context menu on file explorer entries
- Cost/tokens accumulated widget in status bar
- Creating or editing agents from the plugin
- Graph visualization of LangGraph execution state
- Diff between runs
- TCP transport / mobile support

## Open questions

None blocking implementation. A few known unknowns to resolve during plan
writing:

- Exact reactive store library (plain emitters vs. a small store lib) —
  evaluated in the implementation plan
- SSE parser: hand-rolled vs. small dependency (`eventsource-parser`) —
  evaluated in the implementation plan
- Default ribbon icon glyph — placeholder `◆`, refined with a proper icon
  pack during implementation
