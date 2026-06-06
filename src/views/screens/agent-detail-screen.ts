import type { PanelContext } from "../panel-view";
import type { AgentDetail, ExecutionSummary } from "../../types";
import { createEmojiBox, createRunningPill, createWaitingPill } from "../../ui/cards";
import { formatDuration, formatTokens, formatCost, formatRelativeTime } from "../../ui/format";

export class AgentDetailScreen {
  private container: HTMLElement | null = null;
  private name = "";
  private detail: AgentDetail | null = null;
  private runs: ExecutionSummary[] = [];
  private loading = false;
  private loadSeq = 0;

  constructor(private ctx: PanelContext) {}

  render(container: HTMLElement, name: string): void {
    this.container = container;
    container.addClass("agentmd-agent-detail");
    if (name !== this.name) {
      this.name = name;
      this.detail = null;
      this.runs = [];
      this.loading = true;
      void this.load();
    }
    this.paint();
  }

  private async load(): Promise<void> {
    const seq = ++this.loadSeq;
    this.loading = true;
    this.paint();
    try {
      const [d, r] = await Promise.all([
        this.ctx.actions.fetchAgentDetail(this.name),
        this.ctx.actions.fetchAgentRuns(this.name, 10),
      ]);
      if (seq !== this.loadSeq) return;
      this.detail = d;
      this.runs = r;
    } catch {
      if (seq !== this.loadSeq) return;
      this.detail = null;
      this.runs = [];
    }
    this.loading = false;
    this.paint();
  }

  private paint(): void {
    if (!this.container) return;
    const container = this.container;
    container.empty();

    if (this.loading && !this.detail) {
      container.createDiv({ cls: "agentmd-empty", text: "Loading…" });
      return;
    }
    if (!this.detail) {
      container.createDiv({ cls: "agentmd-empty", text: `Agent "${this.name}" not found or backend offline.` });
      return;
    }

    this.renderHeader(container);
    this.renderStats(container);
    this.renderRecentRuns(container);
    this.renderConfig(container);
  }

  /** Find this agent's active executions, split into running vs waiting. */
  private findActive(): { runningId: number | null; waitingIds: number[] } {
    let runningId: number | null = null;
    const waitingIds: number[] = [];
    for (const [id, run] of this.ctx.store.running) {
      if (run.agent !== this.name) continue;
      if (run.state === "waiting") waitingIds.push(id);
      else if (runningId === null) runningId = id;
    }
    return { runningId, waitingIds };
  }

