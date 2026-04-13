import { ItemView, WorkspaceLeaf } from "obsidian";
import type { ExecutionSummary } from "../types";
import { VIEW_TYPE_LIVE } from "./constants";
import { formatDuration, formatTokens, formatCost } from "../ui/format";

export interface LiveViewActions {
  onOpenExecution: (executionId: number) => void;
  onCancelExecution: (executionId: number) => void;
  isOnline: () => boolean;
  onOnlineChanged: (listener: () => void) => () => void;
  /** Fetch currently running executions directly from the API. */
  fetchRunning: () => Promise<ExecutionSummary[]>;
}

export class LiveView extends ItemView {
  private actions: LiveViewActions;
  private unsubOnline: (() => void) | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private executions: ExecutionSummary[] = [];

  constructor(leaf: WorkspaceLeaf, actions: LiveViewActions) {
    super(leaf);
    this.actions = actions;
  }

  getViewType(): string { return VIEW_TYPE_LIVE; }
  getDisplayText(): string { return "Live"; }
  getIcon(): string { return "activity"; }

  async onOpen(): Promise<void> {
    this.unsubOnline = this.actions.onOnlineChanged(() => {
      void this.poll();
    });
    // Start polling every 2 seconds
    this.pollTimer = setInterval(() => {
      if (this.actions.isOnline()) void this.poll();
    }, 2000);
    // Initial poll
    void this.poll();
  }

  async onClose(): Promise<void> {
    this.unsubOnline?.();
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async poll(): Promise<void> {
    if (!this.actions.isOnline()) {
      this.executions = [];
      this.render();
      return;
    }
    try {
      this.executions = await this.actions.fetchRunning();
    } catch {
      // offline or error — keep last known state
    }
    this.render();
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
    left.createSpan({ cls: "agentmd-header-title", text: "Live" });
    if (this.executions.length > 0) {
      left.createSpan({ cls: "agentmd-header-badge", text: String(this.executions.length) });
    }

    if (this.executions.length === 0) {
      container.createDiv({
        cls: "agentmd-empty",
        text: this.actions.isOnline()
          ? "No running executions. Click ▶ on an agent to start one."
          : "",
      });
      return;
    }

    for (const exec of this.executions) {
      this.renderCard(container, exec);
    }
  }

  private renderCard(container: HTMLElement, exec: ExecutionSummary): void {
    const card = container.createDiv({ cls: "agentmd-live-card" });
    card.addEventListener("click", () => this.actions.onOpenExecution(exec.id));

    // Row 1: dot + name + #id + trigger + cancel
    const headerEl = card.createDiv({ cls: "live-header" });
    headerEl.createSpan({ cls: "live-dot", text: "●" });
    headerEl.createSpan({ cls: "live-name", text: exec.agent_id });
    headerEl.createSpan({ cls: "live-id", text: `#${exec.id}` });

    const trigger = exec.trigger ?? "manual";
    const triggerCls =
      trigger === "scheduler" || trigger === "schedule" ? "agentmd-trigger-scheduler" :
      trigger === "watch" ? "agentmd-trigger-watch" :
      "agentmd-trigger-manual";
    headerEl.createSpan({ cls: `live-trigger ${triggerCls}`, text: `· ${trigger}` });

    const cancel = headerEl.createSpan({ cls: "live-cancel", text: "■" });
    cancel.title = "Stop execution";
    cancel.addEventListener("click", (e) => {
      e.stopPropagation();
      cancel.setText("…");
      cancel.style.pointerEvents = "none";
      this.actions.onCancelExecution(exec.id);
    });

    // Row 2: elapsed time + tokens + cost (from API data)
    const elapsed = exec.started_at
      ? Math.round((Date.now() - new Date(exec.started_at).getTime()) / 1000)
      : 0;
    const stats = card.createDiv({ cls: "live-stats" });
    stats.createSpan({ text: formatDuration(elapsed) });
    if (exec.total_tokens != null && exec.total_tokens > 0) {
      stats.createSpan({ text: formatTokens(exec.total_tokens) });
    }
    if (exec.cost_usd != null && exec.cost_usd > 0) {
      stats.createSpan({ text: formatCost(exec.cost_usd) });
    }
  }

  private renderOffline(container: HTMLElement): void {
    const wrapper = container.createDiv({ cls: "agentmd-offline-state" });
    wrapper.createDiv({ cls: "agentmd-offline-icon", text: "⚠" });
    wrapper.createDiv({ cls: "agentmd-offline-title", text: "Backend offline" });
    const cmd = wrapper.createDiv({ cls: "agentmd-offline-cmd" });
    cmd.createSpan({ text: "Run " });
    cmd.createEl("code", { text: "agentmd start -d" });
    cmd.createSpan({ text: " to connect" });
  }
}
