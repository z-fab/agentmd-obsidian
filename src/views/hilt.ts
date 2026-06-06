import type { HiltKind, PendingRequest, PendingResponse, SSEEventData } from "../types";

const KINDS: HiltKind[] = ["confirm", "input", "choice"];
function coerceKind(k: unknown): HiltKind {
  return KINDS.includes(k as HiltKind) ? (k as HiltKind) : "input";
}

/** Build a PendingRequest from an `interrupt` SSE event payload, or null if invalid. */
export function pendingFromSSE(data: SSEEventData): PendingRequest | null {
  if (!data.request_id) return null;
  return {
    request_id: data.request_id,
    kind: coerceKind(data.kind),
    message: data.message ?? data.content ?? "",
    tool_name: data.tool_name ?? undefined,
    tool_args: data.tool_args ?? undefined,
    options: data.options ?? undefined,
    multi: data.multi ?? false,
  };
}

/** Build a PendingRequest from the GET /pending response shape. */
export function pendingFromResponse(p: PendingResponse): PendingRequest {
  return {
    request_id: p.request_id,
    kind: coerceKind(p.kind),
    message: p.message,
    tool_name: p.tool_name ?? undefined,
    tool_args: p.tool_args ?? undefined,
    options: p.options ?? undefined,
    multi: p.multi ?? false,
  };
}

export interface RespondInput {
  approved?: boolean;
  reason?: string;
  text?: string;
  selected?: string[];
}

/** Build the `response` object POSTed to /executions/{id}/respond, by kind. */
export function buildRespondBody(kind: HiltKind, input: RespondInput): Record<string, unknown> {
  if (kind === "confirm") return { approved: !!input.approved, reason: input.reason || undefined };
  if (kind === "choice") return { selected: input.selected ?? [] };
  return { text: input.text ?? "" };
}
