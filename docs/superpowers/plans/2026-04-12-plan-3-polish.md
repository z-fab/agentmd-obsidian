# Plan 3 · Polish & Remaining Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the v1 feature set: ExecutionsView with filters, AgentDetailView dashboard, Settings tab UI, scheduler controls, offline banners, and "open source file" dual mode.

**Architecture:** Adds two new views (ExecutionsView sidebar, AgentDetailView main-area tab), extends the client with 5 new API methods, wires agent card clicks to the detail view, and adds the first Obsidian `PluginSettingTab`. Follows the same patterns established in Plan 2: views observe EventStore, actions flow through main.ts, no UI framework.

**Tech Stack:** Same as Plan 2. New Obsidian APIs: `PluginSettingTab`, `Setting`, `MarkdownRenderer`, `FuzzyMatch`.

**Builds on:** Plan 1 (foundation) + Plan 2 (core run flow) + bug fixes

**Reference spec:** `docs/superpowers/specs/2026-04-11-agentmd-obsidian-plugin-design.md`

**Reference API (verified from actual source):**
- `GET /agents/{name}` → `AgentDetail` (extends AgentSummary with last_run, next_run, history, settings dict)
- `GET /agents/{name}/runs?limit=N` → `ExecutionSummary[]`
- `GET /scheduler` → `SchedulerStatus` (status + jobs with next_run)
- `POST /scheduler/pause` → `{status: "paused"}`
- `POST /scheduler/resume` → `{status: "running"}`

---

## File map

```
src/
  types.ts                          ← MODIFY: add AgentDetail if not present (already added in Plan 2 type fix)
  client/
    agentmd-client.ts               ← MODIFY: add getAgent, getAgentRuns, getScheduler, pauseScheduler, resumeScheduler
  settings.ts                      ← MODIFY: add agentsDir field + defaults
  views/
    constants.ts                   ← MODIFY: add VIEW_TYPE_EXECUTIONS, VIEW_TYPE_AGENT_DETAIL
    executions-view.ts              ← CREATE: sidebar ItemView (filterable history)
    agent-detail-view.ts            ← CREATE: main-area ItemView (agent dashboard)
    agents-view.ts                  ← MODIFY: wire card click → open agent detail
    live-view.ts                    ← MODIFY: add offline banner
  settings-tab.ts                  ← CREATE: PluginSettingTab with full UI
main.ts                             ← MODIFY: register new views, commands, settings tab, scheduler controls
styles.css                          ← MODIFY: add executions + agent detail styles
tests/
  client/
    agentmd-client.test.ts          ← MODIFY: tests for new methods
```

---

## Task 1: Client — new API methods

**Files:**
- Modify: `src/client/agentmd-client.ts`
- Modify: `tests/client/agentmd-client.test.ts`

Add 5 typed wrapper methods. All are thin one-liners like the existing ones.

- [ ] **Step 1: Add imports and methods to `agentmd-client.ts`**

Update the type import at the top:

```typescript
import type { AgentDetail, AgentSummary, ExecutionSummary, InfoResponse, ParsedSSEEvent, RunRequest, SchedulerStatus } from "../types";
```

Add after `listExecutions()`:

```typescript
  /** Fetches a single agent's full detail (config + last_run + next_run). */
  async getAgent(name: string): Promise<AgentDetail> {
    return this.get<AgentDetail>(`/agents/${encodeURIComponent(name)}`);
  }

  /** Fetches execution history for a specific agent. */
  async getAgentRuns(name: string, limit = 10): Promise<ExecutionSummary[]> {
    return this.get<ExecutionSummary[]>(`/agents/${encodeURIComponent(name)}/runs?limit=${limit}`);
  }

  /** Fetches scheduler status and jobs. */
  async getScheduler(): Promise<SchedulerStatus> {
    return this.get<SchedulerStatus>("/scheduler");
  }

  /** Pauses the scheduler. */
  async pauseScheduler(): Promise<void> {
    await this.post("/scheduler/pause");
  }

  /** Resumes the scheduler. */
  async resumeScheduler(): Promise<void> {
    await this.post("/scheduler/resume");
  }
```

- [ ] **Step 2: Write tests**

Append to `tests/client/agentmd-client.test.ts`:

