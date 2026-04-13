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
