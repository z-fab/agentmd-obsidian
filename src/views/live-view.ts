import { ItemView, WorkspaceLeaf } from "obsidian";
import type { EventStore, RunningExecution } from "../store/event-store";
import { VIEW_TYPE_LIVE } from "./constants";
import { formatDuration, formatTokens, formatCost } from "../ui/format";

export interface LiveViewActions {
  onOpenExecution: (executionId: number) => void;
  onCancelExecution: (executionId: number) => void;
  onStartBackend: () => void;
  isOnline: () => boolean;
  onOnlineChanged: (listener: () => void) => () => void;
}

export class LiveView extends ItemView {
  private store: EventStore;
  private actions: LiveViewActions;
  private unsubRunning: (() => void) | null = null;
  private unsubOnline: (() => void) | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  constructor(leaf: WorkspaceLeaf, store: EventStore, actions: LiveViewActions) {
    super(leaf);
    this.store = store;
    this.actions = actions;
  }

  getViewType(): string { return VIEW_TYPE_LIVE; }
  getDisplayText(): string { return "Live"; }
  getIcon(): string { return "activity"; }

  async onOpen(): Promise<void> {
    this.unsubRunning = this.store.onRunningChanged(() => this.render());
    this.unsubOnline = this.actions.onOnlineChanged(() => this.render());
    this.render();
  }

  async onClose(): Promise<void> {
    this.unsubRunning?.();
    this.unsubOnline?.();
    this.stopTick();
  }

  private startTick(): void {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => this.render(), 1000);
  }

  private stopTick(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();

    if (!this.actions.isOnline()) {
      this.stopTick();
      this.renderOffline(container);
      return;
    }

    // Header
    const header = container.createDiv({ cls: "agentmd-view-header" });
    const left = header.createDiv({ cls: "agentmd-header-left" });
    left.createSpan({ cls: "agentmd-view-icon", text: "◆" });
    left.createSpan({ cls: "agentmd-header-title", text: "Live" });
    const runningCount = this.store.running.size;
    if (runningCount > 0) {
      left.createSpan({ cls: "agentmd-header-badge", text: String(runningCount) });
    }

    if (runningCount === 0) {
      this.stopTick();
      container.createDiv({
        cls: "agentmd-empty",
        text: "No running executions. Click ▶ on an agent to start one.",
      });
      return;
    }

    // Start tick for elapsed time updates
    this.startTick();

    for (const [, exec] of this.store.running) {
      this.renderCard(container, exec);
    }
  }

  private renderCard(container: HTMLElement, exec: RunningExecution): void {
    const card = container.createDiv({ cls: "agentmd-live-card" });
    card.addEventListener("click", () => this.actions.onOpenExecution(exec.id));

    const headerEl = card.createDiv({ cls: "live-header" });
    headerEl.createSpan({ cls: "live-dot", text: "●" });
    headerEl.createSpan({ cls: "live-name", text: exec.agent });
    headerEl.createSpan({ cls: "live-id", text: `#${exec.id}` });

    const trigger = exec.triggerSource;
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

    const elapsed = Math.round((Date.now() - exec.startedAt) / 1000);
    const stats = card.createDiv({ cls: "live-stats" });
    stats.createSpan({ text: formatDuration(elapsed) });
    if (exec.tokensTotal > 0) {
      stats.createSpan({ text: formatTokens(exec.tokensTotal) });
    }
    if (exec.costUsd > 0) {
      stats.createSpan({ text: formatCost(exec.costUsd) });
    }
  }

  private renderOffline(container: HTMLElement): void {
    const wrapper = container.createDiv({ cls: "agentmd-offline-state" });
    wrapper.createDiv({ cls: "agentmd-offline-icon", text: "⚠" });
    wrapper.createDiv({ cls: "agentmd-offline-title", text: "Backend offline" });
    const startBtn = wrapper.createEl("button", {
      cls: "agentmd-btn primary agentmd-offline-start-btn",
      text: "▶ Start AgentMD",
    });
    startBtn.addEventListener("click", () => {
      startBtn.setText("Starting…");
      startBtn.disabled = true;
      this.actions.onStartBackend();
    });
  }
}