```typescript
describe("AgentmdClient.getAgent()", () => {
  let socketPath: string;
  let server: http.Server;
  beforeEach(() => { socketPath = tempSocketPath(); });
  afterEach(async () => { if (server) await stopServer(server, socketPath); });

  it("fetches agent detail by name", async () => {
    server = await startFakeServer(socketPath, (req, res) => {
      expect(req.url).toBe("/agents/research");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        name: "research",
        description: "Research topics",
        enabled: true,
        trigger_type: "manual",
        model_provider: "anthropic",
        model_name: "claude-sonnet-4-6",
        last_run: "2026-04-11T12:00:00Z",
        next_run: null,
        history: "low",
        settings: { temperature: 0.7, max_tool_calls: 50 },
      }));
    });
    const client = new AgentmdClient({ socketPath });
    const agent = await client.getAgent("research");
    expect(agent.name).toBe("research");
    expect(agent.settings.temperature).toBe(0.7);
    expect(agent.last_run).toBe("2026-04-11T12:00:00Z");
  });
});

describe("AgentmdClient.getAgentRuns()", () => {
  let socketPath: string;
  let server: http.Server;
  beforeEach(() => { socketPath = tempSocketPath(); });
  afterEach(async () => { if (server) await stopServer(server, socketPath); });

  it("fetches runs for a specific agent", async () => {
    server = await startFakeServer(socketPath, (req, res) => {
      expect(req.url).toBe("/agents/research/runs?limit=5");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([
        { id: 1, agent_id: "research", status: "success", trigger: "manual", started_at: "2026-04-11T12:00:00Z" },
      ]));
    });
    const client = new AgentmdClient({ socketPath });
    const runs = await client.getAgentRuns("research", 5);
    expect(runs).toHaveLength(1);
    expect(runs[0].agent_id).toBe("research");
  });
});

describe("AgentmdClient.getScheduler()", () => {
  let socketPath: string;
  let server: http.Server;
  beforeEach(() => { socketPath = tempSocketPath(); });
  afterEach(async () => { if (server) await stopServer(server, socketPath); });

  it("returns scheduler status with jobs", async () => {
    server = await startFakeServer(socketPath, (req, res) => {
      expect(req.url).toBe("/scheduler");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "running",
        jobs: [{ agent_name: "daily", trigger_type: "schedule", next_run: "2026-04-12T13:00:00Z" }],
      }));
    });
    const client = new AgentmdClient({ socketPath });
    const sched = await client.getScheduler();
    expect(sched.status).toBe("running");
    expect(sched.jobs).toHaveLength(1);
    expect(sched.jobs[0].next_run).toBe("2026-04-12T13:00:00Z");
  });
});
```

- [ ] **Step 3: Run tests — all pass**

```bash
npx vitest run tests/client/agentmd-client.test.ts
```

Expected: PASS (16 tests — 13 existing + 3 new).

- [ ] **Step 4: Commit**

```bash
git add src/client/agentmd-client.ts tests/client/agentmd-client.test.ts
git commit -m "feat: client methods for agent detail, agent runs, and scheduler"
```

---

## Task 2: Settings — add agents_dir + Settings tab UI

**Files:**
- Modify: `src/settings.ts`
- Create: `src/settings-tab.ts`

The Settings tab is an Obsidian `PluginSettingTab` with all 5 settings: socket path, agents directory, auto-open on run, notifications, poll interval.

- [ ] **Step 1: Update `src/settings.ts` — add agentsDir**

Replace `src/settings.ts`:

```typescript
export interface AgentmdSettings {
  /** Absolute path to the agentmd Unix domain socket. */
  socketPath: string;
  /** Absolute path to the agents directory (for "Open source file"). */
  agentsDir: string;
  /** Open ExecutionDetailView automatically when a run starts. */
  autoOpenOnRun: boolean;
  /** Notification behavior on execution completion. */
  notifications: "all" | "failures" | "off";
  /** Health poll interval in milliseconds. */
  pollIntervalMs: number;
}

export const DEFAULT_SETTINGS: AgentmdSettings = {
  socketPath: `${typeof process !== "undefined" ? process.env?.HOME ?? "" : ""}/.local/state/agentmd/agentmd.sock`,
  agentsDir: `${typeof process !== "undefined" ? process.env?.HOME ?? "" : ""}/agentmd/agents`,
  autoOpenOnRun: true,
  notifications: "all",
  pollIntervalMs: 15000,
};
```

- [ ] **Step 2: Create `src/settings-tab.ts`**

```typescript
import { App, PluginSettingTab, Setting } from "obsidian";
import type AgentmdPlugin from "../main";
import type { AgentmdSettings } from "./settings";

export class AgentmdSettingTab extends PluginSettingTab {
  private plugin: AgentmdPlugin;

  constructor(app: App, plugin: AgentmdPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "AgentMD Settings" });

    new Setting(containerEl)
      .setName("Socket path")
      .setDesc("Absolute path to the agentmd Unix domain socket.")
      .addText((text) =>
        text
          .setPlaceholder("/path/to/agentmd.sock")
          .setValue(this.plugin.settings.socketPath)
          .onChange(async (value) => {
            this.plugin.settings.socketPath = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Agents directory")
      .setDesc("Absolute path to the directory containing agent .md files. Used for 'Open source file'.")
      .addText((text) =>
        text
          .setPlaceholder("/path/to/agents")
          .setValue(this.plugin.settings.agentsDir)
          .onChange(async (value) => {
            this.plugin.settings.agentsDir = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Auto-open execution on run")
      .setDesc("Open the execution detail tab automatically when you start a run.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoOpenOnRun)
          .onChange(async (value) => {
            this.plugin.settings.autoOpenOnRun = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Notifications on completion")
      .setDesc("When to show a Notice after an execution finishes.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("all", "All runs")
          .addOption("failures", "Failures only")
          .addOption("off", "Off")
          .setValue(this.plugin.settings.notifications)
          .onChange(async (value) => {
            this.plugin.settings.notifications = value as AgentmdSettings["notifications"];
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Health poll interval")
      .setDesc("Seconds between health checks when idle (10–120).")
      .addText((text) =>
        text
          .setPlaceholder("15")
          .setValue(String(this.plugin.settings.pollIntervalMs / 1000))
          .onChange(async (value) => {
            const seconds = Math.max(10, Math.min(120, parseInt(value) || 15));
            this.plugin.settings.pollIntervalMs = seconds * 1000;
            await this.plugin.saveSettings();
          }),
      );
  }
}
```