  private renderHeader(container: HTMLElement): void {
    const d = this.detail!;
    const { runningId, waitingIds } = this.findActive();
    const header = container.createDiv({ cls: "agent-detail-header" });

    // Row 1: emoji box + name + status pills
    const titleRow = header.createDiv({ cls: "exec-title" });
    createEmojiBox(titleRow, d.icon || "🤖", runningId !== null ? "running" : undefined);
    titleRow.createSpan({ cls: "exec-name agent-detail-name", text: d.name });
    if (runningId !== null) {
      createRunningPill(titleRow, "Running", () => this.ctx.nav.push({ kind: "execution", id: runningId }));
    }
    if (waitingIds.length > 0) {
      createWaitingPill(titleRow, String(waitingIds.length), () => this.ctx.nav.push({ kind: "execution", id: waitingIds[0] }));
    }

    // Row 2: trigger · model · next run
    const meta = header.createDiv({ cls: "exec-meta-line" });
    const tt = d.trigger_type ?? "manual";
    const triggerCls = tt === "schedule" ? "agentmd-trigger-scheduler" : tt === "watch" ? "agentmd-trigger-watch" : "agentmd-trigger-manual";
    const triggerLabel = tt === "schedule" ? "⏱ Scheduled" : tt === "watch" ? "👁 Watch" : "Manual";
    meta.createSpan({ cls: `exec-meta-item ${triggerCls}`, text: triggerLabel });

    if (d.model_provider || d.model_name) {
      meta.createSpan({ cls: "exec-meta-sep", text: "·" });
      meta.createSpan({ cls: "exec-meta-item", text: `${d.model_provider ?? "?"} · ${d.model_name ?? "default"}` });
    }
    if (d.next_run) {
      meta.createSpan({ cls: "exec-meta-sep", text: "·" });
      meta.createSpan({ cls: "exec-meta-item", text: `next: ${formatRelativeTime(d.next_run)}` });
    }

    // Row 3: description
    if (d.description) {
      header.createDiv({ cls: "agent-detail-desc", text: d.description });
    }

    // Row 4: action buttons
    const actions = header.createDiv({ cls: "agent-detail-actions" });

    if (runningId !== null) {
      const stopBtn = actions.createEl("button", { cls: "agentmd-btn danger", text: "■ Stop" });
      stopBtn.addEventListener("click", () => this.ctx.actions.onCancelExecution(runningId));
    } else {
      const runBtn = actions.createEl("button", { cls: "agentmd-btn", text: "▶ Run" });
      runBtn.addEventListener("click", () => this.ctx.actions.onRunAgent(d.name, false));

      const currentFile = this.ctx.actions.getCurrentFilePath();
      const runFileBtn = actions.createEl("button", { cls: "agentmd-btn primary", text: "▶ 📄 Run with file" });
      if (!currentFile) { runFileBtn.disabled = true; runFileBtn.title = "Open a note first"; }
      runFileBtn.addEventListener("click", () => this.ctx.actions.onRunAgent(d.name, true));
    }

    const openBtn = actions.createEl("button", { cls: "agentmd-btn", text: "📝 Open source" });
    openBtn.addEventListener("click", () => this.ctx.actions.onOpenSourceFile(d.name));

    const histBtn = actions.createEl("button", { cls: "agentmd-btn", text: "📊 All executions" });
    histBtn.addEventListener("click", () => this.ctx.nav.openHistoryForAgent(d.name));
  }

  private renderStats(container: HTMLElement): void {
    if (this.runs.length === 0) return;

    const total = this.runs.length;
    const successes = this.runs.filter((r) => r.status === "success").length;
    const rate = total > 0 ? Math.round((successes / total) * 100) : 0;
    const avgDuration = total > 0
      ? this.runs.reduce((sum, r) => sum + (r.duration_ms ?? 0), 0) / total / 1000
      : 0;
    const totalCost = this.runs.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0);

