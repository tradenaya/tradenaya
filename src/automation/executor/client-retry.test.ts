import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/coinswitch.store", () => ({ getKeysForUser: vi.fn(async () => ({ apiKey: "k", apiSecret: "s", status: "A" })) }));

import { CoinSwitchClient, isTransientError } from "./client";

const timeout = () => Object.assign(new Error("fetch failed"), { cause: { code: "ETIMEDOUT" } });

function client(sendImpl: (...a: unknown[]) => Promise<unknown>) {
  const c = new CoinSwitchClient({ retryDelayMs: 1 });
  const send = vi.fn(sendImpl);
  (c as unknown as { send: typeof send }).send = send;
  return { c, send };
}

describe("CoinSwitch client — reads survive network hiccups, orders are never duplicated", () => {
  it("classifies transient errors", () => {
    expect(isTransientError(timeout())).toBe(true);
    expect(isTransientError(Object.assign(new Error("x"), { name: "AbortError" }))).toBe(true);
    expect(isTransientError(Object.assign(new Error("Too many requests"), { httpStatus: 429 }))).toBe(true);
    expect(isTransientError(Object.assign(new Error("bad gateway"), { httpStatus: 502 }))).toBe(true);
    expect(isTransientError(Object.assign(new Error("Insufficient balance"), { httpStatus: 400 }))).toBe(false);
    expect(isTransientError(new Error("Invalid symbol"))).toBe(false);
  });

  it("retries a read up to 2 more times, then succeeds", async () => {
    let n = 0;
    const { c, send } = client(async () => (++n < 3 ? Promise.reject(timeout()) : { data: { orders: [{ order_id: "a" }] } }));
    expect(await c.getOpenOrders(1, "BTCUSDT")).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("gives up after 3 attempts and reports the failure (caller treats it as a failed read)", async () => {
    const { c, send } = client(async () => Promise.reject(timeout()));
    await expect(c.getPositions(1, "BTCUSDT")).rejects.toThrow("fetch failed");
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("does not retry a real exchange rejection", async () => {
    const { c, send } = client(async () => Promise.reject(Object.assign(new Error("Invalid symbol"), { httpStatus: 400 })));
    await expect(c.getPositions(1, "NOPEUSDT")).rejects.toThrow("Invalid symbol");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("NEVER retries placing an order (could create a duplicate)", async () => {
    const { c, send } = client(async () => Promise.reject(timeout()));
    await expect(
      c.placeOrder(1, { symbol: "BTCUSDT", side: "BUY", orderType: "LIMIT", quantity: 0.001, price: 80000, clientOrderId: "5f1b1d2e-0b0e-5c4a-9d8e-1a2b3c4d5e6f" }),
    ).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("NEVER retries a cancel", async () => {
    const { c, send } = client(async () => Promise.reject(timeout()));
    await c.cancelOrder(1, "o-1").catch(() => null);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
