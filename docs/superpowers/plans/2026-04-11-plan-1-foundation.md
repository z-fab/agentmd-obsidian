# Plan 1 · Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold an Obsidian plugin that connects to the agentmd HTTP backend over a Unix socket, polls `/health` every 15 seconds, and displays the backend status in Obsidian's status bar.

**Architecture:** TypeScript plugin built with esbuild. A framework-agnostic `AgentmdClient` speaks HTTP over a Unix domain socket using Node's built-in `http` module. A `BackendMonitor` owns the polling lifecycle and exposes a simple online/offline observable that `main.ts` wires to a `StatusBarItem`. No views, no SSE, no state store yet — those arrive in Plan 2.

**Tech Stack:** TypeScript 5, Obsidian plugin API (`obsidian` npm package types), esbuild, Vitest for unit tests, Node's built-in `http` for socket transport.

**Reference spec:** `docs/superpowers/specs/2026-04-11-agentmd-obsidian-plugin-design.md`

**Reference agentmd API:** `/Users/zfab/repos/agentmd/docs/api.md`

---

## File map

This plan creates the following files:

```
.gitignore
README.md                         (minimal, one-paragraph stub)
package.json
tsconfig.json
esbuild.config.mjs
vitest.config.ts
manifest.json
versions.json
styles.css                        (empty stub — populated in Plan 2)
main.ts                           (plugin entry)
src/
  types.ts                        (shared types from API contract)
  client/
    agentmd-client.ts             (HTTP client over Unix socket)
  backend-monitor.ts              (health polling + online observable)
tests/
  client/
    agentmd-client.test.ts
  backend-monitor.test.ts
```

No existing files are modified. The project directory is currently empty.

---

## Task 1: Initialize git repo and .gitignore

**Files:**
- Create: `.gitignore`
- Create: `README.md`

- [ ] **Step 1: Initialize git in the project root**

```bash
cd /Users/zfab/repos/agentmd-obisidian
git init
```

Expected: `Initialized empty Git repository in /Users/zfab/repos/agentmd-obisidian/.git/`

- [ ] **Step 2: Write `.gitignore`**

Create `/Users/zfab/repos/agentmd-obisidian/.gitignore` with exactly this content:

```gitignore
# Build output
main.js
main.js.map
*.tsbuildinfo

# Dependencies
node_modules/

# Test output
coverage/

# Editors
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Superpowers brainstorm scratch
.superpowers/

# Obsidian test vaults (local dev only)
test-vault/
```

- [ ] **Step 3: Write a minimal `README.md`**

Create `/Users/zfab/repos/agentmd-obisidian/README.md` with:

```markdown
# agentmd-obsidian

An Obsidian plugin that turns Obsidian into the primary interface for
[agentmd](https://github.com/z-fab/agentmd). Connects to the agentmd HTTP
backend over a Unix domain socket to list agents, run them against the
currently-open note, and stream execution events live inside Obsidian.

Status: pre-alpha. See `docs/superpowers/specs/` for the design.
```

- [ ] **Step 4: Verify the spec and this plan are tracked**

```bash
git status
```

Expected: untracked files include `.gitignore`, `README.md`, and `docs/superpowers/specs/2026-04-11-agentmd-obsidian-plugin-design.md`, and `docs/superpowers/plans/2026-04-11-plan-1-foundation.md`.

- [ ] **Step 5: Initial commit**

```bash
git add .gitignore README.md docs/superpowers/specs/2026-04-11-agentmd-obsidian-plugin-design.md docs/superpowers/plans/2026-04-11-plan-1-foundation.md
git commit -m "chore: initial project with spec and plan 1"
```

Expected: commit created with 4 files.

---

## Task 2: npm scaffold — package.json, TypeScript, esbuild, Vitest

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `esbuild.config.mjs`
- Create: `vitest.config.ts`

- [ ] **Step 1: Write `package.json`**

Create `/Users/zfab/repos/agentmd-obisidian/package.json`:

