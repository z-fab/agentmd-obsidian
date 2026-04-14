import { ItemView, WorkspaceLeaf } from "obsidian";
import type { AgentSummary } from "../types";
import type { EventStore } from "../store/event-store";
import { VIEW_TYPE_AGENTS } from "./constants";

/** Callback provided by the plugin to handle user actions. */
export interface AgentsViewActions {
  onRunAgent: (name: string, withCurrentFile: boolean) => void;
  onRefreshAgents: () => void;
  getCurrentFilePath: () => string | null;
  onOpenAgentDetail: (name: string) => void;
  isOnline: () => boolean;
  onOnlineChanged: (listener: () => void) => () => void;
  onStartBackend: () => Promise<boolean>;
}

export class AgentsView extends ItemView {
  private store: EventStore;
  private actions: AgentsViewActions;
  private unsubAgents: (() => void) | null = null;
  private unsubOnline: (() => void) | null = null;

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
    this.unsubOnline = this.actions.onOnlineChanged(() => this.render());
  }

  async onClose(): Promise<void> {
    this.unsubAgents?.();
    this.unsubOnline?.();
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("agentmd-agents-view");

    if (!this.actions.isOnline()) {
      this.renderOffline(container);
      return;
    }

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
    const card = container.createDiv({ cls: "agentmd-agent-card" });
    card.addEventListener("click", () => this.actions.onOpenAgentDetail(agent.name));

    // Row 1: name + trigger chip
    const headerEl = card.createDiv({ cls: "agent-header" });
    headerEl.createSpan({ cls: "agent-name", text: agent.name });
    this.renderTriggerChip(headerEl, agent);

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

    const runBtn = actions.createEl("button", { cls: "agentmd-btn", text: "▶" });
    runBtn.title = "Run without arguments";
    runBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.actions.onRunAgent(agent.name, false);
    });

    const currentFile = this.actions.getCurrentFilePath();
    const runFileBtn = actions.createEl("button", { cls: "agentmd-btn primary", text: "▶ 📄" });
    if (currentFile) {
      const parts = currentFile.split("/");
      runFileBtn.title = `Run with ${parts[parts.length - 1]}`;
    } else {
      runFileBtn.title = "Open a note first";
      runFileBtn.disabled = true;
    }
    runFileBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.actions.onRunAgent(agent.name, true);
    });
  }

  private renderTriggerChip(container: HTMLElement, agent: AgentSummary): void {
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

  private renderOffline(container: HTMLElement): void {
    const wrapper = container.createDiv({ cls: "agentmd-offline-state" });
    wrapper.createDiv({ cls: "agentmd-offline-icon", text: "⚠" });
    wrapper.createDiv({ cls: "agentmd-offline-title", text: "Backend offline" });
    const startBtn = wrapper.createEl("button", {
      cls: "agentmd-btn primary agentmd-offline-start-btn",
      text: "▶ Start AgentMD",
    });
    startBtn.addEventListener("click", async () => {
      startBtn.setText("Starting…");
      startBtn.disabled = true;
      const ok = await this.actions.onStartBackend();
      if (!ok) {
        startBtn.setText("▶ Start AgentMD");
        startBtn.disabled = false;
      }
    });
  }
}
