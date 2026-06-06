import { ItemView, WorkspaceLeaf, App, setIcon } from "obsidian";
import type { EventStore } from "../store/event-store";
import { VIEW_TYPE_PANEL } from "./constants";
import { type NavState, type Screen, type TabKey, initialNav, currentScreen, baseTab, switchTab, push, back, isDetail } from "./nav";
import { renderAgentsScreen } from "./screens/agents-screen";
import { renderLiveScreen } from "./screens/live-screen";
import { HistoryScreen } from "./screens/history-screen";
import { AgentDetailScreen } from "./screens/agent-detail-screen";
import { ExecutionDetailScreen } from "./screens/execution-detail-screen";
import type { AgentDetail, ExecutionSummary, LogEntry } from "../types";

/** Actions the panel and its screens need from the plugin. */
export interface PanelActions {
  onRunAgent: (name: string, withFile: boolean) => void;
  onCancelExecution: (id: number) => void;
  onRespond: (id: number, requestId: string, response: Record<string, unknown>) => void;
  onRefreshAgents: () => void;
  onOpenSourceFile: (name: string) => void;
  onRerun: (name: string) => void;
  getCurrentFilePath: () => string | null;
  isOnline: () => boolean;
  onOnlineChanged: (cb: () => void) => () => void;
  onStartBackend: () => Promise<boolean>;
  fetchAgentDetail: (name: string) => Promise<AgentDetail>;
  fetchAgentRuns: (name: string, limit: number) => Promise<ExecutionSummary[]>;
  fetchExecution: (id: number) => Promise<ExecutionSummary | null>;
  fetchExecutionMessages: (id: number) => Promise<LogEntry[]>;
  getExecutions: (p: { status?: string; agent?: string; limit: number; offset: number }) => Promise<ExecutionSummary[]>;
}

/** Context passed to every screen. */
export interface PanelContext {
  app: App;
  store: EventStore;
  actions: PanelActions;
  nav: {
    push: (s: Screen) => void;
    back: () => void;
    switchTab: (t: TabKey) => void;
    openHistoryForAgent: (agentName: string) => void;
  };
}

function tabLabel(t: TabKey): string {
  return t === "agents" ? "Agents" : t === "live" ? "Live" : "History";
}

/**
 * Single panel hosting the Agents/Live/History tabs and drill-down detail
 * screens. Owns the navigation stack, store subscriptions, and a 1s tick used
 * by the Live tab and running-execution detail.
 */
export class PanelView extends ItemView {
  private state: NavState = initialNav();
  private history!: HistoryScreen;
  private agentDetail!: AgentDetailScreen;
  private execDetail!: ExecutionDetailScreen;
  private ctx!: PanelContext;
  private tick: number | null = null;
  private unsubs: Array<() => void> = [];

