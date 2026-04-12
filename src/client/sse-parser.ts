import type { ParsedSSEEvent, SSEEventData } from "../types";

/**
 * Incremental SSE parser. Feed it text chunks via `push()` and it returns
 * fully parsed events. Buffers incomplete data across calls.
 *
 * Wire format:
 *   event: <type>\n
 *   id: <seq>\n
 *   data: <json>\n
 *   \n
 *
 * Events are delimited by a blank line (\n\n).
 */
export class SSEParser {
  private buffer = "";

  /** Feed a text chunk. Returns zero or more parsed events. */
  push(chunk: string): ParsedSSEEvent[] {
    this.buffer += chunk;
    const events: ParsedSSEEvent[] = [];
    const parts = this.buffer.split("\n\n");
    // Last part is potentially incomplete — keep in buffer
    this.buffer = parts.pop()!;
    for (const part of parts) {
      if (!part.trim()) continue;
      const event = this.parseBlock(part);
      if (event) events.push(event);
    }
    return events;
  }

  /** Reset internal buffer (e.g. on reconnect). */
  reset(): void {
    this.buffer = "";
  }

  private parseBlock(raw: string): ParsedSSEEvent | null {
    let type = "message";
    let id = "";
    let dataStr = "";
    for (const line of raw.split("\n")) {
      if (line.startsWith("event:")) {
        type = line.slice(6).trim();
      } else if (line.startsWith("id:")) {
        id = line.slice(3).trim();
      } else if (line.startsWith("data:")) {
        dataStr = line.slice(5).trim();
      }
    }
    if (!dataStr) return null;
    let data: SSEEventData;
    try {
      data = JSON.parse(dataStr) as SSEEventData;
    } catch {
      data = { content: dataStr };
    }
    return { type, id, data };
  }
}
