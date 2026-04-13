import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { AgentmdClient, AgentmdClientError } from "../../src/client/agentmd-client";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

// Helpers ---------------------------------------------------------------

function tempSocketPath(): string {
  const name = `agentmd-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`;
  return path.join(os.tmpdir(), name);
}

function startFakeServer(
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
      try {
        fs.unlinkSync(socketPath);
      } catch {
        /* ignore */
      }
      resolve();
    });
  });
}

// Tests -----------------------------------------------------------------

describe("AgentmdClient", () => {
  it("constructs with a socket path", () => {
    const client = new AgentmdClient({ socketPath: "/tmp/fake.sock" });
    expect(client.socketPath).toBe("/tmp/fake.sock");
  });
});

describe("AgentmdClient.get()", () => {
  let socketPath: string;
  let server: http.Server;

  beforeEach(() => {
    socketPath = tempSocketPath();
  });

  afterEach(async () => {
    if (server) {
      await stopServer(server, socketPath);
    }
  });

  it("sends a GET request to the configured path and parses JSON", async () => {
    let requestedPath: string | undefined;
    let requestedMethod: string | undefined;

    server = await startFakeServer(socketPath, (req, res) => {
      requestedPath = req.url;
      requestedMethod = req.method;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ hello: "world" }));
    });

    const client = new AgentmdClient({ socketPath });
    const result = await client.get<{ hello: string }>("/hello");

    expect(requestedPath).toBe("/hello");
    expect(requestedMethod).toBe("GET");
    expect(result).toEqual({ hello: "world" });
  });
});

describe("AgentmdClient error handling", () => {
  let socketPath: string;
  let server: http.Server;

  beforeEach(() => {
    socketPath = tempSocketPath();
  });

  afterEach(async () => {
    if (server) {
      await stopServer(server, socketPath);
    }
  });

  it("throws AgentmdClientError on 5xx responses with body", async () => {
    server = await startFakeServer(socketPath, (_req, res) => {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("backend on fire");
    });

    const client = new AgentmdClient({ socketPath });
    await expect(client.get("/boom")).rejects.toBeInstanceOf(AgentmdClientError);
    await expect(client.get("/boom")).rejects.toMatchObject({
      statusCode: 500,
      body: "backend on fire",
    });
  });

  it("throws AgentmdClientError on connection failure", async () => {
    // No server started — socket does not exist.
    const client = new AgentmdClient({ socketPath });
    await expect(client.get("/anything")).rejects.toBeInstanceOf(AgentmdClientError);
    await expect(client.get("/anything")).rejects.toMatchObject({
      name: "AgentmdClientError",
    });
  });
});

describe("AgentmdClient.post()", () => {
  let socketPath: string;
  let server: http.Server;

  beforeEach(() => {
    socketPath = tempSocketPath();
  });

  afterEach(async () => {
    if (server) {
      await stopServer(server, socketPath);
    }
  });

  it("sends JSON body and parses the response", async () => {
    let receivedBody: string | undefined;
    let receivedMethod: string | undefined;
    let receivedContentType: string | undefined;

    server = await startFakeServer(socketPath, (req, res) => {
      receivedMethod = req.method;
      receivedContentType = req.headers["content-type"];
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        receivedBody = Buffer.concat(chunks).toString("utf8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ execution_id: 42 }));
      });
    });

    const client = new AgentmdClient({ socketPath });
    const result = await client.post<{ execution_id: number }>("/agents/foo/run", {
      args: ["bar"],
    });

    expect(receivedMethod).toBe("POST");
    expect(receivedContentType).toBe("application/json");
    expect(JSON.parse(receivedBody!)).toEqual({ args: ["bar"] });
    expect(result.execution_id).toBe(42);
  });
});

describe("AgentmdClient.del()", () => {
  let socketPath: string;
  let server: http.Server;

  beforeEach(() => {
    socketPath = tempSocketPath();
  });

  afterEach(async () => {
    if (server) {
      await stopServer(server, socketPath);
    }
  });

  it("sends a DELETE request", async () => {
    let receivedMethod: string | undefined;
    let receivedPath: string | undefined;

    server = await startFakeServer(socketPath, (req, res) => {
      receivedMethod = req.method;
      receivedPath = req.url;
      res.writeHead(204);
      res.end();
    });

    const client = new AgentmdClient({ socketPath });
    await client.del("/executions/7");

    expect(receivedMethod).toBe("DELETE");
    expect(receivedPath).toBe("/executions/7");
  });
});

