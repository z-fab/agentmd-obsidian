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
    await expect(client.get("/boom")).rejects.toMatchObject({
      name: "AgentmdClientError",
      statusCode: 500,
      body: "backend on fire",
    });
  });

  it("throws AgentmdClientError on connection failure", async () => {
    // No server started — socket does not exist.
    const client = new AgentmdClient({ socketPath });
    await expect(client.get("/anything")).rejects.toMatchObject({
      name: "AgentmdClientError",
    });
  });
});
