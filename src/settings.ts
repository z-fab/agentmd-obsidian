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
}

export const DEFAULT_SETTINGS: AgentmdSettings = {
  socketPath: `${typeof process !== "undefined" ? process.env?.HOME ?? "" : ""}/.local/state/agentmd/agentmd.sock`,
  agentsDir: `${typeof process !== "undefined" ? process.env?.HOME ?? "" : ""}/agentmd/agents`,
  autoOpenOnRun: true,
  notifications: "all",
  pollIntervalMs: 15000,
};
