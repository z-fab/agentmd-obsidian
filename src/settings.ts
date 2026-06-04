export interface AgentmdSettings {
  /** Absolute path to the agentmd Unix domain socket. */
  socketPath: string;
  /** Absolute path to the agents directory (for "Open source file"). */
  agentsDir: string;
  /** Open ExecutionDetailView automatically when a run starts. */
  autoOpenOnRun: boolean;
  /** Notification behavior on execution completion. */
  notifications: "all" | "failures" | "off";
  /** Health poll interval in milliseconds. */
  pollIntervalMs: number;
  /** Path to the agentmd executable (for starting the backend). */
  agentmdPath: string;
  /** UI accent color applied via --agentmd-accent CSS variable (tabs, primary buttons, active filters). */
  accentColor: string;
}

export const DEFAULT_SETTINGS: AgentmdSettings = {
  socketPath: `${typeof process !== "undefined" ? process.env?.HOME ?? "" : ""}/.local/state/agentmd/agentmd.sock`,
  agentsDir: `${typeof process !== "undefined" ? process.env?.HOME ?? "" : ""}/agentmd/agents`,
  autoOpenOnRun: true,
  notifications: "all",
  pollIntervalMs: 15000,
  agentmdPath: "agentmd",
  accentColor: "#4EA92E",
};
