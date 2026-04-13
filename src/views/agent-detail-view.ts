import { Component, ItemView, WorkspaceLeaf } from "obsidian";
import type { EventStore } from "../store/event-store";
import type { AgentDetail, ExecutionSummary } from "../types";
import { VIEW_TYPE_AGENT_DETAIL } from "./constants";
import { formatDuration, formatTokens, formatCost, formatRelativeTime } from "../ui/format";

export interface AgentDetailViewActions {
  onRunAgent: (name: string, withCurrentFile: boolean) => void;
  onOpenSourceFile: (agentName: string) => void;
  onOpenExecution: (executionId: number) => void;
  onOpenExecutions: (agentName: string) => void;
  getCurrentFilePath: () => string | null;
  fetchAgentDetail: (name: string) => Promise<AgentDetail>;
  fetchAgentRuns: (name: string, limit: number) => Promise<ExecutionSummary[]>;
}

export class AgentDetailView extends ItemView {
  private store: EventStore;
  private actions: AgentDetailViewActions;
  private agentName: string = "";
  private detail: AgentDetail | null = null;
  private runs: ExecutionSummary[] = [];
  private renderComponent: Component | null = null;

  constructor(leaf: WorkspaceLeaf, store: EventStore, actions: AgentDetailViewActions) {
    super(leaf);
    this.store = store;
    this.actions = actions;
  }

  getViewType(): string { return VIEW_TYPE_AGENT_DETAIL; }
  getDisplayText(): string { return this.agentName ? `Agent: ${this.agentName}` : "Agent Detail"; }
  getIcon(): string { return "cpu"; }

  async setAgent(name: string): Promise<void> {
    this.agentName = name;
    await this.loadData();
  }

  async onOpen(): Promise<void> {
    if (this.agentName) await this.loadData();
  }

  async onClose(): Promise<void> {
    this.renderComponent?.unload();
  }

  private async loadData(): Promise<void> {
    try {
      [this.detail, this.runs] = await Promise.all([
        this.actions.fetchAgentDetail(this.agentName),
        this.actions.fetchAgentRuns(this.agentName, 10),
      ]);
    } catch {
      this.detail = null;
      this.runs = [];
    }
    this.render();
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("agentmd-agent-detail");

    this.renderComponent?.unload();
    this.renderComponent = new Component();
    this.renderComponent.load();

    if (!this.detail) {
      container.createDiv({ cls: "agentmd-empty", text: `Agent "${this.agentName}" not found or backend offline.` });
      return;
    }

    this.renderHeader(container);
    this.renderStats(container);
    this.renderRecentRuns(container);
    this.renderConfig(container);
  }

  private renderHeader(container: HTMLElement): void {
    const d = this.detail!;
    const header = container.createDiv({ cls: "agent-detail-header" });

    const titleRow = header.createDiv({ cls: "agent-detail-title-row" });
    titleRow.createSpan({ cls: "agent-detail-name", text: d.name });

    // Chips
    const chips = titleRow.createDiv({ cls: "agent-detail-chips" });
    const tt = d.trigger_type ?? "manual";
    if (tt === "schedule") {
      chips.createSpan({ cls: "agentmd-chip scheduled", text: "⏱ Scheduled" });
    } else if (tt === "watch") {
      chips.createSpan({ cls: "agentmd-chip watch", text: "👁 Watch" });
    } else {
      chips.createSpan({ cls: "agentmd-chip manual", text: "Manual" });
    }
    if (d.model_provider || d.model_name) {
      chips.createSpan({ cls: "agentmd-chip model", text: `${d.model_provider ?? "?"} · ${d.model_name ?? "default"}` });
    }

    // Description
    if (d.description) {
      header.createDiv({ cls: "agent-detail-desc", text: d.description });
    }

    // Action buttons
    const actions = header.createDiv({ cls: "agent-detail-actions" });
    const runBtn = actions.createEl("button", { cls: "agentmd-btn", text: "▶ Run" });
    runBtn.addEventListener("click", () => this.actions.onRunAgent(d.name, false));

    const currentFile = this.actions.getCurrentFilePath();
    const runFileBtn = actions.createEl("button", { cls: "agentmd-btn primary", text: "▶ 📄 Run with file" });
    if (!currentFile) { runFileBtn.disabled = true; runFileBtn.title = "Open a note first"; }
    runFileBtn.addEventListener("click", () => this.actions.onRunAgent(d.name, true));

    const openBtn = actions.createEl("button", { cls: "agentmd-btn", text: "📝 Open source" });
    openBtn.addEventListener("click", () => this.actions.onOpenSourceFile(d.name));

    const histBtn = actions.createEl("button", { cls: "agentmd-btn", text: "📊 All executions" });
    histBtn.addEventListener("click", () => this.actions.onOpenExecutions(d.name));
  }