**Note:** This file imports `AgentmdPlugin` from `../main`. The plugin class needs to expose `settings` and a `saveSettings()` method publicly. These will be wired in Task 8.

- [ ] **Step 3: Verify compilation**

```bash
npx tsc --noEmit --skipLibCheck
```

If there's a type error about `plugin.settings` or `plugin.saveSettings` being private — that's expected; it will be fixed in Task 8 when we update main.ts.

- [ ] **Step 4: Commit**

```bash
git add src/settings.ts src/settings-tab.ts
git commit -m "feat: settings tab UI with all 5 configuration fields"
```

---

## Task 3: View constants + ExecutionsView

**Files:**
- Modify: `src/views/constants.ts`
- Create: `src/views/executions-view.ts`

- [ ] **Step 1: Add new view type constants**

In `src/views/constants.ts`, add:

```typescript
export const VIEW_TYPE_EXECUTIONS = "agentmd-executions";
export const VIEW_TYPE_AGENT_DETAIL = "agentmd-agent-detail";
```

- [ ] **Step 2: Create ExecutionsView**

Create `src/views/executions-view.ts`. This is a sidebar view with three filter chips (status, agent, period) and a paginated list.

```typescript
import { ItemView, WorkspaceLeaf } from "obsidian";
import type { EventStore } from "../store/event-store";
import type { ExecutionSummary } from "../types";
import { VIEW_TYPE_EXECUTIONS } from "./constants";
import { formatDuration, formatTokens, formatCost, formatRelativeTime } from "../ui/format";

export interface ExecutionsViewActions {
  onOpenExecution: (executionId: number) => void;
  onRefreshExecutions: () => void;
  getExecutions: (params: { status?: string; agent?: string; limit: number; offset: number }) => Promise<ExecutionSummary[]>;
}

type StatusFilter = "all" | "success" | "failed" | "aborted";
type PeriodFilter = "today" | "7d" | "30d" | "all";

export class ExecutionsView extends ItemView {
  private store: EventStore;
  private actions: ExecutionsViewActions;
  private unsub: (() => void) | null = null;

  private statusFilter: StatusFilter = "all";
  private agentFilter: string = "all";
  private periodFilter: PeriodFilter = "today";
  private executions: ExecutionSummary[] = [];
  private offset = 0;
  private readonly pageSize = 20;
  private loading = false;

  constructor(leaf: WorkspaceLeaf, store: EventStore, actions: ExecutionsViewActions) {
    super(leaf);
    this.store = store;
    this.actions = actions;
  }

  getViewType(): string { return VIEW_TYPE_EXECUTIONS; }
  getDisplayText(): string { return "Executions"; }
  getIcon(): string { return "list"; }

  async onOpen(): Promise<void> {
    this.unsub = this.store.onHistoryChanged(() => this.render());
    await this.loadExecutions();
  }

  async onClose(): Promise<void> {
    this.unsub?.();
  }

  private async loadExecutions(): Promise<void> {
    this.loading = true;
    this.render();
    try {
      const params: { status?: string; agent?: string; limit: number; offset: number } = {
        limit: this.pageSize,
        offset: this.offset,
      };
      if (this.statusFilter !== "all") params.status = this.statusFilter;
      if (this.agentFilter !== "all") params.agent = this.agentFilter;
      const results = await this.actions.getExecutions(params);
      if (this.offset === 0) {
        this.executions = results;
      } else {
        this.executions = [...this.executions, ...results];
      }
    } catch {
      // offline
    }
    this.loading = false;
    this.render();
  }

  private async applyFilter(): Promise<void> {
    this.offset = 0;
    await this.loadExecutions();
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();

    // Header
    const header = container.createDiv({ cls: "agentmd-view-header" });
    const left = header.createDiv({ cls: "agentmd-header-left" });
    left.createSpan({ cls: "agentmd-view-icon", text: "◆" });
    left.createSpan({ cls: "agentmd-header-title", text: "Executions" });
    if (this.executions.length > 0) {
      left.createSpan({ cls: "agentmd-header-badge", text: String(this.executions.length) });
    }
    const refreshBtn = header.createEl("button", { cls: "agentmd-header-action", text: "↻" });
    refreshBtn.addEventListener("click", () => this.applyFilter());

    // Filter row
    const filters = container.createDiv({ cls: "agentmd-filter-row" });

    // Status filter
    const statusBtn = filters.createEl("button", {
      cls: `agentmd-filter-chip ${this.statusFilter !== "all" ? "active" : ""}`,
      text: this.statusFilter === "all" ? "All status" : this.statusFilter,
    });
    statusBtn.addEventListener("click", () => {
      const order: StatusFilter[] = ["all", "success", "failed", "aborted"];
      const idx = order.indexOf(this.statusFilter);
      this.statusFilter = order[(idx + 1) % order.length];
      void this.applyFilter();
    });

    // Agent filter
    const agentBtn = filters.createEl("button", {
      cls: `agentmd-filter-chip ${this.agentFilter !== "all" ? "active" : ""}`,
      text: this.agentFilter === "all" ? "All agents" : this.agentFilter,
    });
    agentBtn.addEventListener("click", () => {
      const agents = ["all", ...this.store.agents.map((a) => a.name)];
      const idx = agents.indexOf(this.agentFilter);
      this.agentFilter = agents[(idx + 1) % agents.length];
      void this.applyFilter();
    });

    // Period filter
    const periodBtn = filters.createEl("button", {
      cls: `agentmd-filter-chip ${this.periodFilter !== "all" ? "active" : ""}`,
      text: this.periodFilter === "all" ? "All time" : this.periodFilter === "today" ? "Today" : this.periodFilter,
    });
    periodBtn.addEventListener("click", () => {
      const order: PeriodFilter[] = ["today", "7d", "30d", "all"];
      const idx = order.indexOf(this.periodFilter);
      this.periodFilter = order[(idx + 1) % order.length];
      void this.applyFilter();
    });

    // Loading
    if (this.loading) {
      container.createDiv({ cls: "agentmd-empty", text: "Loading…" });
      return;
    }

    // Filter by period (client-side)
    const filtered = this.filterByPeriod(this.executions);

    if (filtered.length === 0) {
      container.createDiv({ cls: "agentmd-empty", text: "No executions found." });
      return;
    }

    // Execution rows
    for (const exec of filtered) {
      this.renderRow(container, exec);
    }

    // Load more button
    if (this.executions.length >= this.offset + this.pageSize) {
      const loadMore = container.createDiv({ cls: "agentmd-load-more" });
      loadMore.createEl("button", { cls: "agentmd-btn", text: "Load 20 more" }).addEventListener("click", () => {
        this.offset += this.pageSize;
        void this.loadExecutions();
      });
    }
  }

  private renderRow(container: HTMLElement, exec: ExecutionSummary): void {
    const row = container.createDiv({ cls: "agentmd-exec-row" });
    row.addEventListener("click", () => this.actions.onOpenExecution(exec.id));

    // Row 1: status icon + agent + #id + error tag + time
    const line1 = row.createDiv({ cls: "exec-row-line1" });
    const statusIcon = exec.status === "success" ? "✓" : exec.status === "failed" || exec.status === "error" ? "✗" : exec.status === "running" ? "●" : "⚠";
    const statusCls = exec.status === "success" ? "agentmd-status-success" : exec.status === "failed" || exec.status === "error" ? "agentmd-status-failed" : exec.status === "running" ? "agentmd-status-running" : "agentmd-status-aborted";
    line1.createSpan({ cls: statusCls, text: statusIcon });
    line1.createSpan({ cls: "exec-row-agent", text: ` ${exec.agent_id}` });
    line1.createSpan({ cls: "exec-row-id", text: `#${exec.id}` });
    if (exec.error) {
      line1.createSpan({ cls: "exec-row-error", text: exec.error });
    }
    line1.createSpan({ cls: "exec-row-time", text: formatRelativeTime(exec.started_at) });

    // Row 2: duration + tokens + cost
    const line2 = row.createDiv({ cls: "exec-row-line2" });
    if (exec.trigger && exec.trigger !== "manual") {
      line2.createSpan({ cls: "exec-row-trigger", text: exec.trigger === "scheduler" ? "⏱" : "👁" });
    }
    line2.createSpan({ text: formatDuration(exec.duration_ms != null ? exec.duration_ms / 1000 : undefined) });
    line2.createSpan({ text: formatTokens(exec.total_tokens) });
    line2.createSpan({ text: formatCost(exec.cost_usd) });
  }

  private filterByPeriod(executions: ExecutionSummary[]): ExecutionSummary[] {
    if (this.periodFilter === "all") return executions;
    const now = Date.now();
    const cutoff =
      this.periodFilter === "today" ? now - 24 * 3600_000 :
      this.periodFilter === "7d" ? now - 7 * 24 * 3600_000 :
      now - 30 * 24 * 3600_000;
    return executions.filter((e) => new Date(e.started_at).getTime() >= cutoff);
  }
}
```

- [ ] **Step 3: Verify compilation**

```bash
npx tsc --noEmit --skipLibCheck
```

- [ ] **Step 4: Commit**

```bash
git add src/views/constants.ts src/views/executions-view.ts
git commit -m "feat: ExecutionsView with status/agent/period filters and pagination"
```

---

## Task 4: AgentDetailView

**Files:**
- Create: `src/views/agent-detail-view.ts`

Main-area tab dashboard for a single agent. Shows config, stats, recent runs, and action buttons.

- [ ] **Step 1: Create `src/views/agent-detail-view.ts`**

```typescript
import { Component, ItemView, MarkdownRenderer, WorkspaceLeaf } from "obsidian";
import type { EventStore } from "../store/event-store";
import type { AgentDetail, ExecutionSummary } from "../types";
import { VIEW_TYPE_AGENT_DETAIL } from "./constants";
import { formatDuration, formatTokens, formatCost, formatRelativeTime } from "../ui/format";

