export interface HealthProvider {
  health(): Promise<boolean>;
}

export interface BackendMonitorOptions {
  client: HealthProvider;
  /** Normal interval between probes, in milliseconds. Default 15000. */
  intervalMs?: number;
  /** Failure backoff steps, in milliseconds. Default: [5000, 10000, 30000, 60000]. */
  backoffMs?: number[];
}

export type OnlineListener = (online: boolean) => void;

export class BackendMonitor {
  private _online = false;
  private readonly client: HealthProvider;
  private readonly intervalMs: number;
  private readonly backoffMs: number[];
  private backoffIndex = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<OnlineListener>();
  private running = false;

  constructor(options: BackendMonitorOptions) {
    this.client = options.client;
    this.intervalMs = options.intervalMs ?? 15000;
    this.backoffMs = options.backoffMs ?? [5000, 10000, 30000, 60000];
  }

  get online(): boolean {
    return this._online;
  }

  subscribe(listener: OnlineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private consecutiveFailures = 0;
  private static readonly FAILURE_THRESHOLD = 3;

  /**
   * Fire a probe immediately. Used on startup and on user actions when the
   * monitor is currently offline. Safe to call while the scheduled timer
   * is also ticking — does not double-schedule.
   */
  async probeNow(): Promise<void> {
    const alive = await this.client.health();
    this.recordProbe(alive);
  }

  private recordProbe(alive: boolean): void {
    if (alive) {
      this.consecutiveFailures = 0;
      this.setOnline(true);
    } else {
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= BackendMonitor.FAILURE_THRESHOLD) {
        this.setOnline(false);
      }
    }
  }

  private setOnline(next: boolean): void {
    if (this._online === next) return;
    this._online = next;
    if (next) {
      this.backoffIndex = 0;
    }
    for (const listener of this.listeners) {
      listener(next);
    }
  }

  /**
   * Begins scheduled polling. Fires a probe immediately, then schedules
   * the next probe based on online state: `intervalMs` while online,
   * backoff steps while offline.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setTimeout(() => {
      void this.tick();
    }, 0);
  }

  /** Stops the scheduled timer. `probeNow()` can still be called manually. */
  stop(): void {
    this.running = false;
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    await this.probeNow();
    if (!this.running) return;

    const inBackoff =
      !this._online &&
      this.consecutiveFailures >= BackendMonitor.FAILURE_THRESHOLD;
    const nextDelay = inBackoff ? this.nextBackoffDelay() : this.intervalMs;

    this.timer = setTimeout(() => {
      void this.tick();
    }, nextDelay);
  }

  private nextBackoffDelay(): number {
    const delay = this.backoffMs[
      Math.min(this.backoffIndex, this.backoffMs.length - 1)
    ];
    this.backoffIndex += 1;
    return delay;
  }
}