```json
{
  "name": "agentmd-obsidian",
  "version": "0.1.0",
  "description": "Obsidian plugin for the agentmd markdown-first agent runtime",
  "main": "main.js",
  "scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "tsc --noEmit --skipLibCheck && node esbuild.config.mjs production",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "keywords": ["obsidian-plugin", "agentmd"],
  "author": "",
  "license": "MIT",
  "devDependencies": {
    "@types/node": "^20.11.0",
    "builtin-modules": "^3.3.0",
    "esbuild": "^0.20.0",
    "obsidian": "^1.5.7",
    "tslib": "^2.6.2",
    "typescript": "^5.3.0",
    "vitest": "^1.2.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

Create `/Users/zfab/repos/agentmd-obisidian/tsconfig.json`:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "inlineSourceMap": true,
    "inlineSources": true,
    "module": "ESNext",
    "target": "ES2022",
    "allowJs": true,
    "noImplicitAny": true,
    "moduleResolution": "Bundler",
    "importHelpers": true,
    "isolatedModules": true,
    "strict": true,
    "strictNullChecks": true,
    "lib": ["DOM", "ES2022"],
    "types": ["node"],
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["main.ts", "src/**/*.ts", "tests/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Write `esbuild.config.mjs`**

Create `/Users/zfab/repos/agentmd-obisidian/esbuild.config.mjs`:

```javascript
import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const banner = `/*
THIS IS A GENERATED FILE. Do not edit directly.
If you want to edit the source, see: main.ts and src/
*/
`;

const prod = process.argv[2] === "production";

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
```

- [ ] **Step 4: Write `vitest.config.ts`**

Create `/Users/zfab/repos/agentmd-obisidian/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
    testTimeout: 5000,
  },
});
```

- [ ] **Step 5: Install dependencies**

```bash
cd /Users/zfab/repos/agentmd-obisidian
npm install
```

Expected: `node_modules/` populated, `package-lock.json` created, no errors.

- [ ] **Step 6: Verify TypeScript compiles an empty project**

Create a throwaway `main.ts` with just `export {};` so tsc has an entry point:

```bash
echo 'export {};' > main.ts
npx tsc --noEmit --skipLibCheck
```

Expected: no output, exit code 0.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json esbuild.config.mjs vitest.config.ts main.ts
git commit -m "chore: scaffold TypeScript + esbuild + vitest"
```

---

## Task 3: Obsidian plugin manifest

**Files:**
- Create: `manifest.json`
- Create: `versions.json`
- Create: `styles.css` (empty stub)

- [ ] **Step 1: Write `manifest.json`**

Create `/Users/zfab/repos/agentmd-obisidian/manifest.json`:

```json
{
  "id": "agentmd-obsidian",
  "name": "agentmd",
  "version": "0.1.0",
  "minAppVersion": "1.5.0",
  "description": "Run and observe agentmd agents from inside Obsidian.",
  "author": "",
  "authorUrl": "",
  "isDesktopOnly": true
}
```

The `isDesktopOnly: true` flag is important — the plugin uses Node's `http` module for Unix socket transport, which is not available on Obsidian mobile.

- [ ] **Step 2: Write `versions.json`**

Create `/Users/zfab/repos/agentmd-obisidian/versions.json`:

```json
{
  "0.1.0": "1.5.0"
}
```

- [ ] **Step 3: Write empty `styles.css` stub**

Create `/Users/zfab/repos/agentmd-obisidian/styles.css` with:

```css
/* agentmd-obsidian styles — populated in Plan 2 */
```

- [ ] **Step 4: Commit**

```bash
git add manifest.json versions.json styles.css
git commit -m "chore: add Obsidian plugin manifest"
```

---

## Task 4: Shared types from API contract

**Files:**
- Create: `src/types.ts`

These types mirror the agentmd HTTP API shapes. They're the contract between
the client and the rest of the plugin. Kept in one file so the data shapes
are easy to audit.

- [ ] **Step 1: Write `src/types.ts`**

Create `/Users/zfab/repos/agentmd-obisidian/src/types.ts`:

```typescript
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
```

- [ ] **Step 2: Verify it type-checks**

```bash
npx tsc --noEmit --skipLibCheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: shared types for agentmd API contract"
```

---

## Task 5: AgentmdClient — low-level HTTP over Unix socket

**Files:**
- Create: `src/client/agentmd-client.ts`
- Create: `tests/client/agentmd-client.test.ts`

The client is a framework-agnostic module. It has no Obsidian imports, which
makes it trivial to unit test. It exposes three low-level methods (`get`,
`post`, `del`) and will grow typed wrappers in subsequent tasks.

- [ ] **Step 1: Write the first failing test — constructor stores socket path**

