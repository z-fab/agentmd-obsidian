import { Plugin } from "obsidian";
import { AgentmdClient } from "./src/client/agentmd-client";
import { BackendMonitor } from "./src/backend-monitor";

/**
 * Hard-coded defaults for Plan 1. A proper SettingsStore arrives in Plan 3;
 * until then, the plugin uses the stock agentmd socket path.
 */
const DEFAULT_SOCKET_PATH = `${process.env.HOME ?? ""}/.local/state/agentmd/agentmd.sock`;
const DEFAULT_INTERVAL_MS = 15000;

export default class AgentmdPlugin extends Plugin {
  private client!: AgentmdClient;
  private monitor!: BackendMonitor;
  private statusBarEl!: HTMLElement;
  private unsubscribeMonitor: (() => void) | null = null;

  async onload(): Promise<void> {
    this.client = new AgentmdClient({ socketPath: DEFAULT_SOCKET_PATH });
    this.monitor = new BackendMonitor({
      client: this.client,
      intervalMs: DEFAULT_INTERVAL_MS,
    });

    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass("agentmd-status-bar");
    this.renderStatusBar(this.monitor.online);

    this.unsubscribeMonitor = this.monitor.subscribe((online) => {
      this.renderStatusBar(online);
    });

    this.monitor.start();
  }

  onunload(): void {
    this.monitor?.stop();
    this.unsubscribeMonitor?.();
    this.unsubscribeMonitor = null;
  }

  private renderStatusBar(online: boolean): void {
    // Use textContent rather than innerHTML — safer, and sufficient.
    this.statusBarEl.setText(
      online ? "● agentmd · online" : "● agentmd · offline",
    );
    this.statusBarEl.toggleClass("agentmd-status-online", online);
    this.statusBarEl.toggleClass("agentmd-status-offline", !online);
  }
}
