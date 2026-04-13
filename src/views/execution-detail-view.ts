import { Component, ItemView, MarkdownRenderer, WorkspaceLeaf } from "obsidian";
import type { EventStore, RunningExecution, CompletedSnapshot } from "../store/event-store";
import type { ExecutionSummary, LogEntry, ParsedSSEEvent } from "../types";
import { VIEW_TYPE_EXEC_DETAIL } from "./constants";
import { formatDuration, formatTokens, formatCost } from "../ui/format";

export interface ExecDetailActions {
  onCancel: (executionId: number) => void;
  onRerun: (agentName: string, args?: string[]) => void;
  fetchExecution: (id: number) => Promise<ExecutionSummary | null>;
  fetchExecutionMessages: (id: number) => Promise<LogEntry[]>;
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

  private tickCount = 0;

  private startTick(): void {
    if (this.tickTimer) return;
    this.tickCount = 0;
    this.tickTimer = setInterval(() => {
      this.tickCount++;
      // Every 3 ticks (3s), verify with the API that the execution is still running.
      // If the SSE complete event was missed, this catches it.
      if (this.tickCount % 3 === 0 && this.store.running.has(this.executionId)) {
        void this.verifyStillRunning();
      }
      this.render();
    }, 1000);
  }

  private async verifyStillRunning(): Promise<void> {
    const exec = await this.actions.fetchExecution(this.executionId);
    if (exec && exec.status !== "running" && exec.status !== "pending") {
      // API says it's done but store still has it as running — force transition
      this.store.completeExecution(this.executionId, exec);
    }
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

    this.renderComponent?.unload();
    this.renderComponent = new Component();
    this.renderComponent.load();

    // If running → show streaming mode with live SSE data
    const running = this.store.running.get(this.executionId);
    if (running) {
      this.startTick();
      this.renderStreaming(container, running);
      return;
    }

    this.stopTick();

    // For completed executions → always fetch from API (source of truth)
    if (this.executionId > 0) {
      container.createDiv({ cls: "agentmd-empty", text: "Loading…" });
      void this.fetchAndRender();
    } else {
      container.createDiv({ cls: "agentmd-empty", text: "No execution selected." });
    }
  }

  private async fetchAndRender(): Promise<void> {
    const [exec, messages] = await Promise.all([
      this.actions.fetchExecution(this.executionId),
      this.actions.fetchExecutionMessages(this.executionId).catch(() => [] as LogEntry[]),
    ]);

    if (!exec) {
      const container = this.contentEl;
      container.empty();
      container.addClass("agentmd-exec-detail");
      container.createDiv({ cls: "agentmd-empty", text: "Execution not found." });
      return;
    }

    const container = this.contentEl;
    container.empty();
    container.addClass("agentmd-exec-detail");

    this.renderComponent?.unload();
    this.renderComponent = new Component();
    this.renderComponent.load();

    this.renderCompleted(container, exec, messages);
  }

  // ============================================================
  //  STREAMING MODE
  // ============================================================

  private renderStreaming(container: HTMLElement, run: RunningExecution): void {
    const header = container.createDiv({ cls: "exec-header streaming" });

    // Row 1: ● name #id                      ■ Stop
    const titleRow = header.createDiv({ cls: "exec-title" });
    titleRow.createSpan({ cls: "agentmd-status-running", text: "●" });
    titleRow.createSpan({ cls: "exec-name", text: ` ${run.agent}` });
    titleRow.createSpan({ cls: "exec-id", text: `#${run.id}` });

    const cancelBtn = titleRow.createEl("button", { cls: "agentmd-btn", text: "■ Stop" });
    cancelBtn.style.marginLeft = "auto";
    cancelBtn.addEventListener("click", () => {
      cancelBtn.setText("Stopping…");
      cancelBtn.disabled = true;
      this.actions.onCancel(run.id);
    });

    // Row 2: trigger · running · elapsed
    const elapsed = Math.round((Date.now() - run.startedAt) / 1000);
    const meta = header.createDiv({ cls: "exec-meta-line" });
    meta.createSpan({ cls: "exec-meta-item", text: run.triggerSource });
    meta.createSpan({ cls: "exec-meta-sep", text: "·" });
    meta.createSpan({ cls: "exec-meta-item agentmd-status-running", text: "running" });
    meta.createSpan({ cls: "exec-meta-sep", text: "·" });
    meta.createSpan({ cls: "exec-meta-item", text: formatDuration(elapsed) });

    // Log area
    const logWrapper = container.createDiv({ cls: "exec-log-wrapper" });
    logWrapper.createDiv({ cls: "exec-log-title", text: "Execution Log" });
    const log = logWrapper.createDiv({ cls: "exec-log" });

    for (const event of run.events) {
      this.renderLogEvent(log, event);
    }
    log.createSpan({ cls: "log-cursor", text: "▌" });

    requestAnimationFrame(() => {
      log.scrollTop = log.scrollHeight;
    });
  }