describe("AgentmdClient.health()", () => {
  let socketPath: string;
  let server: http.Server;

  beforeEach(() => {
    socketPath = tempSocketPath();
  });

  afterEach(async () => {
    if (server) {
      await stopServer(server, socketPath);
    }
  });

  it("returns true when backend responds 200 with status ok", async () => {
    server = await startFakeServer(socketPath, (req, res) => {
      expect(req.url).toBe("/health");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    });

    const client = new AgentmdClient({ socketPath });
    const alive = await client.health();

    expect(alive).toBe(true);
  });

  it("returns false when backend is unreachable", async () => {
    // No server bound.
    const client = new AgentmdClient({ socketPath });
    const alive = await client.health();

    expect(alive).toBe(false);
  });
});

describe("AgentmdClient.info()", () => {
  let socketPath: string;
  let server: http.Server;

  beforeEach(() => {
    socketPath = tempSocketPath();
  });

  afterEach(async () => {
    if (server) {
      await stopServer(server, socketPath);
    }
  });

  it("returns typed InfoResponse", async () => {
    server = await startFakeServer(socketPath, (req, res) => {
      expect(req.url).toBe("/info");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          version: "0.8.0",
          pid: 12345,
          uptime_seconds: 42,
          agents_loaded: 3,
          agents_enabled: 3,
          scheduler_status: "running",
          watcher_active: false,
          active_streams: 0,
          active_executions: 0,
        }),
      );
    });

    const client = new AgentmdClient({ socketPath });
    const info = await client.info();

    expect(info.version).toBe("0.8.0");
    expect(info.agents_loaded).toBe(3);
    expect(info.scheduler_status).toBe("running");
  });
});

describe("AgentmdClient.listAgents()", () => {
  let socketPath: string;
  let server: http.Server;

  beforeEach(() => {
    socketPath = tempSocketPath();
  });

  afterEach(async () => {
    if (server) {
      await stopServer(server, socketPath);
    }
  });

  it("returns an array of AgentSummary", async () => {
    server = await startFakeServer(socketPath, (req, res) => {
      expect(req.url).toBe("/agents");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify([
          {
            name: "research",
            description: "Research topics and summarize.",
            enabled: true,
            trigger_type: "manual",
            model_provider: "anthropic",
            model_name: "claude-sonnet-4-6",
          },
          {
            name: "daily-summary",
            description: "Summarize vault changes.",
            enabled: true,
            trigger_type: "schedule",
            model_provider: "google",
            model_name: "gemini-2.5-flash",
          },
        ]),
      );
    });

    const client = new AgentmdClient({ socketPath });
    const agents = await client.listAgents();

    expect(agents).toHaveLength(2);
    expect(agents[0].name).toBe("research");
    expect(agents[1].trigger_type).toBe("schedule");
  });
});

describe("AgentmdClient.runAgent()", () => {
  let socketPath: string;
  let server: http.Server;

  beforeEach(() => { socketPath = tempSocketPath(); });
  afterEach(async () => { if (server) await stopServer(server, socketPath); });

  it("POSTs to /agents/{name}/run and returns execution_id", async () => {
    let receivedPath: string | undefined;
    let receivedBody: string | undefined;

    server = await startFakeServer(socketPath, (req, res) => {
      receivedPath = req.url;
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        receivedBody = Buffer.concat(chunks).toString("utf8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ execution_id: 99 }));
      });
    });

    const client = new AgentmdClient({ socketPath });
    const result = await client.runAgent("research", { args: ["/path/to/file.md"] });

    expect(receivedPath).toBe("/agents/research/run");
    expect(JSON.parse(receivedBody!)).toEqual({ args: ["/path/to/file.md"] });
    expect(result.execution_id).toBe(99);
  });
});