Create `/Users/zfab/repos/agentmd-obisidian/tests/client/agentmd-client.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { AgentmdClient } from "../../src/client/agentmd-client";

describe("AgentmdClient", () => {
  it("constructs with a socket path", () => {
    const client = new AgentmdClient({ socketPath: "/tmp/fake.sock" });
    expect(client.socketPath).toBe("/tmp/fake.sock");
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
npx vitest run tests/client/agentmd-client.test.ts
```

Expected: FAIL — "Failed to resolve import ... agentmd-client"

- [ ] **Step 3: Write minimal implementation**

Create `/Users/zfab/repos/agentmd-obisidian/src/client/agentmd-client.ts`:

```typescript
import * as http from "node:http";

export interface AgentmdClientOptions {
  /**
   * Absolute filesystem path to the agentmd Unix domain socket.
   * Defaults to `~/.local/state/agentmd/agentmd.sock` in settings but the
   * client itself does not resolve `~` — the caller must pass an absolute path.
   */
  socketPath: string;
}

export class AgentmdClient {
  readonly socketPath: string;

  constructor(options: AgentmdClientOptions) {
    this.socketPath = options.socketPath;
  }
}
```

- [ ] **Step 4: Run the test — verify it passes**

```bash
npx vitest run tests/client/agentmd-client.test.ts
```

Expected: PASS (1 test).

- [ ] **Step 5: Add failing test for `get()` — returns JSON from a Unix socket server**

Append to `tests/client/agentmd-client.test.ts`:

```typescript
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { afterEach, beforeEach } from "vitest";

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
```

- [ ] **Step 6: Run the test — verify it fails**

```bash
npx vitest run tests/client/agentmd-client.test.ts
```

Expected: FAIL — `client.get is not a function`.

- [ ] **Step 7: Implement `get()`**

Replace the contents of `src/client/agentmd-client.ts` with:

```typescript
import * as http from "node:http";

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
```

- [ ] **Step 8: Run tests — verify both pass**

```bash
npx vitest run tests/client/agentmd-client.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 9: Add test for non-2xx responses throwing `AgentmdClientError`**

Append another `describe` block to the test file:

```typescript
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
```

Also add the import at the top:

```typescript
import { AgentmdClient, AgentmdClientError } from "../../src/client/agentmd-client";
```

Replace the existing `AgentmdClient` import with the combined import above.

- [ ] **Step 10: Run tests — verify all pass**

```bash
npx vitest run tests/client/agentmd-client.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 11: Commit**

```bash
git add src/client/agentmd-client.ts tests/client/agentmd-client.test.ts
git commit -m "feat: AgentmdClient with GET over Unix socket"
```

---

## Task 6: Client `post()` and `del()` methods

**Files:**
- Modify: `src/client/agentmd-client.ts`
- Modify: `tests/client/agentmd-client.test.ts`

- [ ] **Step 1: Write failing test for `post()`**

Append to `tests/client/agentmd-client.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run — verify failures**

```bash
npx vitest run tests/client/agentmd-client.test.ts
```

Expected: FAIL — `client.post is not a function`, `client.del is not a function`.

- [ ] **Step 3: Add `post()` and `del()` methods**

In `src/client/agentmd-client.ts`, after the `get` method, add:

```typescript
  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  async del<T = void>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }
```

- [ ] **Step 4: Run tests — all pass**

```bash
npx vitest run tests/client/agentmd-client.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/client/agentmd-client.ts tests/client/agentmd-client.test.ts
git commit -m "feat: AgentmdClient post and del methods"
```

---

## Task 7: Typed `health()` wrapper

**Files:**
- Modify: `src/client/agentmd-client.ts`
- Modify: `tests/client/agentmd-client.test.ts`

`health()` is the workhorse endpoint — the `BackendMonitor` calls it every
15 seconds. It needs to return a simple boolean-ish signal. Per the agentmd
API docs, `GET /health` returns 200 with `{"status": "ok"}` when alive.

- [ ] **Step 1: Failing test for `health()`**

Append to `tests/client/agentmd-client.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run — verify failure**

```bash
npx vitest run tests/client/agentmd-client.test.ts
```

Expected: FAIL — `client.health is not a function`.

- [ ] **Step 3: Implement `health()`**

Add to the `AgentmdClient` class in `src/client/agentmd-client.ts`:

```typescript
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
```

Also add the corresponding type import if needed — in this case the inline
`{ status: string }` is sufficient so no import is added.

- [ ] **Step 4: Run tests — all pass**

