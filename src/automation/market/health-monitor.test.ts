import { describe, it, expect } from "vitest";
import { computeHealth } from "./health-monitor";
import type { ConnectionState } from "./types";

function deps(overrides: Partial<Parameters<typeof computeHealth>[0]> = {}) {
  return {
    getConnectionState: () => "CONNECTED" as ConnectionState,
    isRecovering: () => false,
    hasDataGaps: () => false,
    freshnessOf: () => "FRESH" as const,
    subscribedSymbols: () => ["BTCUSDT"],
    ...overrides,
  };
}

describe("computeHealth", () => {
  it("reports CONNECTED + ready when everything is healthy", () => {
    const health = computeHealth(deps());
    expect(health.state).toBe("CONNECTED");
    expect(health.ready).toBe(true);
    expect(health.dataFresh).toBe(true);
  });

  it("reports DISCONNECTED and not ready when the socket is down", () => {
    const health = computeHealth(deps({ getConnectionState: () => "DISCONNECTED" }));
    expect(health.state).toBe("DISCONNECTED");
    expect(health.ready).toBe(false);
    expect(health.dataFresh).toBe(false);
  });

  it("reports RECOVERING during reconnect", () => {
    const health = computeHealth(deps({ getConnectionState: () => "RECONNECTING" }));
    expect(health.state).toBe("RECOVERING");
    expect(health.ready).toBe(false);
  });

  it("reports DEGRADED when symbols lack fresh data while connected", () => {
    const health = computeHealth(deps({ freshnessOf: () => "STALE" }));
    expect(health.state).toBe("DEGRADED");
    expect(health.ready).toBe(true);
    expect(health.degraded).toBe(true);
    expect(health.details.symbolsWithGaps).toEqual(["BTCUSDT"]);
  });

  it("reports DEGRADED when hasDataGaps is true", () => {
    const health = computeHealth(deps({ freshnessOf: () => "FRESH", hasDataGaps: () => true }));
    expect(health.state).toBe("DEGRADED");
  });

  it("reports RECOVERING while recovery is running even when connected", () => {
    const health = computeHealth(deps({ isRecovering: () => true }));
    expect(health.state).toBe("RECOVERING");
    expect(health.ready).toBe(false);
  });
});