export interface AgentDetailViewActions {
  onRunAgent: (name: string, withCurrentFile: boolean) => void;
  onOpenSourceFile: (agentName: string) => void;
  onOpenExecution: (executionId: number) => void;
  onOpenExecutions: (agentName: string) => void;
  getCurrentFilePath: () => string | null;
  fetchAgentDetail: (name: string) => Promise<AgentDetail>;
  fetchAgentRuns: (name: string, limit: number) => Promise<ExecutionSummary[]>;
}

export class AgentDetailView extends ItemView {
  private store: EventStore;
  private actions: AgentDetailViewActions;
  private agentName: string = "";
  private detail: AgentDetail | null = null;
  private runs: ExecutionSummary[] = [];
  private renderComponent: Component | null = null;

  constructor(leaf: WorkspaceLeaf, store: EventStore, actions: AgentDetailViewActions) {
    super(leaf);
    this.store = store;
    this.actions = actions;
  }

  getViewType(): string { return VIEW_TYPE_AGENT_DETAIL; }
  getDisplayText(): string { return this.agentName ? `Agent: ${this.agentName}` : "Agent Detail"; }
  getIcon(): string { return "cpu"; }

  async setAgent(name: string): Promise<void> {
    this.agentName = name;
    await this.loadData();
  }