  // ============================================================
  //  COMPLETED MODE
  // ============================================================

  private renderCompleted(container: HTMLElement, exec: ExecutionSummary, apiMessages?: LogEntry[]): void {
    const isSuccess = exec.status === "success";
    const isFailed = exec.status === "failed" || exec.status === "error";
    const statusClass = isSuccess ? "success" : isFailed ? "failed" : "aborted";
    const statusIcon = isSuccess ? "✓" : isFailed ? "✗" : "⚠";
    const statusLabel = isSuccess ? "success" : isFailed ? "failed" : exec.status;
    const snapshot = this.store.getCompletedSnapshot(exec.id);

    // Convert API messages to ParsedSSEEvent format (if no live snapshot)
    const logEvents: ParsedSSEEvent[] = snapshot?.events ?? (apiMessages ?? []).map((m) => ({
      type: m.event_type,
      id: String(m.id),
      data: { event_type: m.event_type, message: m.message },
    }));

    // Extract final answer from snapshot or from API messages
    const finalAnswerFromLog = logEvents
      .filter((e) => e.type === "final_answer")
      .map((e) => e.data.content ?? e.data.message ?? "")
      .join("\n");
    const finalAnswer = snapshot?.finalAnswer ?? (finalAnswerFromLog || null);

    const header = container.createDiv({ cls: `exec-header ${statusClass}` });

    // Row 1: ✓ name #id                      ↻ Re-run
    const titleRow = header.createDiv({ cls: "exec-title" });
    titleRow.createSpan({ cls: `agentmd-status-${statusClass}`, text: statusIcon });
    titleRow.createSpan({ cls: "exec-name", text: ` ${exec.agent_id}` });
    titleRow.createSpan({ cls: "exec-id", text: `#${exec.id}` });

    const rerunBtn = titleRow.createEl("button", { cls: "agentmd-btn", text: "↻ Re-run" });
    rerunBtn.style.marginLeft = "auto";
    rerunBtn.addEventListener("click", () => this.actions.onRerun(exec.agent_id));

    // Row 2: trigger · status · duration
    const meta = header.createDiv({ cls: "exec-meta-line" });
    if (exec.trigger) {
      meta.createSpan({ cls: "exec-meta-item", text: exec.trigger });
      meta.createSpan({ cls: "exec-meta-sep", text: "·" });
    }
    meta.createSpan({ cls: `exec-meta-item agentmd-status-${statusClass}`, text: statusLabel });
    if (exec.duration_ms != null) {
      meta.createSpan({ cls: "exec-meta-sep", text: "·" });
      meta.createSpan({ cls: "exec-meta-item", text: formatDuration(exec.duration_ms / 1000) });
    }

    // Row 3: input · output · total tokens · cost
    const hasTokens = exec.input_tokens != null || exec.output_tokens != null || exec.total_tokens != null;
    if (hasTokens || exec.cost_usd != null) {
      const stats = header.createDiv({ cls: "exec-meta-line exec-stats-line" });
      if (exec.input_tokens != null) {
        stats.createSpan({ cls: "exec-meta-item", text: `${this.fmtNum(exec.input_tokens)} input` });
      }
      if (exec.output_tokens != null) {
        if (exec.input_tokens != null) stats.createSpan({ cls: "exec-meta-sep", text: "·" });
        stats.createSpan({ cls: "exec-meta-item", text: `${this.fmtNum(exec.output_tokens)} output` });
      }
      if (exec.total_tokens != null) {
        if (exec.input_tokens != null || exec.output_tokens != null) stats.createSpan({ cls: "exec-meta-sep", text: "·" });
        stats.createSpan({ cls: "exec-meta-item exec-meta-highlight", text: `${this.fmtNum(exec.total_tokens)} total` });
      }
      if (exec.cost_usd != null) {
        stats.createSpan({ cls: "exec-meta-sep", text: "·" });
        stats.createSpan({ cls: "exec-meta-item", text: formatCost(exec.cost_usd) });
      }
    }

    // Error message
    if (exec.error) {
      const errorLine = header.createDiv({ cls: "exec-error-line" });
      errorLine.createSpan({ text: exec.error });
    }

    // Final answer — rendered as markdown
    if (finalAnswer) {
      const answerSection = container.createDiv({ cls: "exec-final-answer" });
      answerSection.createDiv({ cls: "final-label", text: `${statusIcon} Final Answer` });
      const answerContent = answerSection.createDiv({ cls: "final-content" });
      MarkdownRenderer.render(
        this.app,
        finalAnswer,
        answerContent,
        "",
        this.renderComponent!,
      );
    }

    // Execution log (collapsible)
    const toolCalls = this.countToolCalls(logEvents);
    if (logEvents.length > 0) {
      const logWrapper = container.createDiv({ cls: "exec-log-wrapper" });
      const logHeader = logWrapper.createDiv({ cls: "exec-log-title clickable" });
      logHeader.createSpan({ text: `▶ Execution Log · ${toolCalls} tool calls` });

      const log = logWrapper.createDiv({ cls: "exec-log collapsed" });
      for (const event of logEvents) {
        this.renderLogEvent(log, event);
      }

      logHeader.addEventListener("click", () => {
        const isCollapsed = log.hasClass("collapsed");
        log.toggleClass("collapsed", !isCollapsed);
        logHeader.empty();
        logHeader.createSpan({
          text: `${isCollapsed ? "▼" : "▶"} Execution Log · ${toolCalls} tool calls`,
        });
      });
    }
  }

