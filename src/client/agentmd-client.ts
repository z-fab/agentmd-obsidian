import * as http from "node:http";
import type { AgentDetail, AgentSummary, ExecutionSummary, InfoResponse, ParsedSSEEvent, RunRequest, SchedulerStatus } from "../types";
import { SSEParser } from "./sse-parser";

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

  /** Fetches all agents from the backend. */
  async listAgents(): Promise<AgentSummary[]> {
    return this.get<AgentSummary[]>("/agents");
  }

  /** Starts an agent execution. Returns the new execution ID. */
  async runAgent(
    name: string,
    opts?: RunRequest,
  ): Promise<{ execution_id: number }> {
    return this.post<{ execution_id: number }>(
      `/agents/${encodeURIComponent(name)}/run`,
      opts,
    );
  }

  /** Fetches a single execution by ID. */
  async getExecution(id: number): Promise<ExecutionSummary> {
    return this.get<ExecutionSummary>(`/executions/${id}`);
  }

  /** Cancels a running execution. */
  async cancelExecution(id: number): Promise<void> {
    await this.del(`/executions/${id}`);
  }

  /** Fetches a single agent's full detail (config + last_run + next_run). */
  async getAgent(name: string): Promise<AgentDetail> {
    return this.get<AgentDetail>(`/agents/${encodeURIComponent(name)}`);
  }

  /** Fetches execution history for a specific agent. */
  async getAgentRuns(name: string, limit = 10): Promise<ExecutionSummary[]> {
    return this.get<ExecutionSummary[]>(`/agents/${encodeURIComponent(name)}/runs?limit=${limit}`);
  }

  /** Fetches scheduler status and jobs. */
  async getScheduler(): Promise<SchedulerStatus> {
    return this.get<SchedulerStatus>("/scheduler");
  }

  /** Pauses the scheduler. */
  async pauseScheduler(): Promise<void> {
    await this.post("/scheduler/pause");
  }

  /** Resumes the scheduler. */
  async resumeScheduler(): Promise<void> {
    await this.post("/scheduler/resume");
  }

  /** Fetches executions, optionally filtered. */
  async listExecutions(params?: {
    status?: string;
    agent?: string;
    limit?: number;
    offset?: number;
  }): Promise<ExecutionSummary[]> {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    if (params?.agent) query.set("agent", params.agent);
    if (params?.limit != null) query.set("limit", String(params.limit));
    if (params?.offset != null) query.set("offset", String(params.offset));
    const qs = query.toString();
    return this.get<ExecutionSummary[]>(`/executions${qs ? `?${qs}` : ""}`);
  }

  /**
   * Opens an SSE stream on the given path. Calls `onEvent` for each parsed
   * event. Returns a function that closes the connection.
   *
   * The caller is responsible for reconnect logic — this method opens a
   * single connection.
   */
  openSSE(
    path: string,
    onEvent: (event: ParsedSSEEvent) => void,
    onError?: (err: Error) => void,
    onEnd?: () => void,
  ): () => void {
    const parser = new SSEParser();

    const req = http.request(
      {
        socketPath: this.socketPath,
        path,
        method: "GET",
        headers: { Accept: "text/event-stream" },
      },
      (res) => {
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          const events = parser.push(chunk);
          for (const event of events) {
            onEvent(event);
          }
        });
        res.on("error", (err) => onError?.(err));
        res.on("end", () => {
          // Flush any remaining buffered data — the last event may not
          // have been followed by \n\n before the stream closed.
          const remaining = parser.flush();
          for (const event of remaining) {
            onEvent(event);
          }
          onEnd?.();
        });
      },
    );

    req.on("error", (err) => onError?.(err));
    req.end();

    return () => {
      req.destroy();
    };
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
