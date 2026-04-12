import { Component, ItemView, MarkdownRenderer, WorkspaceLeaf } from "obsidian";
import type { EventStore, RunningExecution, CompletedSnapshot } from "../store/event-store";
import type { ExecutionSummary, ParsedSSEEvent } from "../types";
import { VIEW_TYPE_EXEC_DETAIL } from "./constants";
import { formatDuration, formatTokens, formatCost } from "../ui/format";

export interface ExecDetailActions {
  onCancel: (executionId: number) => void;
  onRerun: (agentName: string, args?: string[]) => void;
}

export interface ExecDetailState {
  executionId: number;
}

export class ExecutionDetailView extends ItemView {
  private store: EventStore;
  private actions: ExecDetailActions;
  private executionId: number = 0;
  private unsub: (() => void) | null = null;
  private unsubHistory: (() => void) | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private renderComponent: Component | null = null;

  constructor(leaf: WorkspaceLeaf, store: EventStore, actions: ExecDetailActions) {
    super(leaf);
    this.store = store;
    this.actions = actions;
  }

  getViewType(): string { return VIEW_TYPE_EXEC_DETAIL; }
  getDisplayText(): string { return "Execution"; }
  getIcon(): string { return "terminal"; }

  setExecutionId(id: number): void {
    this.executionId = id;
    this.render();
  }

  async onOpen(): Promise<void> {
    this.unsub = this.store.onRunningChanged(() => {
      if (this.store.running.has(this.executionId)) {
        this.render();
      } else if (this.tickTimer) {
        this.stopTick();
        this.render();
      }
    });
    this.unsubHistory = this.store.onHistoryChanged(() => {
      if (!this.store.running.has(this.executionId)) {
        this.render();
      }
    });
    this.render();
  }

  async onClose(): Promise<void> {
    this.unsub?.();
    this.unsubHistory?.();
    this.stopTick();
    this.renderComponent?.unload();
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
    container.addClass("agentmd-exec-detail");

    // Clean up previous markdown render component
    this.renderComponent?.unload();
    this.renderComponent = new Component();
    this.renderComponent.load();

    const running = this.store.running.get(this.executionId);
    if (running) {
      this.startTick();
      this.renderStreaming(container, running);
    } else {
      this.stopTick();
      const completed = this.store.history.find((e) => e.id === this.executionId);
      if (completed) {
        this.renderCompleted(container, completed);
      } else {
        container.createDiv({ cls: "agentmd-empty", text: "Execution not found." });
      }
    }
  }

  // ============================================================
  //  STREAMING MODE
  // ============================================================

  private renderStreaming(container: HTMLElement, run: RunningExecution): void {
    // Header
    const header = container.createDiv({ cls: "exec-header streaming" });
    const titleRow = header.createDiv({ cls: "exec-title" });
    titleRow.createSpan({ cls: "agentmd-status-running", text: "●" });
    titleRow.createSpan({ text: ` ${run.agent}` });
    titleRow.createSpan({ cls: "exec-id", text: `#${run.id}` });

    const cancelBtn = titleRow.createEl("button", { cls: "agentmd-btn", text: "■ Stop" });
    cancelBtn.style.marginLeft = "auto";
    cancelBtn.addEventListener("click", () => {
      cancelBtn.setText("Stopping…");
      cancelBtn.disabled = true;
      this.actions.onCancel(run.id);
    });

    // Status line: only elapsed time (tokens/cost come from backend only on complete)
    const elapsed = Math.round((Date.now() - run.startedAt) / 1000);
    const statusLine = header.createDiv({ cls: "exec-stats" });
    statusLine.createSpan({ cls: "agentmd-status-running", text: "● running" });
    statusLine.createSpan({ text: formatDuration(elapsed) });

    // Log area
    const logWrapper = container.createDiv({ cls: "exec-log-wrapper" });
    logWrapper.createDiv({ cls: "exec-log-title", text: "Execution Log" });
    const log = logWrapper.createDiv({ cls: "exec-log" });

    for (const event of run.events) {
      this.renderLogEvent(log, event);
    }
    log.createSpan({ cls: "log-cursor", text: "▌" });

    // Auto-scroll to bottom
    requestAnimationFrame(() => {
      log.scrollTop = log.scrollHeight;
    });
  }

  // ============================================================
  //  COMPLETED MODE
  // ============================================================