```bash
npx vitest run tests/client/agentmd-client.test.ts
```

Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/client/agentmd-client.ts tests/client/agentmd-client.test.ts
git commit -m "feat: AgentmdClient.health() probe"
```

---

## Task 8: Typed `info()` wrapper

**Files:**
- Modify: `src/client/agentmd-client.ts`
- Modify: `tests/client/agentmd-client.test.ts`

`info()` returns backend metadata the plugin uses to detect
`vault == workspace`. In Plan 1 we only wire the client method — the
detection logic comes in Plan 3.

- [ ] **Step 1: Failing test for `info()`**

Append to `tests/client/agentmd-client.test.ts`:

```typescript
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
          workspace: "/Users/zfab/agentmd",
          agents_dir: "/Users/zfab/agentmd/agents",
          agent_count: 3,
          scheduler: { running: true, paused: false, job_count: 1 },
        }),
      );
    });

    const client = new AgentmdClient({ socketPath });
    const info = await client.info();

    expect(info.version).toBe("0.8.0");
    expect(info.workspace).toBe("/Users/zfab/agentmd");
    expect(info.agent_count).toBe(3);
    expect(info.scheduler.running).toBe(true);
  });
});
```

- [ ] **Step 2: Run — verify failure**

```bash
npx vitest run tests/client/agentmd-client.test.ts
```

Expected: FAIL — `client.info is not a function`.

- [ ] **Step 3: Implement `info()`**

At the top of `src/client/agentmd-client.ts`, add the import:

```typescript
import type { InfoResponse } from "../types";
```

Add to the `AgentmdClient` class:

```typescript
  /** Fetches backend info (version, workspace path, scheduler state). */
  async info(): Promise<InfoResponse> {
    return this.get<InfoResponse>("/info");
  }
```

- [ ] **Step 4: Run tests — all pass**

```bash
npx vitest run tests/client/agentmd-client.test.ts
```

Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/client/agentmd-client.ts tests/client/agentmd-client.test.ts
git commit -m "feat: AgentmdClient.info() typed wrapper"
```

---

## Task 9: Typed `listAgents()` wrapper

**Files:**
- Modify: `src/client/agentmd-client.ts`
- Modify: `tests/client/agentmd-client.test.ts`

- [ ] **Step 1: Failing test for `listAgents()`**

Append to `tests/client/agentmd-client.test.ts`:

```typescript
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
            trigger: null,
            model: { provider: "anthropic", name: "claude-sonnet-4-6" },
          },
          {
            name: "daily-summary",
            description: "Summarize vault changes.",
            trigger: { type: "schedule", every: "1h" },
            model: { provider: "google", name: "gemini-2.5-flash" },
            next_run: "2026-04-11T13:00:00Z",
          },
        ]),
      );
    });

    const client = new AgentmdClient({ socketPath });
    const agents = await client.listAgents();

    expect(agents).toHaveLength(2);
    expect(agents[0].name).toBe("research");
    expect(agents[1].trigger?.type).toBe("schedule");
    expect(agents[1].next_run).toBe("2026-04-11T13:00:00Z");
  });
});
```

- [ ] **Step 2: Run — verify failure**

```bash
npx vitest run tests/client/agentmd-client.test.ts
```

Expected: FAIL — `client.listAgents is not a function`.

- [ ] **Step 3: Implement `listAgents()`**

Update the import at the top of `src/client/agentmd-client.ts`:

```typescript
import type { AgentSummary, InfoResponse } from "../types";
```

Add to the class:

```typescript
  /** Fetches all agents from the backend. */
  async listAgents(): Promise<AgentSummary[]> {
    return this.get<AgentSummary[]>("/agents");
  }
```

- [ ] **Step 4: Run tests — all pass**

```bash
npx vitest run tests/client/agentmd-client.test.ts
```

Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/client/agentmd-client.ts tests/client/agentmd-client.test.ts
git commit -m "feat: AgentmdClient.listAgents()"
```

---

## Task 10: BackendMonitor with polling and backoff

**Files:**
- Create: `src/backend-monitor.ts`
- Create: `tests/backend-monitor.test.ts`

The monitor polls `client.health()` on a schedule. It owns a simple
observable: callers subscribe, receive updates when the online state flips.
It also supports a `probeNow()` method for "user did something, check
immediately" behavior described in the spec.

This module has no Obsidian imports — the status bar wiring happens in
`main.ts` (Task 12), which imports the monitor.

- [ ] **Step 1: Failing test — monitor starts offline before first probe**

Create `/Users/zfab/repos/agentmd-obisidian/tests/backend-monitor.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BackendMonitor } from "../src/backend-monitor";