  async onOpen(): Promise<void> {
    if (this.agentName) await this.loadData();
  }

  async onClose(): Promise<void> {
    this.renderComponent?.unload();
  }

  private async loadData(): Promise<void> {
    try {
      [this.detail, this.runs] = await Promise.all([
        this.actions.fetchAgentDetail(this.agentName),
        this.actions.fetchAgentRuns(this.agentName, 10),
      ]);
    } catch {
      this.detail = null;
      this.runs = [];
    }
    this.render();
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("agentmd-agent-detail");

    this.renderComponent?.unload();
    this.renderComponent = new Component();
    this.renderComponent.load();

    if (!this.detail) {
      container.createDiv({ cls: "agentmd-empty", text: `Agent "${this.agentName}" not found or backend offline.` });
      return;
    }

    this.renderHeader(container);
    this.renderStats(container);
    this.renderRecentRuns(container);
    this.renderConfig(container);
  }

  private renderHeader(container: HTMLElement): void {
    const d = this.detail!;
    const header = container.createDiv({ cls: "agent-detail-header" });

    const titleRow = header.createDiv({ cls: "agent-detail-title-row" });
    titleRow.createSpan({ cls: "agent-detail-name", text: d.name });

    // Chips
    const chips = titleRow.createDiv({ cls: "agent-detail-chips" });
    const tt = d.trigger_type ?? "manual";
    if (tt === "schedule") {
      chips.createSpan({ cls: "agentmd-chip scheduled", text: "⏱ Scheduled" });
    } else if (tt === "watch") {
      chips.createSpan({ cls: "agentmd-chip watch", text: "👁 Watch" });
    } else {
      chips.createSpan({ cls: "agentmd-chip manual", text: "Manual" });
    }
    if (d.model_provider || d.model_name) {
      chips.createSpan({ cls: "agentmd-chip model", text: `${d.model_provider ?? "?"} · ${d.model_name ?? "default"}` });
    }

    // Description
    if (d.description) {
      header.createDiv({ cls: "agent-detail-desc", text: d.description });
    }

    // Action buttons
    const actions = header.createDiv({ cls: "agent-detail-actions" });
    const runBtn = actions.createEl("button", { cls: "agentmd-btn", text: "▶ Run" });
    runBtn.addEventListener("click", () => this.actions.onRunAgent(d.name, false));

    const currentFile = this.actions.getCurrentFilePath();
    const runFileBtn = actions.createEl("button", { cls: "agentmd-btn primary", text: "▶ 📄 Run with file" });
    if (!currentFile) { runFileBtn.disabled = true; runFileBtn.title = "Open a note first"; }
    runFileBtn.addEventListener("click", () => this.actions.onRunAgent(d.name, true));

    const openBtn = actions.createEl("button", { cls: "agentmd-btn", text: "📝 Open source" });
    openBtn.addEventListener("click", () => this.actions.onOpenSourceFile(d.name));

    const histBtn = actions.createEl("button", { cls: "agentmd-btn", text: "📊 All executions" });
    histBtn.addEventListener("click", () => this.actions.onOpenExecutions(d.name));
  }

  private renderStats(container: HTMLElement): void {
    if (this.runs.length === 0) return;

    const section = container.createDiv({ cls: "agent-detail-stats" });
    const total = this.runs.length;
    const successes = this.runs.filter((r) => r.status === "success").length;
    const rate = total > 0 ? Math.round((successes / total) * 100) : 0;
    const avgDuration = total > 0
      ? this.runs.reduce((sum, r) => sum + (r.duration_ms ?? 0), 0) / total / 1000
      : 0;
    const totalCost = this.runs.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0);

