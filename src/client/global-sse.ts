import { SSEParser } from "./sse-parser";
import type { ParsedSSEEvent } from "../types";
import * as http from "node:http";

export type GlobalSSEState = "connected" | "reconnecting" | "fallback" | "offline";

export interface GlobalSSEOptions {
  socketPath: string;
  onEvent: (type: string, data: Record<string, unknown>) => void;
  onStateChanged?: (state: GlobalSSEState) => void;
  /** Backoff steps in ms for reconnection. Default: [2000, 4000, 8000, 16000, 30000] */
  reconnectBackoffMs?: number[];
  /** How many reconnection attempts before activating fallback. Default: 5 */
  maxReconnectAttempts?: number;
  /** Heartbeat timeout in ms. If no event arrives within this window, connection is considered dead. Default: 12000 */
  heartbeatTimeoutMs?: number;
}

export class GlobalSSEConnection {
  private readonly socketPath: string;
  private readonly onEvent: (type: string, data: Record<string, unknown>) => void;
  private readonly onStateChanged: (state: GlobalSSEState) => void;
  private readonly backoffMs: number[];
  private readonly maxReconnectAttempts: number;
  private readonly heartbeatTimeoutMs: number;

  private closeSSE: (() => void) | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private _state: GlobalSSEState = "offline";
  private active = false;

  constructor(options: GlobalSSEOptions) {
    this.socketPath = options.socketPath;
    this.onEvent = options.onEvent;
    this.onStateChanged = options.onStateChanged ?? (() => {});
    this.backoffMs = options.reconnectBackoffMs ?? [2000, 4000, 8000, 16000, 30000];
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 12000;
  }

  get state(): GlobalSSEState {
    return this._state;
  }

  get isConnected(): boolean {
    return this._state === "connected";
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.connect();
  }

  stop(): void {
    this.active = false;
    this.closeSSE?.();
    this.closeSSE = null;
    this.clearReconnectTimer();
    this.clearHeartbeatTimer();
    this.setState("offline");
  }

  /** Force an immediate reconnection attempt (e.g., after backend start). */
  reconnectNow(): void {
    if (!this.active || this._state === "connected") return;
    this.clearReconnectTimer();
    this.connect();
  }

  private connect(): void {
    if (!this.active) return;

    const parser = new SSEParser();

    const req = http.request(
      {
        socketPath: this.socketPath,
        path: "/events/stream",
        method: "GET",
        headers: { Accept: "text/event-stream" },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume(); // drain
          this.handleDisconnect();
          return;
        }

        // Connected successfully
        this.reconnectAttempts = 0;
        this.setState("connected");
        this.resetHeartbeatTimer();

        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          if (!this.active) return;
          this.resetHeartbeatTimer();
          const events = parser.push(chunk);
          for (const event of events) {
            this.dispatchEvent(event);
          }
        });
        res.on("end", () => {
          if (this.active) this.handleDisconnect();
        });
        res.on("error", () => {
          if (this.active) this.handleDisconnect();
        });
      },
    );

    req.on("error", () => {
      if (this.active) this.handleDisconnect();
    });

    req.end();

    this.closeSSE = () => {
      req.destroy();
    };
  }

  private dispatchEvent(event: ParsedSSEEvent): void {
    try {
      this.onEvent(event.type, event.data as unknown as Record<string, unknown>);
    } catch (err) {
      console.error("GlobalSSE: error in event handler:", err);
    }
  }

  private handleDisconnect(): void {
    this.closeSSE?.();
    this.closeSSE = null;
    this.clearHeartbeatTimer();

    if (!this.active) return;

    this.reconnectAttempts++;

    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      this.setState("fallback");
    } else {
      this.setState("reconnecting");
    }

    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (!this.active) return;
    this.clearReconnectTimer();

    const idx = Math.min(this.reconnectAttempts - 1, this.backoffMs.length - 1);
    const delay = this.backoffMs[Math.max(0, idx)];

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.active) this.connect();
    }, delay);
  }

  private resetHeartbeatTimer(): void {
    this.clearHeartbeatTimer();
    this.heartbeatTimer = setTimeout(() => {
      this.heartbeatTimer = null;
      // No event received within timeout - connection is dead
      if (this.active && this._state === "connected") {
        this.handleDisconnect();
      }
    }, this.heartbeatTimeoutMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer != null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimer != null) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private setState(next: GlobalSSEState): void {
    if (this._state === next) return;
    this._state = next;
    this.onStateChanged(next);
  }
}