function fakeClient(healthImpl: () => Promise<boolean>) {
  return {
    health: vi.fn(healthImpl),
  };
}

describe("BackendMonitor — initial state", () => {
  it("starts as offline before the first probe", () => {
    const client = fakeClient(async () => true);
    const monitor = new BackendMonitor({ client, intervalMs: 15000 });
    expect(monitor.online).toBe(false);
  });
});
```

- [ ] **Step 2: Run — verify failure**

```bash
npx vitest run tests/backend-monitor.test.ts
```

Expected: FAIL — `Failed to resolve import ... backend-monitor`.

- [ ] **Step 3: Minimal implementation**

Create `/Users/zfab/repos/agentmd-obisidian/src/backend-monitor.ts`:

```typescript
export interface HealthProvider {
  health(): Promise<boolean>;
}

export interface BackendMonitorOptions {
  client: HealthProvider;
  /** Normal interval between probes, in milliseconds. Default 15000. */
  intervalMs?: number;
  /** Failure backoff steps, in milliseconds. Default: [5000, 10000, 30000, 60000]. */
  backoffMs?: number[];
}

export type OnlineListener = (online: boolean) => void;

export class BackendMonitor {
  private _online = false;
  private readonly client: HealthProvider;
  private readonly intervalMs: number;
  private readonly backoffMs: number[];
  private backoffIndex = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<OnlineListener>();
  private running = false;

  constructor(options: BackendMonitorOptions) {
    this.client = options.client;
    this.intervalMs = options.intervalMs ?? 15000;
    this.backoffMs = options.backoffMs ?? [5000, 10000, 30000, 60000];
  }

  get online(): boolean {
    return this._online;
  }

  subscribe(listener: OnlineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
```

- [ ] **Step 4: Run test — passes**

```bash
npx vitest run tests/backend-monitor.test.ts
```

Expected: PASS (1 test).

- [ ] **Step 5: Failing test — `probeNow()` flips online state and notifies subscribers**

Append to `tests/backend-monitor.test.ts`:

```typescript
describe("BackendMonitor — probeNow", () => {
  it("updates online state and notifies subscribers when backend is alive", async () => {
    const client = fakeClient(async () => true);
    const monitor = new BackendMonitor({ client, intervalMs: 15000 });

    const states: boolean[] = [];
    monitor.subscribe((online) => states.push(online));

    await monitor.probeNow();

    expect(monitor.online).toBe(true);
    expect(states).toEqual([true]);
    expect(client.health).toHaveBeenCalledTimes(1);
  });

  it("does not notify subscribers when state is unchanged", async () => {
    const client = fakeClient(async () => true);
    const monitor = new BackendMonitor({ client, intervalMs: 15000 });

    await monitor.probeNow(); // first probe → online
    const states: boolean[] = [];
    monitor.subscribe((online) => states.push(online));
    await monitor.probeNow(); // still online

    expect(states).toEqual([]);
  });

  it("flips to offline after three consecutive failures", async () => {
    let callCount = 0;
    const client = fakeClient(async () => {
      callCount++;
      return callCount === 1; // true once, then false
    });
    const monitor = new BackendMonitor({ client, intervalMs: 15000 });

    await monitor.probeNow(); // alive → online
    expect(monitor.online).toBe(true);

    const states: boolean[] = [];
    monitor.subscribe((online) => states.push(online));

    await monitor.probeNow(); // 1st failure → stays online
    expect(monitor.online).toBe(true);
    await monitor.probeNow(); // 2nd failure → stays online
    expect(monitor.online).toBe(true);
    await monitor.probeNow(); // 3rd failure → flips offline
    expect(monitor.online).toBe(false);

    expect(states).toEqual([false]);
  });
});
```

- [ ] **Step 6: Run — verify failures**

```bash
npx vitest run tests/backend-monitor.test.ts
```

Expected: FAIL — `monitor.probeNow is not a function`.

- [ ] **Step 7: Implement `probeNow()` and the failure threshold**

Add to `BackendMonitor` class in `src/backend-monitor.ts`:

```typescript
  private consecutiveFailures = 0;
  private static readonly FAILURE_THRESHOLD = 3;

  /**
   * Fire a probe immediately. Used on startup and on user actions when the
   * monitor is currently offline. Safe to call while the scheduled timer
   * is also ticking — does not double-schedule.
   */
  async probeNow(): Promise<void> {
    const alive = await this.client.health();
    this.recordProbe(alive);
  }

  private recordProbe(alive: boolean): void {
    if (alive) {
      this.consecutiveFailures = 0;
      this.setOnline(true);
    } else {
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= BackendMonitor.FAILURE_THRESHOLD) {
        this.setOnline(false);
      }
    }
  }

