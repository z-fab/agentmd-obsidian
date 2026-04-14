import { describe, it, expect, afterEach } from "vitest";
import { GlobalSSEConnection, type GlobalSSEState } from "../../src/client/global-sse";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

// --- Test helpers ---

function tempSocketPath(): string {
  const name = `agentmd-test-sse-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`;
  return path.join(os.tmpdir(), name);
}

function startSSEServer(
  socketPath: string,
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.on("error", reject);
    server.listen(socketPath, () => resolve(server));
  });
}

function stopServer(server: http.Server, socketPath: string): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => {
      try { fs.unlinkSync(socketPath); } catch { /* ignore */ }
      resolve();
    });
  });
}

function sseMessage(event: string, data: object): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// --- Tests ---

describe("GlobalSSEConnection - event dispatch", () => {
  let socketPath: string;
  let server: http.Server;

  afterEach(async () => {
    if (server) await stopServer(server, socketPath);
  });

  it("dispatches heartbeat events to onEvent callback", async () => {
    socketPath = tempSocketPath();
    const events: Array<{ type: string; data: unknown }> = [];

    server = await startSSEServer(socketPath, (_req, res) => {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(sseMessage("heartbeat", { timestamp: "2026-01-01T00:00:00Z" }));
    });

    const sse = new GlobalSSEConnection({
      socketPath,
      onEvent: (type, data) => events.push({ type, data }),
      reconnectBackoffMs: [100, 200],
      maxReconnectAttempts: 2,
    });

    sse.start();
    await new Promise((r) => setTimeout(r, 200));
    sse.stop();

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].type).toBe("heartbeat");
  });

  it("dispatches execution_started events", async () => {
    socketPath = tempSocketPath();
    const events: Array<{ type: string; data: unknown }> = [];

    server = await startSSEServer(socketPath, (_req, res) => {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(sseMessage("execution_started", {
        execution_id: 42,
        agent_name: "test-agent",
        trigger: "manual",
      }));
    });

    const sse = new GlobalSSEConnection({
      socketPath,
      onEvent: (type, data) => events.push({ type, data }),
      reconnectBackoffMs: [100],
      maxReconnectAttempts: 1,
    });

    sse.start();
    await new Promise((r) => setTimeout(r, 200));
    sse.stop();

    expect(events.some((e) => e.type === "execution_started")).toBe(true);
    const started = events.find((e) => e.type === "execution_started");
    expect((started!.data as any).execution_id).toBe(42);
  });

  it("reports state changes", async () => {
    socketPath = tempSocketPath();
    const states: GlobalSSEState[] = [];

    server = await startSSEServer(socketPath, (_req, res) => {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(sseMessage("heartbeat", { timestamp: "2026-01-01T00:00:00Z" }));
    });

    const sse = new GlobalSSEConnection({
      socketPath,
      onEvent: () => {},
      onStateChanged: (state) => states.push(state),
      reconnectBackoffMs: [100],
      maxReconnectAttempts: 1,
    });

    sse.start();
    await new Promise((r) => setTimeout(r, 200));

    expect(states).toContain("connected");

    sse.stop();
  });
});

describe("GlobalSSEConnection - reconnection", () => {
  it("attempts reconnection when connection is refused", async () => {
    const socketPath = tempSocketPath();
    const states: GlobalSSEState[] = [];

    const sse = new GlobalSSEConnection({
      socketPath, // no server listening
      onEvent: () => {},
      onStateChanged: (state) => states.push(state),
      reconnectBackoffMs: [50, 100],
      maxReconnectAttempts: 2,
    });

    sse.start();
    await new Promise((r) => setTimeout(r, 500));
    sse.stop();

    expect(states).toContain("reconnecting");
    // After max attempts, should go to fallback
    expect(states).toContain("fallback");
  });
});
