/**
 * Types mirroring the agentmd HTTP API contract (v0.8+).
 *
 * Reference: agentmd/agent_md/api/schemas.py
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
  agents_loaded: number;
  agents_enabled: number;
  scheduler_status: string;
  watcher_active: boolean;
  active_streams: number;
  active_executions: number;
}

// ---------- Agents ----------

export interface AgentSummary {
  name: string;
  description: string;
  enabled: boolean;
  trigger_type: string;
  model_provider: string | null;
  model_name: string | null;
}

export interface AgentDetail extends AgentSummary {
  last_run: string | null;
  next_run: string | null;
  history: string;
  settings: Record<string, unknown>;
}

// ---------- Executions ----------

export type ExecutionStatus = string;

export interface ExecutionSummary {
  id: number;
  agent_id: string;
  status: string;
  trigger: string;
  started_at: string;
  finished_at?: string | null;
  duration_ms?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;
  cost_usd?: number | null;
  error?: string | null;
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
  /** Replayed events from DB use `message` instead of structured fields. */
  message?: string;
  /** Replayed events include a timestamp. */
  timestamp?: string;
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

// ---------- Scheduler ----------

export interface SchedulerJob {
  agent_name: string;
  trigger_type: string;
  next_run: string | null;
}

export interface SchedulerStatus {
  status: string;
  jobs: SchedulerJob[];
}

// ---------- Run request ----------

export interface RunRequest {
  args?: string[];
  message?: string;
}