  private setOnline(next: boolean): void {
    if (this._online === next) return;
    this._online = next;
    for (const listener of this.listeners) {
      listener(next);
    }
  }
```

- [ ] **Step 8: Run tests — all pass**

```bash
npx vitest run tests/backend-monitor.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 9: Failing test — scheduled polling fires on a timer**

Append to `tests/backend-monitor.test.ts`:

```typescript
describe("BackendMonitor — scheduled polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls on the configured interval after start()", async () => {
    const client = fakeClient(async () => true);
    const monitor = new BackendMonitor({ client, intervalMs: 15000 });

    monitor.start();

    // Immediate probe on start
    await vi.runOnlyPendingTimersAsync();
    expect(client.health).toHaveBeenCalledTimes(1);

    // Advance 15s — next probe
    await vi.advanceTimersByTimeAsync(15000);
    expect(client.health).toHaveBeenCalledTimes(2);

    // Advance another 15s
    await vi.advanceTimersByTimeAsync(15000);
    expect(client.health).toHaveBeenCalledTimes(3);

    monitor.stop();
  });

  it("stop() cancels further probes", async () => {
    const client = fakeClient(async () => true);
    const monitor = new BackendMonitor({ client, intervalMs: 15000 });

    monitor.start();
    await vi.runOnlyPendingTimersAsync();
    expect(client.health).toHaveBeenCalledTimes(1);

    monitor.stop();
    await vi.advanceTimersByTimeAsync(60000);
    expect(client.health).toHaveBeenCalledTimes(1);
  });

  it("uses backoff interval after going offline", async () => {
    // Health always fails.
    const client = fakeClient(async () => false);
    const monitor = new BackendMonitor({
      client,
      intervalMs: 15000,
      backoffMs: [5000, 10000, 30000, 60000],
    });

    monitor.start();

    // Three failures to flip offline.
    await vi.runOnlyPendingTimersAsync(); // probe 1
    await vi.advanceTimersByTimeAsync(15000); // probe 2
    await vi.advanceTimersByTimeAsync(15000); // probe 3 → offline

    expect(monitor.online).toBe(false);
    const callsAtOffline = client.health.mock.calls.length;

    // Now backoff kicks in: next probe in 5000ms, not 15000ms
    await vi.advanceTimersByTimeAsync(4999);
    expect(client.health).toHaveBeenCalledTimes(callsAtOffline);
    await vi.advanceTimersByTimeAsync(1);
    expect(client.health).toHaveBeenCalledTimes(callsAtOffline + 1);

    // Next backoff step: 10000ms
    await vi.advanceTimersByTimeAsync(10000);
    expect(client.health).toHaveBeenCalledTimes(callsAtOffline + 2);

    monitor.stop();
  });
});
```

- [ ] **Step 10: Run — verify failures**

```bash
npx vitest run tests/backend-monitor.test.ts
```

Expected: FAIL — `monitor.start is not a function`, etc.

- [ ] **Step 11: Implement `start()`, `stop()`, and the backoff schedule**

Add to the `BackendMonitor` class in `src/backend-monitor.ts`:

```typescript
  /**
   * Begins scheduled polling. Fires a probe immediately, then schedules
   * the next probe based on online state: `intervalMs` while online,
   * backoff steps while offline.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    void this.tick();
  }

  /** Stops the scheduled timer. `probeNow()` can still be called manually. */
  stop(): void {
    this.running = false;
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    await this.probeNow();
    if (!this.running) return;

    const nextDelay = this._online
      ? this.intervalMs
      : this.nextBackoffDelay();

    this.timer = setTimeout(() => {
      void this.tick();
    }, nextDelay);
  }

  private nextBackoffDelay(): number {
    const delay = this.backoffMs[
      Math.min(this.backoffIndex, this.backoffMs.length - 1)
    ];
    this.backoffIndex += 1;
    return delay;
  }
```

Also update `setOnline` to reset the backoff index when coming back online:

```typescript
  private setOnline(next: boolean): void {
    if (this._online === next) return;
    this._online = next;
    if (next) {
      this.backoffIndex = 0;
    }
    for (const listener of this.listeners) {
      listener(next);
    }
  }
```

- [ ] **Step 12: Run tests — all pass**

```bash
npx vitest run tests/backend-monitor.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 13: Run the full test suite to catch regressions**

```bash
npm test
```

Expected: PASS (17 tests across client and monitor).

- [ ] **Step 14: Commit**

```bash
git add src/backend-monitor.ts tests/backend-monitor.test.ts
git commit -m "feat: BackendMonitor with polling and backoff"
```

---

## Task 11: Main plugin entry — onload, onunload, wire monitor

**Files:**
- Modify: `main.ts` (currently just `export {};`)

The plugin entry is minimal: load defaults, construct the client and
monitor, register a status bar item that reflects the monitor state,
subscribe for updates, and tear everything down on `onunload`.

No unit tests for `main.ts` — exercising Obsidian's Plugin class requires
either a heavy mock layer or a real instance. Validation happens via
manual smoke test in Task 12.

- [ ] **Step 1: Replace `main.ts` with the plugin entry**

Overwrite `/Users/zfab/repos/agentmd-obisidian/main.ts` with:

```typescript
import { Plugin } from "obsidian";
import { AgentmdClient } from "./src/client/agentmd-client";
import { BackendMonitor } from "./src/backend-monitor";

/**
 * Hard-coded defaults for Plan 1. A proper SettingsStore arrives in Plan 3;
 * until then, the plugin uses the stock agentmd socket path.
 */
const DEFAULT_SOCKET_PATH = `${process.env.HOME ?? ""}/.local/state/agentmd/agentmd.sock`;
const DEFAULT_INTERVAL_MS = 15000;

export default class AgentmdPlugin extends Plugin {
  private client!: AgentmdClient;
  private monitor!: BackendMonitor;
  private statusBarEl!: HTMLElement;
  private unsubscribeMonitor: (() => void) | null = null;