  // ============================================================
  //  HELPERS
  // ============================================================

  private fmtNum(n: number): string {
    if (n < 1000) return String(n);
    return `${(n / 1000).toFixed(1)}k`;
  }

  private countToolCalls(events: ParsedSSEEvent[]): number {
    return events.filter((e) => e.type === "tool_call").length;
  }

  /**
   * Renders a single SSE event as a log line. Handles two formats:
   * - Live events: structured fields (tools, tool_name, content)
   * - Replayed events from DB: flat { event_type, message } format
   */
  private renderLogEvent(container: HTMLElement, event: ParsedSSEEvent): void {
    const msg = event.data.content ?? event.data.message ?? "";

    if (event.type === "tool_call") {
      const line = container.createDiv({ cls: "log-line" });
      if (event.data.tools?.length) {
        line.createSpan({ cls: "log-tool-call", text: `🔧 >> ${event.data.tools[0].name}` });
        if (event.data.tools[0].args) {
          line.createSpan({ cls: "log-args", text: ` ${event.data.tools[0].args}` });
        }
      } else if (msg) {
        line.createSpan({ cls: "log-tool-call", text: `🔧 >> ${msg}` });
      }
    } else if (event.type === "tool_result") {
      const line = container.createDiv({ cls: "log-line" });
      if (event.data.tool_name) {
        line.createSpan({ cls: "log-tool-result", text: `📎 << ${event.data.tool_name}` });
        if (msg) line.createSpan({ cls: "log-result-content", text: ` → ${msg}` });
      } else if (msg) {
        line.createSpan({ cls: "log-tool-result", text: `📎 << ${msg}` });
      }
    } else if (event.type === "ai" && msg) {
      const line = container.createDiv({ cls: "log-line log-ai-line" });
      line.createSpan({ cls: "log-ai", text: `🤖 ${msg}` });
    } else if (event.type === "final_answer" && msg) {
      const line = container.createDiv({ cls: "log-line log-final-line" });
      line.createSpan({ cls: "log-ai", text: `✅ ${msg}` });
    } else if (event.type === "meta" && msg) {
      const line = container.createDiv({ cls: "log-line" });
      line.createSpan({ cls: "log-args", text: `ℹ ${msg}` });
    }
  }
}
