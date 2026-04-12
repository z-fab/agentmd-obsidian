import { describe, it, expect } from "vitest";
import { SSEParser } from "../../src/client/sse-parser";

describe("SSEParser", () => {
  it("parses a complete single event", () => {
    const parser = new SSEParser();
    const events = parser.push(
      'event: tool_call\nid: 5\ndata: {"event_type":"tool_call","tools":[{"name":"file_read","args":"{}"}]}\n\n',
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("tool_call");
    expect(events[0].id).toBe("5");
    expect(events[0].data.tools).toHaveLength(1);
    expect(events[0].data.tools![0].name).toBe("file_read");
  });

  it("buffers incomplete chunks and yields when complete", () => {
    const parser = new SSEParser();
    // First chunk: incomplete event
    const events1 = parser.push("event: ai\nid: 10\n");
    expect(events1).toHaveLength(0);
    // Second chunk: completes the event
    const events2 = parser.push('data: {"content":"hello"}\n\n');
    expect(events2).toHaveLength(1);
    expect(events2[0].type).toBe("ai");
    expect(events2[0].data.content).toBe("hello");
  });

  it("parses multiple events from one chunk", () => {
    const parser = new SSEParser();
    const chunk =
      'event: tool_call\nid: 1\ndata: {"tools":[{"name":"a","args":""}]}\n\n' +
      'event: tool_result\nid: 2\ndata: {"tool_name":"a","content":"ok"}\n\n';
    const events = parser.push(chunk);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("tool_call");
    expect(events[1].type).toBe("tool_result");
  });

  it("defaults type to 'message' when event: field is missing", () => {
    const parser = new SSEParser();
    const events = parser.push('id: 1\ndata: {"content":"x"}\n\n');
    expect(events[0].type).toBe("message");
  });

  it("skips events with no data field", () => {
    const parser = new SSEParser();
    const events = parser.push("event: heartbeat\nid: 99\n\n");
    expect(events).toHaveLength(0);
  });

  it("parses a complete event from the agentmd backend", () => {
    const parser = new SSEParser();
    const events = parser.push(
      'event: complete\nid: 9223372036854775807\ndata: {"status":"success","duration_ms":1234,"total_tokens":5000,"cost_usd":0.015}\n\n',
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("complete");
    expect(events[0].data.status).toBe("success");
    expect(events[0].data.duration_ms).toBe(1234);
    expect(events[0].data.cost_usd).toBe(0.015);
  });

  it("flush() processes remaining buffer when stream ends without trailing \\n\\n", () => {
    const parser = new SSEParser();
    // Push data WITHOUT trailing \n\n (simulates stream ending abruptly)
    const events1 = parser.push(
      'event: complete\nid: 999\ndata: {"status":"success"}',
    );
    expect(events1).toHaveLength(0); // No \n\n, so nothing yielded yet

    // Flush remaining
    const events2 = parser.flush();
    expect(events2).toHaveLength(1);
    expect(events2[0].type).toBe("complete");
    expect(events2[0].data.status).toBe("success");
  });
});