describe("AgentmdClient.cancelExecution()", () => {
  let socketPath: string;
  let server: http.Server;

  beforeEach(() => { socketPath = tempSocketPath(); });
  afterEach(async () => { if (server) await stopServer(server, socketPath); });

  it("sends DELETE /executions/{id}", async () => {
    let receivedPath: string | undefined;
    let receivedMethod: string | undefined;

    server = await startFakeServer(socketPath, (req, res) => {
      receivedPath = req.url;
      receivedMethod = req.method;
      res.writeHead(204);
      res.end();
    });

    const client = new AgentmdClient({ socketPath });
    await client.cancelExecution(42);

    expect(receivedMethod).toBe("DELETE");
    expect(receivedPath).toBe("/executions/42");
  });
});

describe("AgentmdClient.listExecutions()", () => {
  let socketPath: string;
  let server: http.Server;

  beforeEach(() => { socketPath = tempSocketPath(); });
  afterEach(async () => { if (server) await stopServer(server, socketPath); });

  it("sends GET /executions with query params", async () => {
    let receivedPath: string | undefined;

    server = await startFakeServer(socketPath, (req, res) => {
      receivedPath = req.url;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([]));
    });

    const client = new AgentmdClient({ socketPath });
    await client.listExecutions({ status: "running", limit: 10 });

    expect(receivedPath).toContain("/executions");
    expect(receivedPath).toContain("status=running");
    expect(receivedPath).toContain("limit=10");
  });
});

describe("AgentmdClient.getAgent()", () => {
  let socketPath: string;
  let server: http.Server;
  beforeEach(() => { socketPath = tempSocketPath(); });
  afterEach(async () => { if (server) await stopServer(server, socketPath); });

  it("fetches agent detail by name", async () => {
    server = await startFakeServer(socketPath, (req, res) => {
      expect(req.url).toBe("/agents/research");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        name: "research",
        description: "Research topics",
        enabled: true,
        trigger_type: "manual",
        model_provider: "anthropic",
        model_name: "claude-sonnet-4-6",
        last_run: "2026-04-11T12:00:00Z",
        next_run: null,
        history: "low",
        settings: { temperature: 0.7, max_tool_calls: 50 },
      }));
    });
    const client = new AgentmdClient({ socketPath });
    const agent = await client.getAgent("research");
    expect(agent.name).toBe("research");
    expect(agent.settings.temperature).toBe(0.7);
    expect(agent.last_run).toBe("2026-04-11T12:00:00Z");
  });
});

describe("AgentmdClient.getAgentRuns()", () => {
  let socketPath: string;
  let server: http.Server;
  beforeEach(() => { socketPath = tempSocketPath(); });
  afterEach(async () => { if (server) await stopServer(server, socketPath); });

  it("fetches runs for a specific agent", async () => {
    server = await startFakeServer(socketPath, (req, res) => {
      expect(req.url).toBe("/agents/research/runs?limit=5");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([
        { id: 1, agent_id: "research", status: "success", trigger: "manual", started_at: "2026-04-11T12:00:00Z" },
      ]));
    });
    const client = new AgentmdClient({ socketPath });
    const runs = await client.getAgentRuns("research", 5);
    expect(runs).toHaveLength(1);
    expect(runs[0].agent_id).toBe("research");
  });
});

describe("AgentmdClient.getScheduler()", () => {
  let socketPath: string;
  let server: http.Server;
  beforeEach(() => { socketPath = tempSocketPath(); });
  afterEach(async () => { if (server) await stopServer(server, socketPath); });

  it("returns scheduler status with jobs", async () => {
    server = await startFakeServer(socketPath, (req, res) => {
      expect(req.url).toBe("/scheduler");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "running",
        jobs: [{ agent_name: "daily", trigger_type: "schedule", next_run: "2026-04-12T13:00:00Z" }],
      }));
    });
    const client = new AgentmdClient({ socketPath });
    const sched = await client.getScheduler();
    expect(sched.status).toBe("running");
    expect(sched.jobs).toHaveLength(1);
    expect(sched.jobs[0].next_run).toBe("2026-04-12T13:00:00Z");
  });
});
