import { ItemView, WorkspaceLeaf } from "obsidian";
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
        // Execution just completed — re-render to show completed mode
        this.stopTick();
        this.render();
      }
    });
    // Also listen to history changes so we render completed mode
    // when the execution transitions from running → history
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

    const running = this.store.running.get(this.executionId);
    if (running) {
      this.startTick();
      this.renderStreaming(container, running);
    } else {
      this.stopTick();
      // Check history for a completed execution
      const completed = this.store.history.find((e) => e.id === this.executionId);
      if (completed) {
        this.renderCompleted(container, completed);
      } else {
        container.createDiv({ cls: "agentmd-empty", text: "Execution not found." });
      }
    }
  }

  private renderStreaming(container: HTMLElement, run: RunningExecution): void {
    // Header — streaming mode (blue)
    const header = container.createDiv({ cls: "exec-header streaming" });
    const title = header.createDiv({ cls: "exec-title" });
    title.createSpan({ cls: "agentmd-status-running", text: "●" });
    title.createSpan({ text: run.agent });
    title.createSpan({ cls: "exec-id", text: `#${run.id}` });

    const cancelBtn = title.createEl("button", { cls: "agentmd-btn", text: "■ Cancel" });
    cancelBtn.style.marginLeft = "auto";
    cancelBtn.addEventListener("click", () => this.actions.onCancel(run.id));

    // Stats
    const elapsed = Math.round((Date.now() - run.startedAt) / 1000);
    const stats = header.createDiv({ cls: "exec-stats" });
    stats.createSpan({ cls: "agentmd-status-running", text: "● running" });
    stats.createSpan({ text: formatDuration(elapsed) });
    stats.createSpan({ text: formatTokens(run.tokensTotal) });
    stats.createSpan({ text: formatCost(run.costUsd) });

    // Event log
    const log = container.createDiv({ cls: "exec-log" });
    for (const event of run.events) {
      this.renderLogEvent(log, event);
    }
    // Blinking cursor
    log.createSpan({ cls: "log-cursor", text: "▌" });
  }

  private renderCompleted(container: HTMLElement, exec: ExecutionSummary): void {
    const statusClass =
      exec.status === "success" ? "success" :
      exec.status === "failed" ? "failed" : "aborted";

    // Header
    const header = container.createDiv({ cls: `exec-header ${statusClass}` });
    const title = header.createDiv({ cls: "exec-title" });
    const statusIcon = exec.status === "success" ? "✓" : exec.status === "failed" ? "✗" : "⚠";
    title.createSpan({ cls: `agentmd-status-${exec.status === "success" ? "success" : exec.status === "failed" ? "failed" : "aborted"}`, text: statusIcon });
    title.createSpan({ text: exec.agent_id });
    title.createSpan({ cls: "exec-id", text: `#${exec.id}` });

    const rerunBtn = title.createEl("button", { cls: "agentmd-btn", text: "↻ Re-run" });
    rerunBtn.style.marginLeft = "auto";
    rerunBtn.addEventListener("click", () => this.actions.onRerun(exec.agent_id));

    // Stats
    const stats = header.createDiv({ cls: "exec-stats" });
    stats.createSpan({ cls: `agentmd-status-${statusClass}`, text: `${statusIcon} ${exec.status}` });
    stats.createSpan({ text: formatDuration(exec.duration_ms != null ? exec.duration_ms / 1000 : undefined) });
    stats.createSpan({ text: formatTokens(exec.total_tokens) });
    stats.createSpan({ text: formatCost(exec.cost_usd) });

    // Show final answer + event log from the snapshot (if we observed this execution live)
    const snapshot = this.store.getCompletedSnapshot(exec.id);
    if (snapshot?.finalAnswer) {
      const answerBox = container.createDiv({ cls: "exec-final-answer" });
      answerBox.createDiv({ cls: "final-label", text: `${statusIcon} Final answer` });
      answerBox.createDiv({ cls: "final-content", text: snapshot.finalAnswer });
    }

    if (snapshot?.events.length) {
      const logSection = container.createDiv({ cls: "exec-log" });
      for (const event of snapshot.events) {
        this.renderLogEvent(logSection, event);
      }
    } else {
      container.createDiv({
        cls: "agentmd-empty",
        text: "Execution log not available (execution was not observed live).",
      });
    }
  }

  private renderLogEvent(container: HTMLElement, event: ParsedSSEEvent): void {
    const line = container.createDiv();
    if (event.type === "tool_call" && event.data.tools?.length) {
      line.createSpan({ cls: "log-tool-call", text: `🔧 >> ${event.data.tools[0].name}` });
      if (event.data.tools[0].args) {
        line.createSpan({ text: ` (${event.data.tools[0].args})`, cls: "exec-meta" });
      }
    } else if (event.type === "tool_result") {
      line.createSpan({ cls: "log-tool-result", text: `📎 << ${event.data.tool_name ?? "result"}` });
      if (event.data.content) {
        line.createSpan({ text: ` → ${event.data.content}`, cls: "exec-meta" });
      }
    } else if (event.type === "ai" && event.data.content) {
      line.createSpan({ cls: "log-ai", text: `🤖 ${event.data.content}` });
    } else if (event.type === "final_answer" && event.data.content) {
      line.createSpan({ cls: "log-ai", text: `✅ ${event.data.content}` });
    }
  }
}
