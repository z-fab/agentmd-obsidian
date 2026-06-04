import { Component, MarkdownRenderer } from "obsidian";
import type { PanelContext } from "../panel-view";
import type { RunningExecution } from "../../store/event-store";
import type { ExecutionSummary, LogEntry, ParsedSSEEvent } from "../../types";
import { formatDuration, formatCost } from "../../ui/format";

export class ExecutionDetailScreen {
  private container: HTMLElement | null = null;
  private id = 0;
  private renderComponent: Component | null = null;
  private loadSeq = 0;
  private verifyCounter = 0;
  private cachedExec: ExecutionSummary | null = null;
  private cachedMessages: LogEntry[] = [];

  constructor(private ctx: PanelContext) {}

  render(container: HTMLElement, id: number): void {
    if (id !== this.id) {
      this.verifyCounter = 0;
      this.cachedExec = null;
      this.cachedMessages = [];
    }
    this.id = id;
    this.container = container;

    this.renderComponent?.unload();
    this.renderComponent = new Component();
    this.renderComponent.load();

    if (this.ctx.store.running.has(id)) {
      this.renderStreaming(container, this.ctx.store.running.get(id)!);
    } else if (id > 0) {
      if (this.cachedExec && this.cachedExec.id === id) {
        this.renderCompleted(container, this.cachedExec, this.cachedMessages);
      } else {
        container.createDiv({ cls: "agentmd-empty", text: "Carregando…" });
        void this.fetchAndRender(id);
      }
    } else {
      container.createDiv({ cls: "agentmd-empty", text: "No execution selected." });
    }
  }

  /** Called by PanelView's 1s tick while a running execution is shown — catches a missed `complete`. */
  verifyStillRunning(): void {
    if (!this.ctx.store.running.has(this.id)) return;
    this.verifyCounter++;
    if (this.verifyCounter % 3 !== 0) return;
    void (async () => {
      const exec = await this.ctx.actions.fetchExecution(this.id);
      if (exec && exec.status !== "running" && exec.status !== "pending") {
        this.ctx.store.completeExecution(this.id, exec);
      }
    })();
  }

  /** Called by PanelView.onClose to clean up the markdown render Component. */
  dispose(): void {
    this.renderComponent?.unload();
    this.renderComponent = null;
    this.container = null;
    this.cachedExec = null;
    this.cachedMessages = [];
  }

  private async fetchAndRender(id: number): Promise<void> {
    const seq = ++this.loadSeq;
    const [exec, messages] = await Promise.all([
      this.ctx.actions.fetchExecution(id),
      this.ctx.actions.fetchExecutionMessages(id).catch(() => [] as LogEntry[]),
    ]);

    if (seq !== this.loadSeq || !this.container) return; // superseded or detached
    this.container.empty();

    if (!exec) {
      this.container.createDiv({ cls: "agentmd-empty", text: "Execution not found." });
      return;
    }

    this.cachedExec = exec;
    this.cachedMessages = messages ?? [];
    this.renderCompleted(this.container, exec, this.cachedMessages);
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
      this.ctx.actions.onCancelExecution(run.id);
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
    const snapshot = this.ctx.store.getCompletedSnapshot(exec.id);

    // Convert API messages to ParsedSSEEvent format (if no live snapshot)
    const logEvents: ParsedSSEEvent[] = snapshot?.events ?? (apiMessages ?? []).map((m) => {
      const data: Record<string, unknown> = { event_type: m.event_type, message: m.message };
      // Parse "tool_name — result" format from DB replay
      if ((m.event_type === "tool_response" || m.event_type === "tool_result") && m.message.includes(" — ")) {
        const sep = m.message.indexOf(" — ");
        data.tool_name = m.message.slice(0, sep);
        data.message = m.message.slice(sep + 3);
      }
      // Parse "tool_name — args: {...}" format for tool_call from DB replay
      if (m.event_type === "tool_call" && m.message.includes(" — args: ")) {
        const sep = m.message.indexOf(" — args: ");
        const toolName = m.message.slice(0, sep);
        const argsStr = m.message.slice(sep + 9);
        data.tools = [{ name: toolName, args: argsStr }];
        data.message = m.message;
      }
      return { type: m.event_type, id: String(m.id), data } as ParsedSSEEvent;
    });

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
    rerunBtn.addEventListener("click", () => this.ctx.actions.onRerun(exec.agent_id));

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
        this.ctx.app,
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
    let count = 0;
    for (const e of events) {
      if (e.type === "tool_call") {
        count += e.data.tools?.length ?? 1;
      }
    }
    return count;
  }

  /**
   * Renders a single SSE event as a log line. Handles two formats:
   * - Live events: structured fields (tools, tool_name, content)
   * - Replayed events from DB: flat { event_type, message } format
   */
  private renderLogEvent(container: HTMLElement, event: ParsedSSEEvent): void {
    const msg = event.data.content ?? event.data.message ?? "";

    if (event.type === "tool_call") {
      if (event.data.tools?.length) {
        for (const tool of event.data.tools) {
          const line = container.createDiv({ cls: "log-line" });
          line.createSpan({ cls: "log-tool-call", text: `🔧 >> ${tool.name}` });
          if (tool.args) {
            line.createSpan({ cls: "log-args", text: ` ${tool.args}` });
          }
        }
      } else if (msg) {
        const line = container.createDiv({ cls: "log-line" });
        line.createSpan({ cls: "log-tool-call", text: `🔧 >> ${msg}` });
      }
    } else if (event.type === "tool_result" || event.type === "tool_response") {
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
    } else if (event.type === "system" && msg) {
      const line = container.createDiv({ cls: "log-line log-system-line" });
      const header = line.createSpan({ cls: "log-system-label clickable", text: "▶ System Prompt" });
      const content = line.createDiv({ cls: "log-system-content collapsed" });
      content.createSpan({ text: msg });
      header.addEventListener("click", () => {
        const isCollapsed = content.hasClass("collapsed");
        content.toggleClass("collapsed", !isCollapsed);
        header.setText(isCollapsed ? "▼ System Prompt" : "▶ System Prompt");
      });
    } else if (event.type === "human" && msg) {
      const line = container.createDiv({ cls: "log-line log-human-line" });
      line.createSpan({ cls: "log-human", text: `👤 ${msg}` });
    } else if (event.type === "meta" && msg) {
      const line = container.createDiv({ cls: "log-line" });
      line.createSpan({ cls: "log-args", text: `ℹ ${msg}` });
    }
  }
}
