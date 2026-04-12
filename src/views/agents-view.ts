import { ItemView, WorkspaceLeaf } from "obsidian";
import type { AgentSummary } from "../types";
import type { EventStore } from "../store/event-store";
import { VIEW_TYPE_AGENTS } from "./constants";

/** Callback provided by the plugin to handle user actions. */
export interface AgentsViewActions {
  onRunAgent: (name: string, withCurrentFile: boolean) => void;
  onRefreshAgents: () => void;
  getCurrentFilePath: () => string | null;
}

export class AgentsView extends ItemView {
  private store: EventStore;
  private actions: AgentsViewActions;
  private unsubAgents: (() => void) | null = null;
  private unsubRunning: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, store: EventStore, actions: AgentsViewActions) {
    super(leaf);
    this.store = store;
    this.actions = actions;
  }

  getViewType(): string { return VIEW_TYPE_AGENTS; }
  getDisplayText(): string { return "Agents"; }
  getIcon(): string { return "cpu"; }

  async onOpen(): Promise<void> {
    this.render();
    this.unsubAgents = this.store.onAgentsChanged(() => this.render());
    this.unsubRunning = this.store.onRunningChanged(() => this.render());
  }

  async onClose(): Promise<void> {
    this.unsubAgents?.();
    this.unsubRunning?.();
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("agentmd-agents-view");

    // Header
    const header = container.createDiv({ cls: "agentmd-view-header" });
    const left = header.createDiv({ cls: "agentmd-header-left" });
    left.createSpan({ cls: "agentmd-view-icon", text: "◆" });
    left.createSpan({ cls: "agentmd-header-title", text: "Agents" });
    if (this.store.agents.length > 0) {
      left.createSpan({ cls: "agentmd-header-badge", text: String(this.store.agents.length) });
    }
    const refreshBtn = header.createEl("button", { cls: "agentmd-header-action", text: "↻" });
    refreshBtn.title = "Refresh agent list";
    refreshBtn.addEventListener("click", () => this.actions.onRefreshAgents());

    // Agent cards
    if (this.store.agents.length === 0) {
      container.createDiv({ cls: "agentmd-empty", text: "No agents found. Is the backend running?" });
      return;
    }

    for (const agent of this.store.agents) {
      this.renderCard(container, agent);
    }
  }

  private renderCard(container: HTMLElement, agent: AgentSummary): void {
    const isRunning = this.isAgentRunning(agent.name);
    const card = container.createDiv({ cls: `agentmd-agent-card ${isRunning ? "is-running" : ""}` });

    // Row 1: name + trigger chip + menu
    const headerEl = card.createDiv({ cls: "agent-header" });
    headerEl.createSpan({ cls: "agent-name", text: agent.name });
    this.renderTriggerChip(headerEl, agent, isRunning);

    // Row 2: description
    if (agent.description) {
      card.createDiv({ cls: "agent-desc", text: agent.description });
    }

    // Row 3: model chip + run buttons
    const footer = card.createDiv({ cls: "agent-footer" });
    if (agent.model_provider || agent.model_name) {
      const modelText = `${agent.model_provider ?? "?"} · ${agent.model_name ?? "default"}`;
      footer.createSpan({ cls: "agentmd-chip model", text: modelText });
    }

    const actions = footer.createDiv({ cls: "agent-actions" });

    // Run button (no args)
    const runBtn = actions.createEl("button", { cls: "agentmd-btn", text: "▶" });
    runBtn.title = "Run without arguments";
    if (isRunning) runBtn.disabled = true;
    runBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.actions.onRunAgent(agent.name, false);
    });

    // Run with current file button
    const currentFile = this.actions.getCurrentFilePath();
    const runFileBtn = actions.createEl("button", { cls: "agentmd-btn primary", text: "▶ 📄" });
    if (currentFile) {
      const parts = currentFile.split("/");
      runFileBtn.title = `Run with ${parts[parts.length - 1]}`;
    } else {
      runFileBtn.title = "Open a note first";
      runFileBtn.disabled = true;
    }
    if (isRunning) runFileBtn.disabled = true;
    runFileBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.actions.onRunAgent(agent.name, true);
    });
  }

  private renderTriggerChip(container: HTMLElement, agent: AgentSummary, isRunning: boolean): void {
    if (isRunning) {
      const runCount = this.runningCountForAgent(agent.name);
      const text = runCount > 1 ? `● Running · ${runCount} active` : "● Running";
      container.createSpan({ cls: "agentmd-chip running", text });
      return;
    }
    const tt = agent.trigger_type ?? "manual";
    if (tt === "manual" || tt === "none") {
      container.createSpan({ cls: "agentmd-chip manual", text: "Manual" });
    } else if (tt === "schedule") {
      container.createSpan({ cls: "agentmd-chip scheduled", text: "⏱ Scheduled" });
    } else if (tt === "watch") {
      container.createSpan({ cls: "agentmd-chip watch", text: "👁 Watch" });
    } else {
      container.createSpan({ cls: "agentmd-chip manual", text: tt });
    }
  }

  private isAgentRunning(name: string): boolean {
    for (const run of this.store.running.values()) {
      if (run.agent === name) return true;
    }
    return false;
  }

  private runningCountForAgent(name: string): number {
    let count = 0;
    for (const run of this.store.running.values()) {
      if (run.agent === name) count++;
    }
    return count;
  }
}
