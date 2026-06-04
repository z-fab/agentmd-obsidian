<div align="center">

# Agentmd

**Obsidian plugin for [agentmd](https://github.com/z-fab/agentmd)**

Run, monitor, and manage your AI agents directly from Obsidian.

[![Obsidian](https://img.shields.io/badge/Obsidian-plugin-7c3aed)](https://obsidian.md)
[![agentmd](https://img.shields.io/badge/requires-agentmd%20v0.14.0+-10b981)](https://github.com/z-fab/agentmd)
[![Desktop Only](https://img.shields.io/badge/platform-desktop%20only-888)](https://obsidian.md)

</div>

---

## What it does

[agentmd](https://github.com/z-fab/agentmd) is a markdown-first runtime for AI agents — each agent is a single `.md` file with YAML frontmatter and a Markdown body. This plugin turns Obsidian into a visual front end for a **local** agentmd backend, so you can browse, run, and observe your agents without leaving your vault.

The plugin connects to a local agentmd instance over a **Unix domain socket**. It never talks to a remote server itself, and it can launch the backend as a local subprocess only when you explicitly ask it to.

## How it connects

- **Transport:** the plugin communicates with agentmd over a Unix domain socket (default `~/.local/state/agentmd/agentmd.sock`, configurable in settings). This requires Node.js APIs that are only available on Obsidian Desktop — hence the plugin is desktop-only.
- **Starting the backend:** the plugin can start agentmd for you, but only when you click the status-bar dot, use the "Start backend" command, or trigger the "Start Agentmd" action. Doing so runs your local `agentmd` CLI (`agentmd start -d`). It does not start anything automatically.
- **Live updates:** while connected, the plugin uses a server-sent-events (SSE) stream from the backend for real-time updates, falling back to periodic health polling when SSE is unavailable.

## Requirements

- **Obsidian** 1.5+ (Desktop only — mobile is not supported)
- **[agentmd](https://github.com/z-fab/agentmd) v0.14.0+** installed and reachable on your machine

## Features

- **Single sidebar panel, three tabs** — Agents, Live, and History, all in one place.
- **Drill-down detail** — click any agent or execution to open its detail screen; a **‹ back** bar returns to the previous tab.
- **Run agents** with one click, or run an agent against the currently open note.
- **Live executions** — running agents show an animated state (spinning border, pulsing icon); the Live tab streams tool calls, AI responses, and final answers in real time.
- **History** — full execution history with status-colored results (success / failure / cancelled) and filters by status, agent, and period.
- **Per-agent emoji** — taken from the agent's `icon:` frontmatter (resolved by agentmd); when absent, the plugin derives a stable emoji from the agent name.
- **Scheduler controls** — pause and resume scheduled runs from the command palette.
- **Backend lifecycle** — start and stop your local agentmd backend from the command palette or the status-bar dot.

## The panel

The plugin adds a single **Agentmd** panel to the sidebar (also reachable via the ribbon bot icon).

| Tab / screen | Description |
|---|---|
| **Agents** | Alphabetical list of all agents with trigger type, model info, and per-agent emoji. Run, or run with the current file. Running agents show an animated state. Click a card to open agent detail. |
| **Live** | Running executions in real time — agent name, trigger source, and elapsed time. |
| **History** | Full execution history with status-colored results and filters (status, agent, period). |
| **Agent detail** | Per-agent dashboard: stats, recent runs, configuration, and quick actions. |
| **Execution detail** | Live streaming log during a run, then the completed view with the final answer (Markdown), token breakdown, and tool-call log. |

A **‹ back** bar at the top of any detail screen returns you to the originating tab.

## Installation

### Manual (current)

The plugin is not yet in the Obsidian community list, so install it manually:

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest GitHub release](https://github.com/z-fab/agentmd/releases).
2. Place all three files in `<vault>/.obsidian/plugins/agentmd/`. The folder name must be `agentmd`.
3. In Obsidian, go to **Settings → Community plugins** and enable **Agentmd**.

### Community plugins (once approved)

When the plugin is accepted into the community list, you'll be able to install it from **Settings → Community plugins → Browse** by searching for **Agentmd**.

## Setting up agentmd

The plugin requires a local agentmd backend (v0.14.0+).

1. Install agentmd by following the instructions in the [agentmd repository](https://github.com/z-fab/agentmd).
2. Start the backend, either by running it yourself:
   ```bash
   agentmd start -d
   ```
   or by clicking the status-bar dot / running the **Start backend** command in Obsidian (this runs your local `agentmd` CLI).

By default the plugin connects to `~/.local/state/agentmd/agentmd.sock`. If your backend listens on a different socket, change the **Socket path** setting (see below).

The status bar shows a dot labeled **Agentmd**: a green dot when connected via SSE, amber when connected via polling fallback, and a hollow gray dot when offline. Click it to start or stop the backend.

## Commands

Available in the command palette:

| Command | Description |
|---|---|
| **Open Agentmd panel** | Show/focus the panel on the Agents tab |
| **Open Live** | Show/focus the panel on the Live tab |
| **Open History** | Show/focus the panel on the History tab |
| **Run current file through agent…** | Run an agent against the active file |
| **Pause scheduler** | Pause all scheduled agent runs |
| **Resume scheduler** | Resume scheduled agent runs |
| **Start backend** | Start the local agentmd backend |
| **Stop backend** | Gracefully stop the agentmd backend |

## Settings

Configure under **Settings → Agentmd**.

| Setting | Default | Description |
|---|---|---|
| **Socket path** | `~/.local/state/agentmd/agentmd.sock` | Absolute path to the agentmd Unix domain socket. |
| **Agents directory** | `~/agentmd/agents` | Absolute path to the directory containing agent `.md` files. Used by the "Open source file" action. |
| **Auto-open execution on run** | On | Open the execution detail screen automatically when you start a run. |
| **Notifications on completion** | All runs | Notice when an execution finishes: All runs / Failures only / Off. |
| **Health poll interval** | 15s | Seconds between health checks when SSE is unavailable (10–120). |
| **Agentmd executable** | `agentmd` | Path to the agentmd CLI, used by the "Start backend" command. Set a full path if `agentmd` is not on Obsidian's PATH. |

## Privacy & permissions

All communication is **local**:

- The plugin connects **only to your own agentmd instance**, over a Unix domain socket on your machine. It does not connect to any external or remote service.
- It does **not** send your vault contents to any external service, and it contains **no telemetry**.
- It can launch a local `agentmd` subprocess (your `agentmd` CLI), but **only when you explicitly start the backend** — via the status-bar dot or the "Start backend" command. Nothing is started automatically.

Note: agents you run may themselves call external LLM providers (OpenAI, Anthropic, Google, etc.) through the agentmd backend, according to **your** agentmd configuration. That behavior belongs to the backend you control, not to this plugin.

## Troubleshooting

**Backend offline.** If the status bar shows the gray (offline) dot, the plugin can't reach agentmd. Start the backend (click the dot or run "Start backend"), and confirm the **Socket path** setting matches the socket your backend is actually listening on. If "Start backend" fails, set the **Agentmd executable** setting to the full path of your `agentmd` CLI (find it with `which agentmd`).

**Plugin not loading.** Make sure the plugin folder is named exactly `agentmd` (i.e. `<vault>/.obsidian/plugins/agentmd/`) and contains `main.js`, `manifest.json`, and `styles.css`. Then enable **Agentmd** under Settings → Community plugins.

## Development

```bash
git clone https://github.com/z-fab/agentmd.git
cd agentmd-obsidian
npm install

npm run dev      # watch mode
npm run build    # production build
npm test         # run tests
```

### Project structure

```
main.ts                          Plugin entry point
src/
  client/                        HTTP-over-socket client, SSE parsing/streaming
  store/event-store.ts           Reactive state (agents, running, history)
  views/
    panel-view.ts                Single panel: tab bar, back bar, screen dispatch
    nav.ts                       Navigation state reducer (tab + stack)
    screens/                     Agents / Live / History + agent & execution detail
  ui/                            Emoji resolution, DOM card helpers, formatting
  settings.ts / settings-tab.ts  Settings interface, defaults, and UI
  backend-monitor.ts             SSE-driven health monitoring with fallback
  backend-lifecycle.ts           Start/stop the local backend
```

## License

[MIT](LICENSE) © 2026 Fabricio Zillig
