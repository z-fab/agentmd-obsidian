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
