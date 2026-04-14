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

- **List agents** with trigger type, model, and description
- **Run agents** with one click — or pass the currently-open note as `$ARGUMENTS`
- **Stream executions live** — watch tool calls, AI responses, and final answers in real-time
- **Browse execution history** with status, agent, and period filters
- **Agent dashboard** — stats, recent runs, configuration, and quick actions
- **Scheduler controls** — pause/resume from the command palette
- **Start/Stop backend** — start or stop agentmd from the command palette or status bar
- **Real-time SSE** — global event stream replaces polling for instant updates
- **Status bar** — green pulsing dot = SSE connected, amber = polling fallback, gray = offline. Click to start/stop.

## Screenshots

### Agents panel
List all your agents with trigger type (Manual / Scheduled / Watch), model info, and one-click run buttons.

### Live view
See running executions in real-time. Cards show agent name, trigger source, and elapsed time. Disappear automatically when done.

### Execution detail
Full execution log with tool calls, AI responses, and the final answer rendered as Markdown. Token breakdown (input/output/total) and cost.

### Agent detail
Dashboard per agent: stats (runs, success rate, avg duration, total cost), recent executions, and full configuration.

## Requirements

- **Obsidian** 1.5+ (Desktop only — mobile not supported)
- **[agentmd](https://github.com/z-fab/agentmd)** v0.8.0+ with the HTTP backend running

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

### Sidebar views

| View | Description |
|------|-------------|
| **Agents** | Alphabetical list of all agents. Click to open detail view. ▶ to run, ▶📄 to run with current file. |
| **Live** | Running executions in real-time (polls API every 2s). Shows agent, trigger source, elapsed time. |
| **Executions** | Full execution history with filters (status, agent, period) and pagination. |

### Main area views

| View | Description |
|------|-------------|
| **Execution Detail** | Live streaming log during execution → completed view with final answer (Markdown), token breakdown, and collapsible tool call log. |
| **Agent Detail** | Dashboard with stats, recent runs, configuration, and action buttons (Run, Run with file, Open source, All executions). |

### Commands (Command Palette)

| Command | Description |
|---------|-------------|
| `Open Agents panel` | Show/focus the Agents sidebar |
| `Open Live panel` | Show/focus the Live sidebar |
| `Open Executions panel` | Show/focus the Executions sidebar |
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
- **Views**: Vanilla DOM `ItemView` subclasses (no UI framework)
- **State**: API-first — views poll or fetch on demand

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
    agents-view.ts               Sidebar: agent list
    live-view.ts                 Sidebar: running executions
    executions-view.ts           Sidebar: execution history
    agent-detail-view.ts         Main tab: agent dashboard
    execution-detail-view.ts     Main tab: execution log
  settings.ts                   Settings interface + defaults
  settings-tab.ts                Settings UI
  backend-monitor.ts             SSE-driven health monitoring with fallback
  backend-lifecycle.ts           Start/stop backend from UI
  ui/format.ts                   Formatting utilities
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

## Roadmap

- [ ] Chat mode (multi-turn conversations with agents)
- [ ] Context menu: "Run agent on this file" in file explorer
- [ ] Frontmatter-driven runs (`agent: foo` in a note triggers direct run)
- [ ] Cost/tokens dashboard in status bar
- [ ] TCP transport for mobile support
- [ ] Global SSE stream (replace polling with real-time events)

## License

MIT
