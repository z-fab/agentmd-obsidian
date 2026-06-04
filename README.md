<div align="center">

# agentmd-obsidian

**Obsidian plugin for [AgentMD](https://github.com/z-fab/agentmd)**

Run, monitor, and manage your AI agents directly from Obsidian.

[![Obsidian](https://img.shields.io/badge/Obsidian-plugin-7c3aed)](https://obsidian.md)
[![AgentMD](https://img.shields.io/badge/requires-agentmd%20v0.8+-10b981)](https://github.com/z-fab/agentmd)
[![Desktop Only](https://img.shields.io/badge/platform-desktop%20only-888)](https://obsidian.md)

</div>

---

## What it does

This plugin connects Obsidian to the [agentmd](https://github.com/z-fab/agentmd) HTTP backend via Unix domain socket, turning Obsidian into a visual dashboard for your markdown-first AI agents.

- **Single panel, three tabs** — Agentes, Live, and Histórico all in one place; click any agent or execution to drill into its detail screen
- **Per-agent emoji** — agents declare an optional `icon:` in their frontmatter (e.g. `icon: "📅"`); when omitted, a stable emoji is derived deterministically from the agent name
- **Run agents** with one click — or pass the currently-open note as `$ARGUMENTS`
- **Stream executions live** — watch tool calls, AI responses, and final answers in real-time with animated running state (spinning border + pulsing icon)
- **Browse execution history** in the Histórico tab with status-colored results, status/agent/period filters, and pagination
- **Agent dashboard** — stats, recent runs, configuration, and quick actions
- **Scheduler controls** — pause/resume from the command palette
- **Start/Stop backend** — start or stop agentmd from the command palette or status bar
- **Real-time SSE** — global event stream replaces polling for instant updates
- **Status bar** — green pulsing dot = SSE connected, amber = polling fallback, gray = offline. Click to start/stop.

## Screenshots

### Agentes tab
Alphabetical list of all agents with trigger type (Manual / Scheduled / Watch), model info, per-agent emoji, and one-click run buttons. Running agents show an animated spinning border and pulsing icon. Click any agent card to open its detail screen.

### Live tab
Running executions in real-time. Cards show agent name, trigger source, and elapsed time. Disappear automatically when done.

### Histórico tab
Full execution history with status-colored results (success/failure/cancelled) and filters for status, agent, and period. Click any row to open the execution detail screen.

### Execution detail
Full execution log with tool calls, AI responses, and the final answer rendered as Markdown. Token breakdown (input/output/total) and cost. A "‹ voltar" bar returns to the previous tab.

### Agent detail
Dashboard per agent: stats (runs, success rate, avg duration, total cost), recent executions, and full configuration. A "‹ voltar" bar returns to the Agentes tab.

## Requirements

- **Obsidian** 1.5+ (Desktop only — mobile not supported)
- **[agentmd](https://github.com/z-fab/agentmd)** v0.8.0+ with the HTTP backend running
- **Per-agent `icon:` field** requires agentmd **v0.14.0+**; older backends simply use the name-derived emoji fallback

The plugin communicates via Unix domain socket (`~/.local/state/agentmd/agentmd.sock`), which requires Node.js APIs only available on Desktop.

## Installation

### From source (recommended for now)

```bash
git clone https://github.com/z-fab/agentmd-obsidian.git
cd agentmd-obsidian
npm install
npm run build
```

Copy the build artifacts to your vault:

```bash
VAULT=/path/to/your/vault
mkdir -p "$VAULT/.obsidian/plugins/agentmd-obsidian"
cp main.js manifest.json styles.css "$VAULT/.obsidian/plugins/agentmd-obsidian/"
```

Then in Obsidian: **Settings → Community plugins → Enable "agentmd"**.

### Prerequisites

Make sure the agentmd backend is running:

```bash
agentmd start -d
```

The status bar will show **● AgentMD** with a pulsing green dot when connected.

## Features

### Single panel with tabs and drill-down

The plugin opens a single **AgentMD** panel in the sidebar. It contains three tabs — **Agentes**, **Live**, and **Histórico** — and supports drill-down navigation:

| Tab / Screen | Description |
|---|---|
| **Agentes** | Alphabetical list of all agents. Click a card to open agent detail. ▶ to run, ▶ 📄 to run with current file. Running agents show an animated state. |
| **Live** | Running executions in real-time (updates every second). Shows agent, trigger source, elapsed time. |
| **Histórico** | Full execution history with status-colored results and filters (status, agent, period). |
| **Agent detail** | Dashboard with stats, recent runs, configuration, and action buttons (Run, Run with file, Open source, All executions). |
| **Execution detail** | Live streaming log during execution → completed view with final answer (Markdown), token breakdown, and collapsible tool call log. |

Clicking any agent card or execution row pushes a detail screen onto the navigation stack. A **‹ voltar** bar at the top returns to the originating tab.

> **Migration note**: if you had the old separate Agents / Live / Executions leaves open from a previous version, the plugin detaches them automatically on load and replaces them with the single panel.

### Per-agent emoji

Agents can declare an optional `icon` field in their frontmatter:

```yaml
---
name: my-agent
icon: "📅"
---
```

When `icon` is set (requires agentmd **v0.14.0+**), that emoji is shown in the agent card and detail screen. When omitted — or when using an older backend — the plugin derives a stable emoji from the agent name using a deterministic hash, so the same agent always gets the same emoji.

### Commands (Command Palette)

| Command | Description |
|---------|-------------|
| `Open AgentMD panel` | Show/focus the AgentMD panel (Agentes tab) |
| `Open Live` | Show/focus the AgentMD panel on the Live tab |
| `Open History` | Show/focus the AgentMD panel on the Histórico tab |
| `Run current file through agent…` | Pick an agent and run with the active file |
| `Pause scheduler` | Pause all scheduled agent runs |
| `Resume scheduler` | Resume scheduled agent runs |
| `Start backend` | Start the agentmd daemon |
| `Stop backend` | Gracefully stop the agentmd backend |

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Socket path | `~/.local/state/agentmd/agentmd.sock` | Path to the agentmd Unix socket |
| Agents directory | `~/agentmd/agents` | Path to agent `.md` files (for "Open source") |
| Auto-open on run | On | Open execution detail tab when starting a run |
| Notifications | All runs | Notice on completion: All / Failures only / Off |
| Poll interval | 15s | Fallback polling interval when SSE is unavailable (10–120s) |
| AgentMD executable | `agentmd` | Path to the agentmd CLI for start command |

### Vault as workspace

For the best experience, set your agentmd workspace to your Obsidian vault (or put `agents/` inside it). This way:
- Agent `.md` files are regular vault notes you edit with Obsidian's full editor
- "Open source" button opens the agent file in a native Obsidian tab
- You get frontmatter editing, live preview, wikilinks — all Obsidian features

If the workspace is elsewhere, everything still works — "Open source" will reveal the file in your system file manager instead.

## Architecture

The plugin is 100% API-driven. Every view fetches data from the agentmd HTTP backend (source of truth). No data is cached locally except for real-time SSE streaming during active executions.

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

- **Transport**: Unix domain socket + SSE (global event stream for real-time, per-execution for streaming logs)
- **Protocol**: REST (JSON) + SSE (Server-Sent Events for live streaming)
- **Views**: Single `PanelView` (`ItemView` subclass) with tab + stack-based navigation (no UI framework)
- **State**: API-first — views poll or fetch on demand; EventStore holds live state pushed via SSE

## Development

```bash
# Clone and install
git clone https://github.com/z-fab/agentmd-obsidian.git
cd agentmd-obsidian
npm install

# Development (watch mode)
npm run dev

# Production build
npm run build

# Run tests
npm test

# Type check
npx tsc --noEmit --skipLibCheck
```

### Project structure

```
main.ts                          Plugin entry point
src/
  client/
    agentmd-client.ts            HTTP client over Unix socket
    sse-parser.ts                SSE text stream parser
    global-sse.ts                Global SSE connection manager
  store/
    event-store.ts               Reactive state (agents, running, history)
  views/
    constants.ts                 Shared view-type constant
    nav.ts                       Navigation state reducer (tab + stack)
    panel-view.ts                Single panel: tab bar, back bar, screen dispatch
    screens/
      agents-screen.ts           Agentes tab: agent card list
      live-screen.ts             Live tab: running executions
      history-screen.ts          Histórico tab: execution history with filters
      agent-detail-screen.ts     Agent detail drill-down screen
      execution-detail-screen.ts Execution detail drill-down screen
  ui/
    agent-emoji.ts               Per-agent emoji resolution (icon field or name hash)
    cards.ts                     DOM card/chip/button helpers
    format.ts                    Formatting utilities
  settings.ts                   Settings interface + defaults
  settings-tab.ts                Settings UI
  backend-monitor.ts             SSE-driven health monitoring with fallback
  backend-lifecycle.ts           Start/stop backend from UI
```

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

### Old separate panels still open after upgrade

The plugin automatically detaches any leaves from the old per-panel view types (`agentmd-agents`, `agentmd-live`, `agentmd-executions`, etc.) when the workspace layout loads. If stale panels persist, close Obsidian, remove those leaf entries from `.obsidian/workspace.json`, and reopen.

## Roadmap

- [ ] Chat mode (multi-turn conversations with agents)
- [ ] Context menu: "Run agent on this file" in file explorer
- [ ] Frontmatter-driven runs (`agent: foo` in a note triggers direct run)
- [ ] Cost/tokens dashboard in status bar
- [ ] TCP transport for mobile support

## License

MIT
