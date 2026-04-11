import * as http from "node:http";
import type { InfoResponse } from "../types";

export interface AgentmdClientOptions {
  /**
   * Absolute filesystem path to the agentmd Unix domain socket.
   * Defaults to `~/.local/state/agentmd/agentmd.sock` in settings but the
   * client itself does not resolve `~` — the caller must pass an absolute path.
   */
  socketPath: string;
}

export class AgentmdClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "AgentmdClientError";
  }
}

export class AgentmdClient {
  readonly socketPath: string;

  constructor(options: AgentmdClientOptions) {
    this.socketPath = options.socketPath;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  async del<T = void>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }

  /**
   * Probes `GET /health`. Returns `true` if the backend responded 2xx with
   * `{"status": "ok"}`, `false` on any error or unexpected response. Never
   * throws — this method exists to be called repeatedly by a monitor.
   */
  async health(): Promise<boolean> {
    try {
      const result = await this.get<{ status: string }>("/health");
      return result?.status === "ok";
    } catch {
      return false;
    }
  }

  /** Fetches backend info (version, workspace path, scheduler state). */
  async info(): Promise<InfoResponse> {
    return this.get<InfoResponse>("/info");
  }

  private request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const payload = body == null ? undefined : JSON.stringify(body);
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (payload != null) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload).toString();
    }

    return new Promise<T>((resolve, reject) => {
      const req = http.request(
        {
          socketPath: this.socketPath,
          path,
          method,
          headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf8");
            const status = res.statusCode ?? 0;
            if (status < 200 || status >= 300) {
              reject(
                new AgentmdClientError(
                  `HTTP ${status} on ${method} ${path}`,
                  status,
                  raw,
                ),
              );
              return;
            }
            if (raw.length === 0) {
              resolve(undefined as unknown as T);
              return;
            }
            try {
              resolve(JSON.parse(raw) as T);
            } catch (err) {
              reject(
                new AgentmdClientError(
                  `Failed to parse JSON response from ${method} ${path}: ${(err as Error).message}`,
                  status,
                  raw,
                ),
              );
            }
          });
          res.on("error", (err) => {
            reject(
              new AgentmdClientError(
                `Response stream error on ${method} ${path}: ${err.message}`,
              ),
            );
          });
        },
      );

      req.on("error", (err) => {
        reject(
          new AgentmdClientError(
            `Request error on ${method} ${path}: ${err.message}`,
          ),
        );
      });

      if (payload != null) {
        req.write(payload);
      }
      req.end();
    });
  }
}
