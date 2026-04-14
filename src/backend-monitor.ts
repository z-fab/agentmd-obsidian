export interface HealthProvider {
  health(): Promise<boolean>;
}

export interface BackendMonitorOptions {
  client: HealthProvider;
  /** Fallback poll interval in milliseconds. Default 15000. */
  intervalMs?: number;
}

export type OnlineListener = (online: boolean) => void;
export type ConnectionMode = "sse" | "fallback" | "offline";

export class BackendMonitor {
  private _online = false;
  private _mode: ConnectionMode = "offline";
  private readonly client: HealthProvider;
  private readonly intervalMs: number;
  private listeners = new Set<OnlineListener>();
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private fallbackRunning = false;

  constructor(options: BackendMonitorOptions) {
    this.client = options.client;
    this.intervalMs = options.intervalMs ?? 15000;
  }

  get online(): boolean {
    return this._online;
  }

  get mode(): ConnectionMode {
    return this._mode;
  }

  subscribe(listener: OnlineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Called by GlobalSSEConnection when SSE connects. */
  notifySSEConnected(): void {
    this._mode = "sse";
    this.setOnline(true);
  }

  /** Called by GlobalSSEConnection when SSE disconnects (before fallback). */
  notifySSEDisconnected(): void {
    if (this._mode === "sse") {
      this._mode = "offline";
    }
    this.setOnline(false);
  }

  /** Activate fallback polling mode (called when SSE reconnection exhausted). */
  activateFallback(): void {
    if (this.fallbackRunning) return;
    this._mode = "fallback";
    this.fallbackRunning = true;
    this.fallbackTimer = setTimeout(() => {
      void this.fallbackTick();
    }, 0);
  }

  /** Deactivate fallback polling (called when SSE reconnects). */
  deactivateFallback(): void {
    this.fallbackRunning = false;
    if (this.fallbackTimer != null) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
  }

  /** Fire a single health probe (used by BackendLifecycle after start). */
  async probeNow(): Promise<boolean> {
    return this.client.health();
  }

  /** Stop everything (called on plugin unload). */
  stop(): void {
    this.deactivateFallback();
  }

  private async fallbackTick(): Promise<void> {
    if (!this.fallbackRunning) return;

    const alive = await this.client.health();
    if (alive) {
      this.setOnline(true);
    } else {
      this.setOnline(false);
    }

    if (!this.fallbackRunning) return;
    this.fallbackTimer = setTimeout(() => {
      void this.fallbackTick();
    }, this.intervalMs);
  }

  private setOnline(next: boolean): void {
    if (this._online === next) return;
    this._online = next;
    for (const listener of this.listeners) {
      listener(next);
    }
  }
}
