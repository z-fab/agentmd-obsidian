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
