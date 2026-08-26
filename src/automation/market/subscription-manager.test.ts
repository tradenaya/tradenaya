import { describe, it, expect, vi } from "vitest";
import { MarketDataSubscriptionManager } from "./subscription-manager";

describe("MarketDataSubscriptionManager", () => {
  it("dedupes a symbol across consumers", () => {
    const manager = new MarketDataSubscriptionManager();
    manager.subscribe("BTCUSDT", "bot-1");
    manager.subscribe("btcusdt", "bot-2");
    expect(manager.getSymbols()).toEqual(["BTCUSDT"]);
    expect(manager.consumerCount("BTCUSDT")).toBe(2);
  });

  it("dedupes the same consumer subscribing twice", () => {
    const manager = new MarketDataSubscriptionManager();
    manager.subscribe("BTCUSDT", "bot-1");
    manager.subscribe("BTCUSDT", "bot-1");
    expect(manager.consumerCount("BTCUSDT")).toBe(1);
  });

  it("releases the symbol when the last consumer leaves", () => {
    const manager = new MarketDataSubscriptionManager();
    manager.subscribe("BTCUSDT", "a");
    manager.subscribe("BTCUSDT", "b");
    expect(manager.unsubscribe("BTCUSDT", "a")).toBe(false);
    expect(manager.hasConsumers("BTCUSDT")).toBe(true);
    expect(manager.unsubscribe("BTCUSDT", "b")).toBe(true);
    expect(manager.hasConsumers("BTCUSDT")).toBe(false);
    expect(manager.getSymbols()).toEqual([]);
  });

  it("tracks websocketSubscribed flag", () => {
    const manager = new MarketDataSubscriptionManager();
    manager.subscribe("BTCUSDT", "a");
    expect(manager.getPendingSymbols()).toEqual(["BTCUSDT"]);
    manager.markSubscribed("BTCUSDT", true);
    expect(manager.getPendingSymbols()).toEqual([]);
    manager.markSubscribed("BTCUSDT", false);
    expect(manager.getPendingSymbols()).toEqual(["BTCUSDT"]);
  });

  it("updates lastRefreshedAt on re-subscribe", () => {
    const now = vi.fn(() => 0);
    const manager = new MarketDataSubscriptionManager(now);
    const sub = manager.subscribe("BTCUSDT", "a");
    now.mockReturnValue(5000);
    const refreshed = manager.subscribe("BTCUSDT", "b");
    expect(refreshed.lastRefreshedAt).toBe(5000);
    expect(sub.lastRefreshedAt).toBe(5000);
  });
});
