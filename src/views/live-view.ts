import { ItemView, WorkspaceLeaf } from "obsidian";
import type { EventStore, RunningExecution } from "../store/event-store";
import { VIEW_TYPE_LIVE } from "./constants";
import { formatDuration, formatTokens, formatCost } from "../ui/format";

export interface LiveViewActions {
  onOpenExecution: (executionId: number) => void;
  onCancelExecution: (executionId: number) => void;
}

export class LiveView extends ItemView {
  private store: EventStore;
  private actions: LiveViewActions;
  private unsub: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, store: EventStore, actions: LiveViewActions) {
    super(leaf);
    this.store = store;
    this.actions = actions;
  }

  getViewType(): string { return VIEW_TYPE_LIVE; }
  getDisplayText(): string { return "Live"; }
  getIcon(): string { return "activity"; }

  async onOpen(): Promise<void> {
    this.render();
    this.unsub = this.store.onRunningChanged(() => this.render());
  }

  async onClose(): Promise<void> {
    this.unsub?.();
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();

    // Header
    const header = container.createDiv({ cls: "agentmd-view-header" });
    header.createSpan({ cls: "agentmd-view-icon", text: "●" });
    header.createSpan({ text: "Live" });
    const count = this.store.running.size;
    header.createSpan({ cls: "agentmd-view-count", text: count > 0 ? `${count} active` : "" });

    if (count === 0) {
      container.createDiv({
        cls: "agentmd-empty",
        text: "No running executions. Click ▶ on an agent to start one.",
      });
      return;
    }

    // Cards sorted by most recent first
    const runs = [...this.store.running.values()].sort(
      (a, b) => b.startedAt - a.startedAt,
    );

    for (const run of runs) {
      this.renderCard(container, run);
    }
  }

  private renderCard(container: HTMLElement, run: RunningExecution): void {
    const card = container.createDiv({ cls: "agentmd-live-card" });
    card.addEventListener("click", () => this.actions.onOpenExecution(run.id));

    // Row 1: dot + name + #id + trigger + cancel
    const headerEl = card.createDiv({ cls: "live-header" });
    headerEl.createSpan({ cls: "live-dot", text: "●" });
    headerEl.createSpan({ cls: "live-name", text: run.agent });
    headerEl.createSpan({ cls: "live-id", text: `#${run.id}` });

    const triggerCls =
      run.triggerSource === "scheduler" ? "agentmd-trigger-scheduler" :
      run.triggerSource === "watch" ? "agentmd-trigger-watch" :
      "agentmd-trigger-manual";
    headerEl.createSpan({ cls: `live-trigger ${triggerCls}`, text: `· ${run.triggerSource}` });

    const cancel = headerEl.createSpan({ cls: "live-cancel", text: "✕" });
    cancel.addEventListener("click", (e) => {
      e.stopPropagation();
      this.actions.onCancelExecution(run.id);
    });

    // Row 2: last activity
    if (run.lastActivity) {
      card.createDiv({ cls: "live-activity", text: run.lastActivity });
    }

    // Row 3: stats
    const elapsed = Math.round((Date.now() - run.startedAt) / 1000);
    const stats = card.createDiv({ cls: "live-stats" });
    stats.createSpan({ text: formatDuration(elapsed) });
    if (run.tokensTotal > 0) stats.createSpan({ text: formatTokens(run.tokensTotal) });
    if (run.costUsd > 0) stats.createSpan({ text: formatCost(run.costUsd) });
  }
}