  private renderStats(container: HTMLElement): void {
    if (this.runs.length === 0) return;

    const section = container.createDiv({ cls: "agent-detail-stats" });
    const total = this.runs.length;
    const successes = this.runs.filter((r) => r.status === "success").length;
    const rate = total > 0 ? Math.round((successes / total) * 100) : 0;
    const avgDuration = total > 0
      ? this.runs.reduce((sum, r) => sum + (r.duration_ms ?? 0), 0) / total / 1000
      : 0;
    const totalCost = this.runs.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0);

    this.renderStatBadge(section, "Runs", String(total));
    this.renderStatBadge(section, "Success", `${rate}%`);
    this.renderStatBadge(section, "Avg duration", formatDuration(avgDuration));
    this.renderStatBadge(section, "Total spent", formatCost(totalCost));
  }

  private renderStatBadge(container: HTMLElement, label: string, value: string): void {
    const badge = container.createDiv({ cls: "exec-stat-badge" });
    badge.createDiv({ cls: "exec-stat-label", text: label });
    badge.createDiv({ cls: "exec-stat-value", text: value });
  }

  private renderRecentRuns(container: HTMLElement): void {
    const section = container.createDiv({ cls: "agent-detail-section" });
    const sectionHeader = section.createDiv({ cls: "agent-detail-section-header" });
    sectionHeader.createSpan({ text: "Recent Executions" });
    if (this.runs.length > 5) {
      const link = sectionHeader.createSpan({ cls: "agent-detail-link", text: `view all ${this.runs.length}` });
      link.addEventListener("click", () => this.actions.onOpenExecutions(this.agentName));
    }

    const list = section.createDiv({ cls: "agent-detail-runs" });
    for (const run of this.runs.slice(0, 5)) {
      const row = list.createDiv({ cls: "agentmd-exec-row" });
      row.addEventListener("click", () => this.actions.onOpenExecution(run.id));

      const line1 = row.createDiv({ cls: "exec-row-line1" });
      const icon = run.status === "success" ? "✓" : run.status === "failed" || run.status === "error" ? "✗" : "⚠";
      const cls = run.status === "success" ? "agentmd-status-success" : run.status === "failed" || run.status === "error" ? "agentmd-status-failed" : "agentmd-status-aborted";
      line1.createSpan({ cls, text: icon });
      line1.createSpan({ cls: "exec-row-id", text: ` #${run.id}` });
      line1.createSpan({ cls: "exec-row-time", text: formatRelativeTime(run.started_at) });

      const line2 = row.createDiv({ cls: "exec-row-line2" });
      line2.createSpan({ text: formatDuration(run.duration_ms != null ? run.duration_ms / 1000 : undefined) });
      line2.createSpan({ text: formatTokens(run.total_tokens) });
      line2.createSpan({ text: formatCost(run.cost_usd) });
    }
  }

  private renderConfig(container: HTMLElement): void {
    const d = this.detail!;
    const section = container.createDiv({ cls: "agent-detail-section" });
    section.createDiv({ cls: "agent-detail-section-header" }).createSpan({ text: "Configuration" });

    const config = section.createDiv({ cls: "agent-detail-config" });

    // Trigger
    this.renderConfigRow(config, "Trigger", d.trigger_type ?? "manual");

    // Model
    if (d.model_provider || d.model_name) {
      this.renderConfigRow(config, "Model", `${d.model_provider}/${d.model_name}`);
    }

    // Next run
    if (d.next_run) {
      this.renderConfigRow(config, "Next run", d.next_run);
    }

    // Last run
    if (d.last_run) {
      this.renderConfigRow(config, "Last run", formatRelativeTime(d.last_run));
    }

    // Settings (limits)
    const settings = d.settings as Record<string, unknown>;
    if (settings) {
      if (settings.max_tool_calls != null) {
        this.renderConfigRow(config, "Max tool calls", String(settings.max_tool_calls));
      }
      if (settings.max_cost_usd != null) {
        this.renderConfigRow(config, "Max cost", `$${settings.max_cost_usd}`);
      }
      if (settings.max_execution_tokens != null) {
        this.renderConfigRow(config, "Max tokens", formatTokens(settings.max_execution_tokens as number));
      }
      if (settings.temperature != null) {
        this.renderConfigRow(config, "Temperature", String(settings.temperature));
      }
    }
  }

  private renderConfigRow(container: HTMLElement, label: string, value: string): void {
    const row = container.createDiv({ cls: "agent-detail-config-row" });
    row.createSpan({ cls: "config-label", text: label });
    row.createSpan({ cls: "config-value", text: value });
  }
}
