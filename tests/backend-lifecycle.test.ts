import { describe, it, expect, vi } from "vitest";
import { BackendLifecycle } from "../src/backend-lifecycle";

describe("BackendLifecycle", () => {
  it("constructs with default agentmd path", () => {
    const lifecycle = new BackendLifecycle({
      healthCheck: async () => false,
      shutdown: async () => {},
    });
    expect(lifecycle).toBeDefined();
  });

  it("stop() calls the shutdown function", async () => {
    const shutdown = vi.fn(async () => {});
    const lifecycle = new BackendLifecycle({
      healthCheck: async () => true,
      shutdown,
    });

    await lifecycle.stop();
    expect(shutdown).toHaveBeenCalledOnce();
  });

  it("stop() returns false and does not throw if shutdown fails", async () => {
    const shutdown = vi.fn(async () => {
      throw new Error("connection refused");
    });
    const lifecycle = new BackendLifecycle({
      healthCheck: async () => true,
      shutdown,
    });

    const result = await lifecycle.stop();
    expect(result).toBe(false);
  });

  it("start() returns success when health check passes after exec", async () => {
    let healthCallCount = 0;
    const lifecycle = new BackendLifecycle({
      agentmdPath: "echo", // "echo" exists on all platforms and will succeed
      healthCheck: async () => {
        healthCallCount++;
        return healthCallCount >= 2; // fail first, pass second
      },
      shutdown: async () => {},
      startTimeoutMs: 5000,
      startPollMs: 50,
    });

    const result = await lifecycle.start();
    expect(result.success).toBe(true);
  });

  it("start() returns failure when health check never passes", async () => {
    const lifecycle = new BackendLifecycle({
      agentmdPath: "echo",
      healthCheck: async () => false,
      shutdown: async () => {},
      startTimeoutMs: 200,
      startPollMs: 50,
    });

    const result = await lifecycle.start();
    expect(result.success).toBe(false);
  });
});