  async onload(): Promise<void> {
    this.client = new AgentmdClient({ socketPath: DEFAULT_SOCKET_PATH });
    this.monitor = new BackendMonitor({
      client: this.client,
      intervalMs: DEFAULT_INTERVAL_MS,
    });

    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass("agentmd-status-bar");
    this.renderStatusBar(this.monitor.online);

    this.unsubscribeMonitor = this.monitor.subscribe((online) => {
      this.renderStatusBar(online);
    });

    this.monitor.start();
  }

  onunload(): void {
    this.monitor?.stop();
    this.unsubscribeMonitor?.();
    this.unsubscribeMonitor = null;
  }

  private renderStatusBar(online: boolean): void {
    // Use textContent rather than innerHTML — safer, and sufficient.
    this.statusBarEl.setText(
      online ? "● agentmd · online" : "● agentmd · offline",
    );
    this.statusBarEl.toggleClass("agentmd-status-online", online);
    this.statusBarEl.toggleClass("agentmd-status-offline", !online);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit --skipLibCheck
```

Expected: no errors.

- [ ] **Step 3: Verify esbuild bundles successfully**

```bash
npm run build
```

Expected: `main.js` produced in the project root, no errors. File should be
non-trivial (> 5 KB) since it bundles the client and monitor.

```bash
ls -lh main.js
```

Expected: file exists with size > 5 KB.

- [ ] **Step 4: Commit**

```bash
git add main.ts
git commit -m "feat: plugin entry wires client, monitor, and status bar"
```

---

## Task 12: Status bar polish + manual smoke test + install docs

**Files:**
- Modify: `styles.css`
- Modify: `README.md`

The plugin now builds. Final task wires a tiny bit of CSS so the status bar
has a visible indicator, documents how to install the built plugin into a
real Obsidian vault for smoke testing, and runs the smoke test end-to-end.

- [ ] **Step 1: Add minimal status bar styles**

Overwrite `/Users/zfab/repos/agentmd-obisidian/styles.css` with:

```css
/* agentmd-obsidian — status bar indicator (Plan 1 only).
   Richer styles and the full color system arrive in Plan 2. */

.agentmd-status-bar {
  font-variant-numeric: tabular-nums;
}

.agentmd-status-bar.agentmd-status-online {
  color: var(--text-muted);
}

.agentmd-status-bar.agentmd-status-offline {
  color: var(--text-faint);
}
```

The online/offline states deliberately reuse Obsidian's muted/faint text
colors rather than hardcoded hex values — this keeps the status bar
consistent with the active theme. A colored dot prefix arrives in Plan 2,
when the plugin restructures the status bar text into spans and introduces
the full color-system tokens.

- [ ] **Step 2: Add install instructions to `README.md`**

Append to `/Users/zfab/repos/agentmd-obisidian/README.md`:

```markdown

## Local development install

The plugin is not yet published. To test it against a real Obsidian vault:

1. Build the plugin:

   ```bash
   npm install
   npm run build
   ```

2. Copy the build artifacts into your vault's plugins directory. Replace
   `<VAULT>` with the absolute path to your Obsidian vault:

   ```bash
   VAULT=<VAULT>
   PLUGIN_ID=agentmd-obsidian
   mkdir -p "$VAULT/.obsidian/plugins/$PLUGIN_ID"
   cp main.js manifest.json styles.css "$VAULT/.obsidian/plugins/$PLUGIN_ID/"
   ```

3. Enable the plugin in Obsidian: Settings → Community plugins → toggle
   "agentmd" on. You may need to restart Obsidian.

4. Start the agentmd backend in your terminal:

   ```bash
   agentmd start -d
   ```

5. The Obsidian status bar (bottom right) shows `● agentmd · online`.
   Stop the backend (`agentmd stop`) and watch it flip to
   `● agentmd · offline` within ~45 seconds (three failed polls).
```

- [ ] **Step 3: Run the full test suite one more time**

```bash
npm test
```

Expected: PASS (17 tests).

- [ ] **Step 4: Build the production bundle**

```bash
npm run build
```

Expected: `main.js` produced, no errors.

- [ ] **Step 5: Manual smoke test — happy path**

Follow the install instructions in README to copy `main.js`, `manifest.json`,
and `styles.css` into a real Obsidian vault. Confirm:

1. Plugin enables without errors (check Obsidian's developer console via
   `Ctrl+Shift+I` / `Cmd+Opt+I`).
2. With `agentmd start -d` running, the status bar shows
   `● agentmd · online` within 1 second of enabling the plugin.
3. Run `agentmd stop` in the terminal. Within ~45 seconds, the status bar
   flips to `● agentmd · offline`.
4. Run `agentmd start -d` again. Within ~5-30 seconds (backoff windows),
   the status bar flips back to `● agentmd · online`.
5. No errors in the Obsidian dev console during any of the above.
6. Disable the plugin. No errors, and the status bar item disappears.

- [ ] **Step 6: Commit**

```bash
git add styles.css README.md
git commit -m "chore: status bar styles and install docs"
```

- [ ] **Step 7: Verify git log**

```bash
git log --oneline
```

Expected: 12 commits matching the task boundaries:
```
chore: status bar styles and install docs
feat: plugin entry wires client, monitor, and status bar
feat: BackendMonitor with polling and backoff
feat: AgentmdClient.listAgents()
feat: AgentmdClient.info() typed wrapper
feat: AgentmdClient.health() probe
feat: AgentmdClient post and del methods
feat: AgentmdClient with GET over Unix socket
feat: shared types for agentmd API contract
chore: add Obsidian plugin manifest
chore: scaffold TypeScript + esbuild + vitest
chore: initial project with spec and plan 1
```

---

## Done — what Plan 1 delivers

After finishing all 12 tasks:

- The project compiles, tests pass (17 tests), and a production bundle builds.
- The plugin installs into a real Obsidian vault.
- When the `agentmd` backend is running, Obsidian's status bar shows
  `● agentmd · online`. When the backend stops, it flips to
  `● agentmd · offline` after three failed polls (the backoff then retries
  at 5s → 10s → 30s → 60s).
- The `AgentmdClient` has five methods ready for Plan 2 to consume: `get`,
  `post`, `del`, `health`, `info`, `listAgents`.
- There is no UI beyond the status bar, no state store, no SSE — those
  arrive in Plan 2.

Plan 2 will build the `EventStore`, the `SseStream` parser, the `AgentsView`,
the `LiveView`, the `ExecutionDetailView`, and wire the full "click ▶ and
watch it stream" flow. See the spec for the full v1 scope.