    const statsSection = container.createDiv({ cls: "agent-detail-stats-section" });
    const stats = statsSection.createDiv({ cls: "exec-meta-line exec-stats-line" });
    stats.createSpan({ cls: "exec-meta-item", text: `${total} runs` });
    stats.createSpan({ cls: "exec-meta-sep", text: "·" });
    stats.createSpan({ cls: `exec-meta-item ${rate >= 80 ? "" : "agentmd-status-aborted"}`, text: `${rate}% success` });
    stats.createSpan({ cls: "exec-meta-sep", text: "·" });
    stats.createSpan({ cls: "exec-meta-item", text: `${formatDuration(avgDuration)} avg` });
    stats.createSpan({ cls: "exec-meta-sep", text: "·" });
    stats.createSpan({ cls: "exec-meta-item", text: `${formatCost(totalCost)} total` });
  }

  private renderRecentRuns(container: HTMLElement): void {
    if (this.runs.length === 0) return;

    const sectionHeader = container.createDiv({ cls: "agentmd-section-header" });
    sectionHeader.createSpan({ text: "Recent executions" });
    if (this.runs.length > 5) {
      const link = sectionHeader.createSpan({ cls: "agent-detail-link", text: "view all" });
      link.addEventListener("click", () => this.ctx.nav.openHistoryForAgent(this.name));
    }

    const list = container.createDiv({ cls: "agent-detail-runs" });
    for (const run of this.runs.slice(0, 5)) {
      const row = list.createDiv({ cls: "agentmd-exec-row" });
      row.addEventListener("click", () => this.ctx.nav.push({ kind: "execution", id: run.id }));

      const line1 = row.createDiv({ cls: "exec-row-line1" });
      const isWaiting = run.status === "waiting";
      const icon = isWaiting ? "⏸" : run.status === "success" ? "✓" : run.status === "failed" || run.status === "error" ? "✗" : "⚠";
      const cls = isWaiting ? "agentmd-status-waiting" : run.status === "success" ? "agentmd-status-success" : run.status === "failed" || run.status === "error" ? "agentmd-status-failed" : "agentmd-status-aborted";
      line1.createSpan({ cls, text: icon });
      line1.createSpan({ cls: "exec-row-id", text: ` #${run.id}` });
      if (run.trigger && run.trigger !== "manual") {
        line1.createSpan({ cls: "exec-row-trigger", text: run.trigger === "scheduler" ? " ⏱" : " 👁" });
      }
      line1.createSpan({ cls: "exec-row-time", text: formatRelativeTime(run.started_at) });

      const line2 = row.createDiv({ cls: "exec-row-line2" });
      line2.createSpan({ text: formatDuration(run.duration_ms != null ? run.duration_ms / 1000 : undefined) });
      line2.createSpan({ text: formatTokens(run.total_tokens) });
      line2.createSpan({ text: formatCost(run.cost_usd) });
    }
  }

  private renderConfig(container: HTMLElement): void {
    const d = this.detail!;
    container.createDiv({ cls: "agentmd-section-header" }).createSpan({ text: "Configuration" });

    const config = container.createDiv({ cls: "agentmd-config-section" });

    // Trigger
    if (d.trigger_type) {
      this.renderConfigRow(config, "Trigger", d.trigger_type);
    }

    // Model
    if (d.model_provider || d.model_name) {
      this.renderConfigRow(config, "Model", `${d.model_provider}/${d.model_name}`);
    }

    // Paths
    if (d.paths && Object.keys(d.paths).length > 0) {
      const pills = Object.entries(d.paths).map(([alias, dir]) => `${alias} → ${dir}`);
      this.renderConfigPills(config, "Paths", pills);
    }

    // Tools
    if (d.custom_tools && d.custom_tools.length > 0) {
      this.renderConfigPills(config, "Tools", d.custom_tools);
    }

    // MCP
    if (d.mcp && d.mcp.length > 0) {
      this.renderConfigPills(config, "MCP", d.mcp);
    }

    // Skills
    if (d.skills && d.skills.length > 0) {
      this.renderConfigPills(config, "Skills", d.skills);
    }

    // Schedule
    if (d.trigger_every) {
      this.renderConfigRow(config, "Every", d.trigger_every);
    }
    if (d.trigger_cron) {
      this.renderConfigRow(config, "Cron", d.trigger_cron);
    }

    // Watch paths
    if (d.trigger_paths && d.trigger_paths.length > 0) {
      this.renderConfigPills(config, "Watch paths", d.trigger_paths);
    }

    // Limits (combined row, " · " separated)
    const settings = (d.settings ?? {}) as Record<string, unknown>;
    const limits: string[] = [];
    if (settings.max_tool_calls != null) limits.push(`${settings.max_tool_calls} tool calls`);
    if (settings.max_cost_usd != null) limits.push(`$${settings.max_cost_usd}`);
    if (settings.max_execution_tokens != null) limits.push(formatTokens(settings.max_execution_tokens as number));
    if (settings.temperature != null) limits.push(`temp ${settings.temperature}`);
    if (limits.length > 0) {
      this.renderConfigRow(config, "Limits", limits.join(" · "));
    }

    // Last run
    if (d.last_run) {
      this.renderConfigRow(config, "Last run", formatRelativeTime(d.last_run));
    }

    // Source
    if (d.source_path) {
      this.renderConfigRow(config, "Source", d.source_path);
    }
  }

  private renderConfigRow(container: HTMLElement, label: string, value: string): void {
    const row = container.createDiv({ cls: "agentmd-config-row" });
    row.createSpan({ cls: "agentmd-config-label", text: label });
    row.createSpan({ cls: "agentmd-config-value", text: value });
  }

  private renderConfigPills(container: HTMLElement, label: string, items: string[]): void {
    const row = container.createDiv({ cls: "agentmd-config-row" });
    row.createSpan({ cls: "agentmd-config-label", text: label });
    const value = row.createSpan({ cls: "agentmd-config-value" });
    for (const item of items) {
      value.createSpan({ cls: "agentmd-config-pill", text: item });
    }
  }
}