    this.renderStatBadge(section, "Runs", String(total));
    this.renderStatBadge(section, "Success", `${rate}%`);
    this.renderStatBadge(section, "Avg duration", formatDuration(avgDuration));
    this.renderStatBadge(section, "Total spent", formatCost(totalCost));
  }

  private renderStatBadge(container: HTMLElement, label: string, value: string): void {
    const badge = container.createDiv({ cls: "exec-stat-badge" });
    badge.createDiv({ cls: "exec-stat-label", text: label });
    badge.createDiv({ cls: "exec-stat-value", text: value });
  }

  private renderRecentRuns(container: HTMLElement): void {
    const section = container.createDiv({ cls: "agent-detail-section" });
    const sectionHeader = section.createDiv({ cls: "agent-detail-section-header" });
    sectionHeader.createSpan({ text: "Recent Executions" });
    if (this.runs.length > 5) {
      const link = sectionHeader.createSpan({ cls: "agent-detail-link", text: `view all ${this.runs.length}` });
      link.addEventListener("click", () => this.actions.onOpenExecutions(this.agentName));
    }

    const list = section.createDiv({ cls: "agent-detail-runs" });
    for (const run of this.runs.slice(0, 5)) {
      const row = list.createDiv({ cls: "agentmd-exec-row" });
      row.addEventListener("click", () => this.actions.onOpenExecution(run.id));

      const line1 = row.createDiv({ cls: "exec-row-line1" });
      const icon = run.status === "success" ? "✓" : run.status === "failed" || run.status === "error" ? "✗" : "⚠";
      const cls = run.status === "success" ? "agentmd-status-success" : run.status === "failed" || run.status === "error" ? "agentmd-status-failed" : "agentmd-status-aborted";
      line1.createSpan({ cls, text: icon });
      line1.createSpan({ cls: "exec-row-id", text: ` #${run.id}` });
      line1.createSpan({ cls: "exec-row-time", text: formatRelativeTime(run.started_at) });

      const line2 = row.createDiv({ cls: "exec-row-line2" });
      line2.createSpan({ text: formatDuration(run.duration_ms != null ? run.duration_ms / 1000 : undefined) });
      line2.createSpan({ text: formatTokens(run.total_tokens) });
      line2.createSpan({ text: formatCost(run.cost_usd) });
    }
  }

  private renderConfig(container: HTMLElement): void {
    const d = this.detail!;
    const section = container.createDiv({ cls: "agent-detail-section" });
    section.createDiv({ cls: "agent-detail-section-header" }).createSpan({ text: "Configuration" });

    const config = section.createDiv({ cls: "agent-detail-config" });

    // Trigger
    this.renderConfigRow(config, "Trigger", d.trigger_type ?? "manual");

    // Model
    if (d.model_provider || d.model_name) {
      this.renderConfigRow(config, "Model", `${d.model_provider}/${d.model_name}`);
    }

    // Next run
    if (d.next_run) {
      this.renderConfigRow(config, "Next run", d.next_run);
    }

    // Last run
    if (d.last_run) {
      this.renderConfigRow(config, "Last run", formatRelativeTime(d.last_run));
    }

    // Settings (limits)
    const settings = d.settings as Record<string, unknown>;
    if (settings) {
      if (settings.max_tool_calls != null) {
        this.renderConfigRow(config, "Max tool calls", String(settings.max_tool_calls));
      }
      if (settings.max_cost_usd != null) {
        this.renderConfigRow(config, "Max cost", `$${settings.max_cost_usd}`);
      }
      if (settings.max_execution_tokens != null) {
        this.renderConfigRow(config, "Max tokens", formatTokens(settings.max_execution_tokens as number));
      }
      if (settings.temperature != null) {
        this.renderConfigRow(config, "Temperature", String(settings.temperature));
      }
    }
  }

  private renderConfigRow(container: HTMLElement, label: string, value: string): void {
    const row = container.createDiv({ cls: "agent-detail-config-row" });
    row.createSpan({ cls: "config-label", text: label });
    row.createSpan({ cls: "config-value", text: value });
  }
}
```

- [ ] **Step 2: Verify compilation**

```bash
npx tsc --noEmit --skipLibCheck
```

- [ ] **Step 3: Commit**

```bash
git add src/views/agent-detail-view.ts
git commit -m "feat: AgentDetailView dashboard with stats, runs, and config"
```

---

## Task 5: CSS for new views

**Files:**
- Modify: `styles.css`

Add styles for ExecutionsView (filter row, execution rows, load more) and AgentDetailView (header, stats, sections, config).

- [ ] **Step 1: Append to `styles.css`**

Add after the existing rules (before the closing empty states section):

```css
/* ---------- Filter row (ExecutionsView) ---------- */
.agentmd-filter-row {
  padding: 8px 12px;
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--background-modifier-border);
  background: var(--background-secondary);
}
.agentmd-filter-chip {
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  border-radius: 4px;
  padding: 3px 8px;
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
  cursor: pointer;
}
.agentmd-filter-chip:hover {
  background: var(--background-modifier-hover);
}
.agentmd-filter-chip.active {
  background: rgba(59,130,246,0.15);
  border-color: rgba(59,130,246,0.3);
  color: #3b82f6;
}

/* ---------- Execution rows (shared: ExecutionsView + AgentDetailView) ---------- */
.agentmd-exec-row {
  padding: 8px 12px;
  border-bottom: 1px solid var(--background-modifier-border);
  cursor: pointer;
}
.agentmd-exec-row:hover {
  background: var(--background-secondary);
}
.exec-row-line1 {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-ui-small);
  margin-bottom: 2px;
}
.exec-row-agent {
  font-weight: var(--font-semibold);
  color: var(--text-normal);
}
.exec-row-id {
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
}
.exec-row-error {
  background: rgba(239,68,68,0.1);
  color: #ef4444;
  font-size: 10px;
  padding: 0 5px;
  border-radius: 3px;
  margin-left: 4px;
}
.exec-row-time {
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
  margin-left: auto;
}
.exec-row-line2 {
  display: flex;
  gap: 8px;
  font-size: var(--font-ui-smaller);
  color: var(--text-faint);
  padding-left: 14px;
}
.exec-row-trigger {
  font-size: 10px;
}

/* ---------- Load more ---------- */
.agentmd-load-more {
  padding: 10px;
  text-align: center;
  border-bottom: 1px solid var(--background-modifier-border);
}

