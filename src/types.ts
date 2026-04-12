/**
 * Types mirroring the agentmd HTTP API contract (v0.8+).
 *
 * Reference: ../../../agentmd/docs/api.md
 *
 * These are deliberately minimal — they cover the fields the plugin consumes.
 * New fields can be added as plans expand.
 */

// ---------- Health & info ----------

export interface HealthResponse {
  /** Always "ok" when the backend is alive. */
  status: string;
}

export interface InfoResponse {
  version: string;
  pid: number;
  uptime_seconds: number;
  workspace: string;
  agents_dir: string;
  agent_count: number;
  scheduler: {
    running: boolean;
    paused: boolean;
    job_count: number;
  };
}

// ---------- Agents ----------

export type TriggerType = "manual" | "schedule" | "watch";

export interface AgentTrigger {
  type: TriggerType;
  /** For schedule triggers: cron expression or interval (e.g. "1h") */
  every?: string;
  cron?: string;
  /** For watch triggers: glob or directory */
  paths?: string[];
}

export interface AgentSummary {
  name: string;
  description?: string;
  /** Trigger metadata. `null` means manual. */
  trigger: AgentTrigger | null;
  model: {
    provider: string;
    name: string;
  };
  /** ISO timestamp of the next scheduled run, when applicable. */
  next_run?: string;
  /** ISO timestamp of the most recent completed run, when available. */
  last_run?: string;
}

// ---------- Executions ----------

export type ExecutionStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "aborted"
  | "orphaned";

export interface ExecutionSummary {
  id: number;
  agent: string;
  status: ExecutionStatus;
  started_at: string;
  finished_at?: string;
  duration_seconds?: number;
  tokens_total?: number;
  cost_usd?: number;
  /** Trigger source for this particular execution. */
  trigger_source?: "manual" | "scheduler" | "watch" | "api";
  /** Error tag for failed/aborted runs (e.g. "tool_error", "cost_cap"). */
  error_tag?: string;
}

// ---------- SSE events ----------

export interface SSEToolCall {
  name: string;
  args: string;
}

export interface SSEEventData {
  event_type?: string;
  agent_name?: string;
  content?: string;
  tools?: SSEToolCall[];
  tool_name?: string;
  /** Only on complete events */
  status?: string;
  duration_ms?: number;
  total_tokens?: number;
  cost_usd?: number;
  error?: string;
}

export interface ParsedSSEEvent {
  /** SSE event type: message, ai, tool_call, tool_result, meta, final_answer, complete */
  type: string;
  /** Sequence ID from backend — used for dedup on reconnect */
  id: string;
  /** Parsed JSON payload */
  data: SSEEventData;
}

// ---------- Run request ----------

export interface RunRequest {
  args?: string[];
  message?: string;
}