  constructor(leaf: WorkspaceLeaf, private store: EventStore, private actions: PanelActions) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_PANEL; }
  getDisplayText(): string { return "Agentmd"; }
  getIcon(): string { return "bot"; }

  // Public navigation API (used by the plugin / commands).
  goToTab(tab: TabKey): void { this.state = switchTab(this.state, tab); this.render(); }
  openAgent(name: string): void { this.state = push(this.state, { kind: "agent", name }); this.render(); }
  openExecution(id: number): void { this.state = push(this.state, { kind: "execution", id }); this.render(); }

  async onOpen(): Promise<void> {
    this.ctx = {
      app: this.app,
      store: this.store,
      actions: this.actions,
      nav: {
        push: (s) => { this.state = push(this.state, s); this.render(); },
        back: () => { this.state = back(this.state); this.render(); },
        switchTab: (t) => { this.state = switchTab(this.state, t); this.render(); },
        openHistoryForAgent: (agentName: string) => {
          this.history.setAgentFilter(agentName);
          this.state = switchTab(this.state, "history");
          this.render();
        },
      },
    };
    this.history = new HistoryScreen(this.ctx);
    this.agentDetail = new AgentDetailScreen(this.ctx);
    this.execDetail = new ExecutionDetailScreen(this.ctx);

    this.unsubs.push(this.store.onAgentsChanged(() => this.render()));
    this.unsubs.push(this.store.onRunningChanged(() => this.render()));
    this.unsubs.push(this.store.onHistoryChanged(() => this.render()));
    this.unsubs.push(this.actions.onOnlineChanged(() => this.render()));

    this.render();
  }

  async onClose(): Promise<void> {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.stopTick();
    this.execDetail?.dispose();
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("agentmd-panel");

    if (!this.actions.isOnline()) {
      this.stopTick();
      this.renderOffline(root);
      return;
    }

    const screen = currentScreen(this.state);

    if (!isDetail(this.state)) {
      this.renderTabs(root, baseTab(this.state));
    } else {
      const bar = root.createDiv({ cls: "agentmd-back-bar", text: `‹ ${tabLabel(baseTab(this.state))}` });
      bar.addEventListener("click", () => this.ctx.nav.back());
    }

    const body = root.createDiv({ cls: "agentmd-panel-body" });
    this.renderScreen(body, screen);

    if (!isDetail(this.state)) {
      const footer = root.createDiv({ cls: "agentmd-panel-footer" });
      const refresh = footer.createEl("button", { cls: "agentmd-footer-btn" });
      const refreshIcon = refresh.createSpan({ cls: "agentmd-footer-btn-icon" });
      setIcon(refreshIcon, "refresh-cw");
      refresh.createSpan({ text: "Refresh" });
      refresh.setAttribute("aria-label", "Refresh");
      refresh.addEventListener("click", () => this.refreshActive());
    }

    this.updateTick(screen);
  }

  private refreshActive(): void {
    const tab = baseTab(this.state);
    if (tab === "history") { this.history.reload(); this.render(); }
    else { this.actions.onRefreshAgents(); }
  }

  private renderScreen(body: HTMLElement, screen: Screen): void {
    switch (screen.kind) {
      case "tab":
        if (screen.tab === "agents") renderAgentsScreen(body, this.ctx);
        else if (screen.tab === "live") renderLiveScreen(body, this.ctx);
        else this.history.render(body);
        break;
      case "agent":
        this.agentDetail.render(body, screen.name);
        break;
      case "execution":
        this.execDetail.render(body, screen.id);
        break;
    }
  }

  private renderTabs(root: HTMLElement, active: TabKey): void {
    const row = root.createDiv({ cls: "agentmd-tabrow" });
    const mk = (tab: TabKey, label: string, count?: number, warn?: boolean) => {
      const b = row.createEl("button", { cls: "agentmd-tab" + (tab === active ? " active" : "") });
      b.createSpan({ text: label });
      if (count && count > 0) {
        const badge = b.createSpan({ cls: "agentmd-tab-count", text: String(count) });
        if (warn) badge.addClass("waiting");
      }
      b.addEventListener("click", () => this.goToTab(tab));
    };
    mk("agents", "Agents", this.store.agents.length);
    mk("live", "Live", this.store.running.size, this.store.waitingCount > 0);
    mk("history", "History");
  }

  private renderOffline(root: HTMLElement): void {
    const w = root.createDiv({ cls: "agentmd-offline-state" });
    const icon = w.createDiv({ cls: "agentmd-offline-icon" });
    setIcon(icon, "bot-off");
    w.createDiv({ cls: "agentmd-offline-title", text: "Agentmd backend offline" });
    w.createDiv({
      cls: "agentmd-offline-desc",
      text: "The Agentmd backend isn't running. If it's already installed, start it with the button below — or run “agentmd start” in a terminal.",
    });
    const btn = w.createEl("button", { cls: "agentmd-btn primary agentmd-offline-start-btn", text: "▶ Start Agentmd" });
    btn.addEventListener("click", () => {
      btn.setText("Starting…");
      btn.disabled = true;
      void this.actions.onStartBackend().then((ok) => {
        if (!ok) { btn.setText("▶ Start Agentmd"); btn.disabled = false; }
      });
    });
    const help = w.createDiv({ cls: "agentmd-offline-help" });
    help.createSpan({ text: "Don't have it yet? " });
    const link = help.createEl("a", {
      cls: "agentmd-offline-link",
      text: "Get agentmd",
      href: "https://github.com/z-fab/agentmd",
    });
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener");
  }

  private updateTick(screen: Screen): void {
    const anyRunning = [...this.store.running.values()].some((r) => r.state === "running");
    const liveNeedsTick = screen.kind === "tab" && screen.tab === "live" && anyRunning;
    const execNeedsTick =
      screen.kind === "execution" && this.store.running.get(screen.id)?.state === "running";
    if (liveNeedsTick || execNeedsTick) this.startTick(); else this.stopTick();
  }

  private startTick(): void {
    if (this.tick) return;
    this.tick = window.setInterval(() => {
      const screen = currentScreen(this.state);
      if (screen.kind === "execution" && this.store.running.has(screen.id)) {
        this.execDetail.verifyStillRunning();
      }
      this.render();
    }, 1000);
  }

  private stopTick(): void {
    if (this.tick) { window.clearInterval(this.tick); this.tick = null; }
  }
}