/* ---------- Agent Detail View ---------- */
.agentmd-agent-detail .agent-detail-header {
  padding: 16px;
  border-bottom: 1px solid var(--background-modifier-border);
}
.agent-detail-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}
.agent-detail-name {
  font-size: var(--font-ui-large);
  font-weight: var(--font-semibold);
  color: var(--text-normal);
}
.agent-detail-chips {
  display: flex;
  gap: 5px;
}
.agent-detail-desc {
  color: var(--text-muted);
  font-size: var(--font-ui-small);
  line-height: 1.5;
  margin-bottom: 12px;
}
.agent-detail-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.agent-detail-stats {
  display: flex;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--background-modifier-border);
}
.agent-detail-section {
  border-bottom: 1px solid var(--background-modifier-border);
}
.agent-detail-section-header {
  padding: 10px 16px;
  font-size: 11px;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.3px;
  font-weight: var(--font-semibold);
  background: var(--background-secondary);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.agent-detail-link {
  color: #3b82f6;
  cursor: pointer;
  font-size: 10px;
  text-transform: none;
  letter-spacing: 0;
}
.agent-detail-link:hover {
  text-decoration: underline;
}
.agent-detail-config {
  padding: 8px 0;
}
.agent-detail-config-row {
  display: flex;
  padding: 5px 16px;
  font-size: var(--font-ui-smaller);
}
.agent-detail-config-row .config-label {
  color: var(--text-faint);
  min-width: 120px;
}
.agent-detail-config-row .config-value {
  color: var(--text-normal);
  font-family: var(--font-monospace);
}
```

- [ ] **Step 2: Build to verify**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add styles.css
git commit -m "feat: CSS for ExecutionsView filters/rows and AgentDetailView dashboard"
```

---

## Task 6: Wire new views + agent card click + open source + scheduler

**Files:**
- Modify: `main.ts`
- Modify: `src/views/agents-view.ts`

This is the big integration task. Updates main.ts to:
- Make `settings` and `saveSettings()` public (for settings tab)
- Register ExecutionsView and AgentDetailView
- Register SettingsTab
- Wire agent card click → open AgentDetailView
- Wire "Open source file" dual mode
- Add scheduler pause/resume commands
- Add "Open Executions panel" command

Also updates AgentsView to call a new `onOpenAgentDetail` action.

- [ ] **Step 1: Update AgentsViewActions to add `onOpenAgentDetail`**

In `src/views/agents-view.ts`, update the interface:

```typescript
export interface AgentsViewActions {
  onRunAgent: (name: string, withCurrentFile: boolean) => void;
  onRefreshAgents: () => void;
  onOpenAgentDetail: (name: string) => void;
  getCurrentFilePath: () => string | null;
}
```

And in `renderCard`, add a click handler on the card itself:

After the line `const card = container.createDiv(...)`, add:

```typescript
    card.addEventListener("click", () => this.actions.onOpenAgentDetail(agent.name));
```

- [ ] **Step 2: Rewrite `main.ts` with all integrations**

This is a large update. The key additions to the existing main.ts:

1. Make `settings` public and add `saveSettings()` method
2. Import and register `ExecutionsView`, `AgentDetailView`, `SettingsTab`
3. Import new view constants
4. Add `onOpenAgentDetail` to AgentsView factory
5. Add `openAgentDetail()` method
6. Add `openSourceFile()` method with dual mode
7. Add scheduler commands
8. Add "Open Executions" command
9. Register settings tab

The file is getting large (~300 lines). The implementer should read the current `main.ts`, understand the pattern, and add:

**New imports:**
```typescript
import { ExecutionsView } from "./src/views/executions-view";
import { AgentDetailView } from "./src/views/agent-detail-view";
import { AgentmdSettingTab } from "./src/settings-tab";
import { VIEW_TYPE_EXECUTIONS, VIEW_TYPE_AGENT_DETAIL } from "./src/views/constants";
```

**Make settings public:**
```typescript
  settings!: AgentmdSettings;  // was private
  
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
```

**New view registrations (after existing registerView calls):**
```typescript
    this.registerView(VIEW_TYPE_EXECUTIONS, (leaf) =>
      new ExecutionsView(leaf, this.store, {
        onOpenExecution: (id) => this.openExecutionDetail(id),
        onRefreshExecutions: () => void this.refreshData(),
        getExecutions: (params) => this.client.listExecutions(params),
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
```

**Update AgentsView factory to add `onOpenAgentDetail`:**
```typescript
        onOpenAgentDetail: (name) => this.openAgentDetail(name),
```

**New commands:**
```typescript
    this.addCommand({
      id: "open-executions",
      name: "Open Executions panel",
      callback: () => this.activateView(VIEW_TYPE_EXECUTIONS),
    });
    this.addCommand({
      id: "pause-scheduler",
      name: "Pause scheduler",
      callback: async () => {
        try { await this.client.pauseScheduler(); new Notice("Scheduler paused"); } catch { new Notice("Failed to pause scheduler"); }
      },
    });
    this.addCommand({
      id: "resume-scheduler",
      name: "Resume scheduler",
      callback: async () => {
        try { await this.client.resumeScheduler(); new Notice("Scheduler resumed"); } catch { new Notice("Failed to resume scheduler"); }
      },
    });
```

**Register settings tab:**
```typescript
    this.addSettingTab(new AgentmdSettingTab(this.app, this));
```

**New methods:**
```typescript
  private async openAgentDetail(name: string): Promise<void> {
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_AGENT_DETAIL, active: true });
    const view = leaf.view as AgentDetailView;
    await view.setAgent(name);
  }

  private openSourceFile(agentName: string): void {
    const filePath = `${this.settings.agentsDir}/${agentName}.md`;
    // Check if the file is inside the vault
    const vaultPath = (this.app.vault.adapter as any).basePath as string;
    if (filePath.startsWith(vaultPath)) {
      // Vault-relative path
      const relative = filePath.slice(vaultPath.length + 1);
      const file = this.app.vault.getAbstractFileByPath(relative);
      if (file) {
        void this.app.workspace.getLeaf("tab").openFile(file as any);
        return;
      }
    }
    // Fallback: reveal in system file manager
    const { shell } = require("electron") as typeof import("electron");
    shell.showItemInFolder(filePath);
    new Notice(`Source file revealed in file manager: ${agentName}.md`);
  }

  private async openExecutionsForAgent(agentName: string): Promise<void> {
    // Open executions view — the view itself doesn't support pre-set filter yet,
    // so we just open it. Plan 3+ could add this.
    await this.activateView(VIEW_TYPE_EXECUTIONS);
  }
```

**Default layout update — add ExecutionsView to initial layout:**
```typescript
    if (!this.app.workspace.getLeavesOfType(VIEW_TYPE_AGENTS).length) {
      this.app.workspace.onLayoutReady(() => {
        void this.activateView(VIEW_TYPE_AGENTS);
        void this.activateView(VIEW_TYPE_LIVE);
        void this.activateView(VIEW_TYPE_EXECUTIONS);
      });
    }
```

- [ ] **Step 3: Verify compilation + build + tests**

```bash
npx tsc --noEmit --skipLibCheck && npm run build && npm test
```

- [ ] **Step 4: Commit**

```bash
git add main.ts src/views/agents-view.ts
git commit -m "feat: wire new views, agent detail, open source file, scheduler commands, settings tab"
```

---

## Task 7: Offline banner in sidebar views

**Files:**
- Modify: `src/views/agents-view.ts`
- Modify: `src/views/live-view.ts`
- Modify: `src/views/executions-view.ts`

Add an offline banner at the top of each sidebar view when the backend is down. The views need to receive a `isOnline()` callback.

- [ ] **Step 1: Add `isOnline` to all three sidebar view action interfaces**

In `agents-view.ts`, `live-view.ts`, and `executions-view.ts`, add to each actions interface:

```typescript
  isOnline: () => boolean;
```

In each view's `render()`, after `container.empty()`, add:

```typescript
    if (!this.actions.isOnline()) {
      const banner = container.createDiv({ cls: "agentmd-offline-banner" });
      banner.createSpan({ text: "⚠ Backend offline — run " });
      const code = banner.createEl("code", { text: "agentmd start -d" });
      banner.createSpan({ text: " in your terminal" });
    }
```

- [ ] **Step 2: Wire `isOnline` in main.ts view factories**

Add to each sidebar view factory:

```typescript
        isOnline: () => this.monitor.online,
```

Also subscribe the sidebar views to monitor changes so they re-render on online/offline transitions. In the `onload` monitor subscriber, add a refresh call:

Already partially done — the monitor subscriber calls `refreshData()` on online. The views will re-render via store listeners. The offline banner checks `isOnline()` on every render so it appears/disappears automatically.

- [ ] **Step 3: Verify + commit**

```bash
npx tsc --noEmit --skipLibCheck && npm run build
git add src/views/agents-view.ts src/views/live-view.ts src/views/executions-view.ts main.ts
git commit -m "feat: offline banner in all sidebar views"
```

---

## Task 8: Build + smoke test

**Files:** none — verification only.

- [ ] **Step 1: Full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Production build**

```bash
npm run build
```

- [ ] **Step 3: Copy to vault**

```bash
VAULT=<path>
cp main.js manifest.json styles.css "$VAULT/.obsidian/plugins/agentmd-obsidian/"
```

- [ ] **Step 4: Manual smoke test checklist**

**YOU CANNOT RUN THIS STEP.** Document for the user:

1. **Settings tab** — Settings → agentmd → 5 fields visible (socket path, agents dir, auto-open, notifications, poll interval). Change a value, reload, confirm it persists.
2. **Agent card click** → opens AgentDetailView tab with name, description, chips, stats, recent runs, config sections
3. **"Open source" button** → opens the agent `.md` in Obsidian (if agents dir is inside vault) or reveals in Finder
4. **Executions panel** — ribbon or command palette → "Open Executions panel" → filterable list
5. **Status filter** — click cycles through All/Success/Failed/Aborted
6. **Agent filter** — click cycles through All + each agent name
7. **Period filter** — click cycles through Today/7d/30d/All
8. **Click execution row** → opens ExecutionDetailView tab
9. **Scheduler commands** — command palette → "Pause scheduler" / "Resume scheduler" → Notice confirms
10. **Offline banner** — stop backend → all sidebar views show ⚠ banner

---

## Done — what Plan 3 delivers

After finishing all 8 tasks:

- **ExecutionsView** — filterable execution history with status/agent/period filters and pagination
- **AgentDetailView** — full dashboard per agent (stats, recent runs, config, action buttons)
- **Agent card click** → opens the detail view
- **"Open source file"** — dual mode (vault editor or system file manager)
- **Settings tab** — all 5 settings editable via Obsidian's settings pane
- **Scheduler commands** — pause/resume via command palette
- **Offline banner** — visible in all sidebar views when backend is down
- **v1 feature set complete** — all 14 features from the spec are implemented

After Plan 3, the plugin is feature-complete for v1 and ready for final review + polish pass.
