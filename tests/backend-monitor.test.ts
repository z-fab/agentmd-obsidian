import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BackendMonitor } from "../src/backend-monitor";

function fakeClient(healthImpl: () => Promise<boolean>) {
  return { health: vi.fn(healthImpl) };
}

describe("BackendMonitor - SSE-driven mode", () => {
  it("starts as offline", () => {
    const client = fakeClient(async () => true);
    const monitor = new BackendMonitor({ client, intervalMs: 15000 });
    expect(monitor.online).toBe(false);
  });

  it("goes online when notifySSEConnected is called", () => {
    const client = fakeClient(async () => true);
    const monitor = new BackendMonitor({ client, intervalMs: 15000 });

    const states: boolean[] = [];
    monitor.subscribe((online) => states.push(online));

    monitor.notifySSEConnected();

    expect(monitor.online).toBe(true);
    expect(states).toEqual([true]);
  });

  it("goes offline when notifySSEDisconnected is called", () => {
    const client = fakeClient(async () => true);
    const monitor = new BackendMonitor({ client, intervalMs: 15000 });

    monitor.notifySSEConnected();
    expect(monitor.online).toBe(true);

    const states: boolean[] = [];
    monitor.subscribe((online) => states.push(online));

    monitor.notifySSEDisconnected();

    expect(monitor.online).toBe(false);
    expect(states).toEqual([false]);
  });

  it("reports mode as 'sse' when SSE is connected", () => {
    const client = fakeClient(async () => true);
    const monitor = new BackendMonitor({ client, intervalMs: 15000 });

    monitor.notifySSEConnected();
    expect(monitor.mode).toBe("sse");
  });

  it("reports mode as 'offline' when disconnected", () => {
    const client = fakeClient(async () => true);
    const monitor = new BackendMonitor({ client, intervalMs: 15000 });
    expect(monitor.mode).toBe("offline");
  });
});

describe("BackendMonitor - fallback polling mode", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("polls /health when activated via activateFallback()", async () => {
    const client = fakeClient(async () => true);
    const monitor = new BackendMonitor({ client, intervalMs: 15000 });

    monitor.activateFallback();
    expect(monitor.mode).toBe("fallback");

    // Immediate probe
    await vi.runOnlyPendingTimersAsync();
    expect(client.health).toHaveBeenCalledTimes(1);
    expect(monitor.online).toBe(true);

    // Next poll at intervalMs
    await vi.advanceTimersByTimeAsync(15000);
    expect(client.health).toHaveBeenCalledTimes(2);

    monitor.deactivateFallback();
  });

  it("deactivateFallback stops polling", async () => {
    const client = fakeClient(async () => true);
    const monitor = new BackendMonitor({ client, intervalMs: 15000 });

    monitor.activateFallback();
    await vi.runOnlyPendingTimersAsync();
    expect(client.health).toHaveBeenCalledTimes(1);

    monitor.deactivateFallback();
    await vi.advanceTimersByTimeAsync(60000);
    expect(client.health).toHaveBeenCalledTimes(1);
  });

  it("reports mode as 'fallback' during fallback polling", () => {
    const client = fakeClient(async () => true);
    const monitor = new BackendMonitor({ client, intervalMs: 15000 });

    monitor.activateFallback();
    expect(monitor.mode).toBe("fallback");
    monitor.deactivateFallback();
  });
});

describe("BackendMonitor - probeNow", () => {
  it("returns health check result", async () => {
    const client = fakeClient(async () => true);
    const monitor = new BackendMonitor({ client, intervalMs: 15000 });

    const result = await monitor.probeNow();
    expect(result).toBe(true);
    expect(client.health).toHaveBeenCalledOnce();
  });
});