  private renderCompleted(container: HTMLElement, exec: ExecutionSummary): void {
    const isSuccess = exec.status === "success";
    const isFailed = exec.status === "failed" || exec.status === "error";
    const statusClass = isSuccess ? "success" : isFailed ? "failed" : "aborted";
    const statusIcon = isSuccess ? "✓" : isFailed ? "✗" : "⚠";
    const snapshot = this.store.getCompletedSnapshot(exec.id);

    // Header
    const header = container.createDiv({ cls: `exec-header ${statusClass}` });
    const titleRow = header.createDiv({ cls: "exec-title" });
    titleRow.createSpan({ cls: `agentmd-status-${statusClass}`, text: statusIcon });
    titleRow.createSpan({ text: ` ${exec.agent_id}` });
    titleRow.createSpan({ cls: "exec-id", text: `#${exec.id}` });

    const rerunBtn = titleRow.createEl("button", { cls: "agentmd-btn", text: "↻ Re-run" });
    rerunBtn.style.marginLeft = "auto";
    rerunBtn.addEventListener("click", () => this.actions.onRerun(exec.agent_id));

    // Stats row with all metrics
    const statsRow = header.createDiv({ cls: "exec-stats-grid" });
    this.renderStatBadge(statsRow, "Status", `${statusIcon} ${exec.status}`, `agentmd-status-${statusClass}`);
    this.renderStatBadge(statsRow, "Duration", formatDuration(exec.duration_ms != null ? exec.duration_ms / 1000 : undefined));
    this.renderStatBadge(statsRow, "Tokens", formatTokens(exec.total_tokens));
    this.renderStatBadge(statsRow, "Cost", formatCost(exec.cost_usd));

    // Final answer — rendered as markdown
    if (snapshot?.finalAnswer) {
      const answerSection = container.createDiv({ cls: "exec-final-answer" });
      answerSection.createDiv({ cls: "final-label", text: `${statusIcon} Final Answer` });
      const answerContent = answerSection.createDiv({ cls: "final-content" });
      MarkdownRenderer.render(
        this.app,
        snapshot.finalAnswer,
        answerContent,
        "",
        this.renderComponent!,
      );
    }

    // Execution log (collapsible)
    if (snapshot?.events.length) {
      const logWrapper = container.createDiv({ cls: "exec-log-wrapper" });
      const logHeader = logWrapper.createDiv({ cls: "exec-log-title clickable" });
      logHeader.createSpan({ text: `▶ Execution Log · ${this.countToolCalls(snapshot.events)} tool calls` });

      const log = logWrapper.createDiv({ cls: "exec-log collapsed" });
      for (const event of snapshot.events) {
        this.renderLogEvent(log, event);
      }

      logHeader.addEventListener("click", () => {
        const isCollapsed = log.hasClass("collapsed");
        log.toggleClass("collapsed", !isCollapsed);
        logHeader.empty();
        logHeader.createSpan({
          text: `${isCollapsed ? "▼" : "▶"} Execution Log · ${this.countToolCalls(snapshot.events)} tool calls`,
        });
      });
    } else {
      container.createDiv({
        cls: "agentmd-empty",
        text: "Execution log not available (execution was not observed live).",
      });
    }
  }

  // ============================================================
  //  HELPERS
  // ============================================================

  private renderStatBadge(container: HTMLElement, label: string, value: string, valueCls?: string): void {
    const badge = container.createDiv({ cls: "exec-stat-badge" });
    badge.createDiv({ cls: "exec-stat-label", text: label });
    const valEl = badge.createDiv({ cls: "exec-stat-value", text: value });
    if (valueCls) valEl.addClass(valueCls);
  }

  private countToolCalls(events: ParsedSSEEvent[]): number {
    return events.filter((e) => e.type === "tool_call").length;
  }

  private renderLogEvent(container: HTMLElement, event: ParsedSSEEvent): void {
    if (event.type === "tool_call" && event.data.tools?.length) {
      const line = container.createDiv({ cls: "log-line" });
      line.createSpan({ cls: "log-tool-call", text: `🔧 >> ${event.data.tools[0].name}` });
      if (event.data.tools[0].args) {
        line.createSpan({ cls: "log-args", text: ` ${event.data.tools[0].args}` });
      }
    } else if (event.type === "tool_result") {
      const line = container.createDiv({ cls: "log-line" });
      line.createSpan({ cls: "log-tool-result", text: `📎 << ${event.data.tool_name ?? "result"}` });
      if (event.data.content) {
        line.createSpan({ cls: "log-result-content", text: ` → ${event.data.content}` });
      }
    } else if (event.type === "ai" && event.data.content) {
      const line = container.createDiv({ cls: "log-line log-ai-line" });
      line.createSpan({ cls: "log-ai", text: `🤖 ${event.data.content}` });
    } else if (event.type === "final_answer" && event.data.content) {
      const line = container.createDiv({ cls: "log-line log-final-line" });
      line.createSpan({ cls: "log-ai", text: `✅ ${event.data.content}` });
    }
  }
}
