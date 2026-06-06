import { execFile } from "node:child_process";

export interface BackendLifecycleOptions {
  /** Path to the agentmd executable. Default: "agentmd" */
  agentmdPath?: string;
  /** Function that probes /health. */
  healthCheck: () => Promise<boolean>;
  /** Function that sends POST /shutdown. */
  shutdown: () => Promise<void>;
  /** Max time (ms) to wait for backend to come online after start. Default: 10000 */
  startTimeoutMs?: number;
  /** Interval (ms) between health polls after start. Default: 1000 */
  startPollMs?: number;
}

export interface StartResult {
  success: boolean;
  error?: string;
}

export class BackendLifecycle {
  private readonly agentmdPath: string;
  private readonly healthCheck: () => Promise<boolean>;
  private readonly shutdownFn: () => Promise<void>;
  private readonly startTimeoutMs: number;
  private readonly startPollMs: number;

  constructor(options: BackendLifecycleOptions) {
    this.agentmdPath = options.agentmdPath ?? "agentmd";
    this.healthCheck = options.healthCheck;
    this.shutdownFn = options.shutdown;
    this.startTimeoutMs = options.startTimeoutMs ?? 10000;
    this.startPollMs = options.startPollMs ?? 1000;
  }

  /**
   * Start the agentmd backend as a daemon.
   * Uses execFile (not exec) to avoid shell injection.
   * Executes `agentmdPath start -d`, then polls /health until it responds.
   */
  async start(): Promise<StartResult> {
    try {
      await this.execStart();
    } catch (err) {
      return {
        success: false,
        error: `Failed to run ${this.agentmdPath}: ${(err as Error).message}`,
      };
    }

    // Poll health until backend is ready
    const deadline = Date.now() + this.startTimeoutMs;
    while (Date.now() < deadline) {
      const alive = await this.healthCheck();
      if (alive) return { success: true };
      await this.sleep(this.startPollMs);
    }

    return {
      success: false,
      error: `Backend did not respond within ${this.startTimeoutMs / 1000}s`,
    };
  }

  /**
   * Stop the agentmd backend via API.
   * Returns true if shutdown was successful.
   */
  async stop(): Promise<boolean> {
    try {
      await this.shutdownFn();
      return true;
    } catch {
      return false;
    }
  }

  private execStart(): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile(this.agentmdPath, ["start", "-d"], (error) => {
        if (error) {
          reject(error instanceof Error ? error : new Error("Failed to start agentmd"));
        } else {
          resolve();
        }
      });
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => window.setTimeout(r, ms));
  }
}
