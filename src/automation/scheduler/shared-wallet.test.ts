import { describe, it, expect, vi } from "vitest";
import { KeyedLock } from "./account-lock";
import { symbolInUse } from "./AnalysisCycleRunner";
import { effectiveAllocation } from "@/automation/risk/allocation-headroom";
import type { ExchangeOrder, ExchangePosition } from "@/automation/executor/client";

const pos = (symbol: string, quantity = 1) => ({ symbol, quantity }) as unknown as ExchangePosition;
const order = (symbol: string, reduceOnly: boolean) => ({ orderId: "o", clientOrderId: null, status: "OPEN", raw: { symbol, reduce_only: reduceOnly } }) as ExchangeOrder;

describe("shared wallet — several wallet-% bots on one wallet", () => {
  it("each bot sizes from the FREE balance at that moment (5 → 4.5 → 3.8 USDT)", () => {
    // bot 1 sees 5 USDT free, opens a trade using 0.5 margin → 4.5 free;
    // bot 2 (also 100%) sizes from 4.5; after its trade 3.8 is free for bot 3.
    const b1 = effectiveAllocation(100, 5).amount;
    const b2 = effectiveAllocation(100, 4.5).amount;
    const b3 = effectiveAllocation(100, 3.8).amount;
    expect(b1).toBeGreaterThan(b2);
    expect(b2).toBeGreaterThan(b3);
    expect(b3).toBeGreaterThan(0);
    expect(b3).toBeLessThanOrEqual(3.8); // never more than is free
    expect(effectiveAllocation(100, 0).amount).toBe(0); // nothing free → no trade, no error
  });

  it("serialises bots of one account so the second reads the balance after the first order", async () => {
    const lock = new KeyedLock();
    let free = 5;
    const seen: number[] = [];
    const bot = (margin: number) =>
      lock.run("user1:PAPER", async () => {
        const balance = free; // read free balance
        await new Promise((r) => setTimeout(r, 5)); // analyse + place order
        seen.push(balance);
        free = balance - margin; // order locks margin
      });
    await Promise.all([bot(0.5), bot(0.7), bot(0.4)]);
    expect(seen).toEqual([5, 4.5, 3.8]);
  });

  it("does not block other accounts or the other trading mode", async () => {
    const lock = new KeyedLock();
    const order: string[] = [];
    let release!: () => void;
    const held = lock.run("user1:LIVE", () => new Promise<void>((r) => (release = () => { order.push("live-1"); r(); })));
    await lock.run("user1:PAPER", async () => order.push("paper-1"));
    await lock.run("user2:LIVE", async () => order.push("other-user"));
    release();
    await held;
    expect(order).toEqual(["paper-1", "other-user", "live-1"]);
  });

  it("keeps working after a bot's cycle throws", async () => {
    const lock = new KeyedLock();
    await expect(lock.run("k", async () => { throw new Error("exchange down"); })).rejects.toThrow("exchange down");
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(lock.run("k", fn)).resolves.toBe("ok");
  });

  it("skips a coin another bot already trades (open position or resting entry), not one only protected", () => {
    expect(symbolInUse("BTCUSDT", [pos("BTCUSDT")], [])).toBe(true);
    expect(symbolInUse("btcusdt", [pos("BTCUSDT")], [])).toBe(true);
    expect(symbolInUse("BTCUSDT", [pos("BTCUSDT", 0)], [])).toBe(false); // flat
    expect(symbolInUse("ETHUSDT", [], [order("ethusdt", false)])).toBe(true); // resting entry
    expect(symbolInUse("ETHUSDT", [], [order("ETHUSDT", true)])).toBe(false); // only a leftover stop / target
    expect(symbolInUse("SOLUSDT", [pos("BTCUSDT")], [order("ETHUSDT", false)])).toBe(false);
  });
});
