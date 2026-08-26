import type { ConnectionState, DataFreshness, MarketHealth, ServiceHealthState } from "./types";

export interface HealthDependencies {
  /** current WebSocket state */
  getConnectionState: () => ConnectionState;
  /** true while recovery is running */
  isRecovering: () => boolean;
  /** whether any symbol has no data / stale data for consumers */
  hasDataGaps: () => boolean;
  /** per-symbol freshness, used to detect gaps */
  freshnessOf?: (symbol: string) => DataFreshness;
  subscribedSymbols: () => string[];
}

/**
 * Derives the overall health of the market-data service from the socket
 * state and data freshness. Pure — no side effects, easy to test.
 */
export function computeHealth(deps: HealthDependencies): MarketHealth {
  const connection = deps.getConnectionState();
  const subscribedSymbols = deps.subscribedSymbols();
  const symbolsWithGaps = subscribedSymbols.filter(
    (symbol) => deps.freshnessOf?.(symbol) !== "FRESH",
  );
  const dataGaps = deps.hasDataGaps() || symbolsWithGaps.length > 0;

  let state: ServiceHealthState = "CONNECTED";
  let message = "Market data service is healthy";
  let ready = true;

  switch (connection) {
    case "DISCONNECTED":
      state = "DISCONNECTED";
      message = "WebSocket is disconnected — no live market data";
      ready = false;
      break;
    case "RECONNECTING":
      state = "RECOVERING";
      message = "WebSocket reconnecting — temporary data gap";
      ready = false;
      break;
    case "CONNECTING":
      state = "RECOVERING";
      message = "WebSocket connecting — initializing market data";
      ready = false;
      break;
    case "CONNECTED":
      if (deps.isRecovering()) {
        state = "RECOVERING";
        message = "Restoring subscriptions and backfilling data";
        ready = false;
      } else if (dataGaps) {
        state = "DEGRADED";
        message = "Connected but some symbols lack fresh data";
        ready = true;
      }
      break;
    default:
      state = "CONNECTED";
      break;
  }

  return {
    state,
    connection,
    ready,
    dataFresh: !dataGaps && connection === "CONNECTED",
    degraded: state === "DEGRADED",
    message,
    details: {
      connected: connection === "CONNECTED",
      connecting: connection === "CONNECTING",
      reconnecting: connection === "RECONNECTING",
      recovering: deps.isRecovering(),
      subscriptionsActive: subscribedSymbols.length,
      dataGaps,
      symbolsWithGaps,
      lastDataAt: null,
    },
  };
}
