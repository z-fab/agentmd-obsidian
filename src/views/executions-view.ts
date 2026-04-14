import { ItemView, WorkspaceLeaf } from "obsidian";
import type { EventStore } from "../store/event-store";
import type { ExecutionSummary } from "../types";
import { VIEW_TYPE_EXECUTIONS } from "./constants";
import { formatDuration, formatTokens, formatCost, formatRelativeTime } from "../ui/format";

export interface ExecutionsViewActions {
  onOpenExecution: (executionId: number) => void;
  onRefreshExecutions: () => void;
  getExecutions: (params: { status?: string; agent?: string; limit: number; offset: number }) => Promise<ExecutionSummary[]>;
  isOnline: () => boolean;
  onOnlineChanged: (listener: () => void) => () => void;
  onStartBackend: () => Promise<boolean>;
}

type StatusFilter = "all" | "success" | "failed" | "aborted";
type PeriodFilter = "today" | "7d" | "30d" | "all";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "success", label: "✓" },
  { value: "failed", label: "✗" },
  { value: "aborted", label: "⚠" },
];

const PERIOD_OPTIONS: { value: PeriodFilter; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "all", label: "All" },
];

export class ExecutionsView extends ItemView {
  private store: EventStore;
  private actions: ExecutionsViewActions;
  private unsub: (() => void) | null = null;
  private unsubOnline: (() => void) | null = null;

  private statusFilter: StatusFilter = "all";
  private agentFilter: string = "all";
  private periodFilter: PeriodFilter = "today";
  private executions: ExecutionSummary[] = [];
  private offset = 0;
  private readonly pageSize = 30;
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
    this.unsubOnline = this.actions.onOnlineChanged(() => this.render());
    await this.loadExecutions();
  }

  async onClose(): Promise<void> {
    this.unsub?.();
    this.unsubOnline?.();
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

    if (!this.actions.isOnline()) {
      this.renderOffline(container);
      return;
    }

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

    // Filter area
    const filterArea = container.createDiv({ cls: "agentmd-filter-area" });

    // Status: segmented control
    const statusRow = filterArea.createDiv({ cls: "agentmd-filter-group" });
    statusRow.createSpan({ cls: "agentmd-filter-label", text: "Status" });
    const statusSeg = statusRow.createDiv({ cls: "agentmd-segmented" });
    for (const opt of STATUS_OPTIONS) {
      const btn = statusSeg.createEl("button", {
        cls: `agentmd-seg-btn ${this.statusFilter === opt.value ? "active" : ""}`,
        text: opt.label,
      });
      btn.addEventListener("click", () => {
        this.statusFilter = opt.value;
        void this.applyFilter();
      });
    }

    // Agent: dropdown-style button
    const agentRow = filterArea.createDiv({ cls: "agentmd-filter-group" });
    agentRow.createSpan({ cls: "agentmd-filter-label", text: "Agent" });
    const agentSelect = agentRow.createEl("select", { cls: "agentmd-filter-select" });
    const allOpt = agentSelect.createEl("option", { text: "All agents", value: "all" });
    if (this.agentFilter === "all") allOpt.selected = true;
    for (const agent of this.store.agents) {
      const opt = agentSelect.createEl("option", { text: agent.name, value: agent.name });
      if (this.agentFilter === agent.name) opt.selected = true;
    }
    agentSelect.addEventListener("change", () => {
      this.agentFilter = agentSelect.value;
      void this.applyFilter();
    });

    // Period: segmented control
    const periodRow = filterArea.createDiv({ cls: "agentmd-filter-group" });
    periodRow.createSpan({ cls: "agentmd-filter-label", text: "Period" });
    const periodSeg = periodRow.createDiv({ cls: "agentmd-segmented" });
    for (const opt of PERIOD_OPTIONS) {
      const btn = periodSeg.createEl("button", {
        cls: `agentmd-seg-btn ${this.periodFilter === opt.value ? "active" : ""}`,
        text: opt.label,
      });
      btn.addEventListener("click", () => {
        this.periodFilter = opt.value;
        void this.applyFilter();
      });
    }

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
    const list = container.createDiv({ cls: "agentmd-exec-list" });
    for (const exec of filtered) {
      this.renderRow(list, exec);
    }

    // Load more
    if (this.executions.length >= this.offset + this.pageSize) {
      const loadMore = container.createDiv({ cls: "agentmd-load-more" });
      loadMore.createEl("button", { cls: "agentmd-btn", text: "Load more" }).addEventListener("click", () => {
        this.offset += this.pageSize;
        void this.loadExecutions();
      });
    }
  }

  private renderRow(container: HTMLElement, exec: ExecutionSummary): void {
    const isSuccess = exec.status === "success";
    const isFailed = exec.status === "failed" || exec.status === "error";
    const isRunning = exec.status === "running";
    const statusIcon = isSuccess ? "✓" : isFailed ? "✗" : isRunning ? "●" : "⚠";
    const statusCls = isSuccess ? "agentmd-status-success" : isFailed ? "agentmd-status-failed" : isRunning ? "agentmd-status-running" : "agentmd-status-aborted";

    const row = container.createDiv({ cls: `agentmd-exec-row ${isFailed || (!isSuccess && !isRunning) ? "has-error" : ""}` });
    row.addEventListener("click", () => this.actions.onOpenExecution(exec.id));

    // Line 1: icon + agent + #id + time
    const line1 = row.createDiv({ cls: "exec-row-line1" });
    line1.createSpan({ cls: statusCls, text: statusIcon });
    line1.createSpan({ cls: "exec-row-agent", text: ` ${exec.agent_id}` });
    line1.createSpan({ cls: "exec-row-id", text: `#${exec.id}` });
    // Trigger icon (if not manual)
    if (exec.trigger && exec.trigger !== "manual") {
      line1.createSpan({ cls: "exec-row-trigger-icon", text: exec.trigger === "scheduler" || exec.trigger === "schedule" ? " ⏱" : " 👁" });
    }
    line1.createSpan({ cls: "exec-row-time", text: formatRelativeTime(exec.started_at) });

    // Line 2: duration · tokens · cost (+ error truncated if any)
    const line2 = row.createDiv({ cls: "exec-row-line2" });
    line2.createSpan({ text: formatDuration(exec.duration_ms != null ? exec.duration_ms / 1000 : undefined) });
    line2.createSpan({ text: formatTokens(exec.total_tokens) });
    line2.createSpan({ text: formatCost(exec.cost_usd) });
    if (exec.error) {
      const errorText = exec.error.length > 30 ? exec.error.slice(0, 30) + "…" : exec.error;
      line2.createSpan({ cls: "exec-row-error-inline", text: errorText });
    }
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

  private renderOffline(container: HTMLElement): void {
    const wrapper = container.createDiv({ cls: "agentmd-offline-state" });
    wrapper.createDiv({ cls: "agentmd-offline-icon", text: "⚠" });
    wrapper.createDiv({ cls: "agentmd-offline-title", text: "Backend offline" });
    const startBtn = wrapper.createEl("button", {
      cls: "agentmd-btn primary agentmd-offline-start-btn",
      text: "▶ Start AgentMD",
    });
    startBtn.addEventListener("click", async () => {
      startBtn.setText("Starting…");
      startBtn.disabled = true;
      const ok = await this.actions.onStartBackend();
      if (!ok) {
        startBtn.setText("▶ Start AgentMD");
        startBtn.disabled = false;
      }
    });
  }
}
