import { Notice, Plugin } from "obsidian";
import { AgentmdClient } from "./src/client/agentmd-client";
import { GlobalSSEConnection } from "./src/client/global-sse";
import { BackendMonitor } from "./src/backend-monitor";
import { BackendLifecycle } from "./src/backend-lifecycle";
import { EventStore } from "./src/store/event-store";
import { PanelView } from "./src/views/panel-view";
import { AgentmdSettingTab } from "./src/settings-tab";
import { VIEW_TYPE_PANEL } from "./src/views/constants";
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

    // Register the single panel view
    this.registerView(VIEW_TYPE_PANEL, (leaf) =>
      new PanelView(leaf, this.store, {
        onRunAgent: (name, withFile) => this.runAgent(name, withFile),
        onCancelExecution: (id) => this.cancelExecution(id),
        onRefreshAgents: () => void this.refreshAgents(),
        onOpenSourceFile: (name) => this.openSourceFile(name),
        onRerun: (name) => this.runAgent(name, false),
        getCurrentFilePath: () => this.getCurrentFilePath(),
        isOnline: () => this.monitor.online,
        onOnlineChanged: (cb) => this.monitor.subscribe(() => cb()),
        onStartBackend: () => this.startBackend(),
        fetchAgentDetail: (name) => this.client.getAgent(name),
        fetchAgentRuns: (name, limit) => this.client.getAgentRuns(name, limit),
        fetchExecution: async (id) => { try { return await this.client.getExecution(id); } catch { return null; } },
        fetchExecutionMessages: (id) => this.client.getExecutionMessages(id),
        getExecutions: (p) => this.client.listExecutions(p),
      }),
    );

    // Commands
    this.addCommand({ id: "open-panel", name: "Open Agentmd panel", callback: () => void this.activatePanel() });
    this.addCommand({ id: "open-live", name: "Open Live", callback: () => void this.activatePanel("live") });
    this.addCommand({ id: "open-history", name: "Open History", callback: () => void this.activatePanel("history") });
    this.addCommand({
      id: "run-with-file",
      name: "Run current file through agent…",
      callback: () => this.promptRunWithFile(),
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
    this.addRibbonIcon("bot", "Agentmd", () => void this.activatePanel());

    // Default layout on first install + migration of old leaves
    this.app.workspace.onLayoutReady(() => {
      // Migrate: detach any leaves from the old per-panel view types.
      for (const t of ["agentmd-agents", "agentmd-live", "agentmd-executions", "agentmd-agent-detail", "agentmd-exec-detail"]) {
        this.app.workspace.getLeavesOfType(t).forEach((l) => l.detach());
      }
      if (!this.app.workspace.getLeavesOfType(VIEW_TYPE_PANEL).length) void this.activatePanel();
    });

    // Apply accent color CSS variable
    this.applyAccent();

    // Start global SSE connection
    this.globalSSE.start();
  }

  onunload(): void {
    this.globalSSE?.stop();
    this.monitor?.stop();
    this.unsubMonitor?.();
    for (const close of this.sseConnections.values()) close();
    this.sseConnections.clear();
    document.body.style.removeProperty("--agentmd-accent");
  }

  applyAccent(): void {
    document.body.style.setProperty("--agentmd-accent", this.settings.accentColor || "#4EA92E");
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  // ---- Global SSE event handling ----

  private handleGlobalSSEEvent(type: string, data: Record<string, unknown>): void {
    if (type === "heartbeat") {
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
      void this.syncOnReconnect();
    } else if (state === "fallback") {
      this.monitor.notifySSEDisconnected();
      this.monitor.activateFallback();
    } else if (state === "reconnecting") {
      // Still trying - keep current online state
    } else if (state === "offline") {
      this.monitor.notifySSEDisconnected();
    }
  }

  private async syncOnReconnect(): Promise<void> {
    try {
      const agents = await this.client.listAgents();
      this.store.setAgents(agents);

      const running = await this.client.listExecutions({ status: "running" });
      const newIds = this.store.syncRunning(running);
      for (const id of newIds) {
        if (!this.sseConnections.has(id)) {
          this.subscribeToExecution(id);
        }
      }
    } catch {
      // Backend may not be fully ready
    }
  }

  // ---- Backend lifecycle ----

  private async startBackend(): Promise<boolean> {
    new Notice("Starting Agentmd…");
    const result = await this.lifecycle.start();
    if (result.success) {
      new Notice("Agentmd started");
      this.globalSSE.reconnectNow();
      return true;
    } else {
      new Notice(`Failed to start Agentmd: ${result.error}`);
      return false;
    }
  }

  private async stopBackend(): Promise<void> {
    const stopped = await this.lifecycle.stop();
    if (stopped) {
      this.globalSSE.stop();
      this.monitor.notifySSEDisconnected();
      new Notice("Agentmd stopped");
      // Restart SSE so it auto-reconnects when the user starts the backend again
      this.globalSSE.start();
    } else {
      new Notice("Failed to stop Agentmd");
    }
  }

  // ---- Actions ----

  private async runAgent(name: string, withCurrentFile: boolean): Promise<void> {
    if (!this.monitor.online) {
      new Notice("Agentmd backend is offline.");
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
          // Guard: global SSE may have already completed this execution
          if (!this.store.running.has(executionId)) {
            this.sseConnections.delete(executionId);
            return;
          }
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

  private async activatePanel(tab?: "agents" | "live" | "history"): Promise<PanelView | null> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_PANEL)[0];
    if (!leaf) {
      const right = this.app.workspace.getRightLeaf(false);
      if (!right) return null;
      leaf = right;
      await leaf.setViewState({ type: VIEW_TYPE_PANEL, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
    const view = leaf.view as PanelView;
    if (tab) view.goToTab(tab);
    return view;
  }

  private async openExecutionDetail(executionId: number): Promise<void> {
    (await this.activatePanel())?.openExecution(executionId);
  }

  private async openSourceFile(agentName: string): Promise<void> {
    let abs: string | null = null;
    try { abs = (await this.client.getAgent(agentName)).source_path ?? null; } catch { /* offline */ }
    if (!abs) abs = `${this.settings.agentsDir}/${agentName}.md`;
    const vaultPath = (this.app.vault.adapter as any).basePath as string;
    if (abs.startsWith(vaultPath)) {
      const relative = abs.slice(vaultPath.length + 1);
      const file = this.app.vault.getAbstractFileByPath(relative);
      if (file) { void this.app.workspace.getLeaf("tab").openFile(file as any); return; }
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { shell } = require("electron") as { shell: { showItemInFolder: (path: string) => void } };
    shell.showItemInFolder(abs);
    new Notice(`Source revealed: ${agentName}.md`);
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
    await this.activatePanel("agents");
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
    label.setText("Agentmd");

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
