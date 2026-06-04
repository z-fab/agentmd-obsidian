import { ItemView, WorkspaceLeaf, App } from "obsidian";
import type { EventStore } from "../store/event-store";
import { VIEW_TYPE_PANEL } from "./constants";
import type { Screen, TabKey } from "./nav";
import type { AgentDetail, ExecutionSummary, LogEntry } from "../types";

/** Actions the panel and its screens need from the plugin. */
export interface PanelActions {
  onRunAgent: (name: string, withFile: boolean) => void;
  onCancelExecution: (id: number) => void;
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
  };
}

/**
 * Single panel hosting the Agentes/Live/Histórico tabs and drill-down detail
 * screens. Skeleton — navigation/render/tick are wired in Task 4.1b.
 */
export class PanelView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private store: EventStore, private actions: PanelActions) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_PANEL; }
  getDisplayText(): string { return "AgentMD"; }
  getIcon(): string { return "bot"; }

  async onOpen(): Promise<void> {
    // Wired in Task 4.1b.
    this.contentEl.empty();
  }

  async onClose(): Promise<void> {
    // Wired in Task 4.1b.
  }
}
