import { describe, expect, it, vi } from "vitest";
import { CoinSwitchClient } from "@/automation/executor/client";
import { OrderExecutorService } from "@/automation/executor/order-executor";
import { ProtectiveOrdersService } from "@/automation/executor/services/protective-orders";
import type { ExecutionStore } from "@/automation/executor/store";
import type { ExecutionRecord } from "@/automation/executor/types";
import type { TradePlan } from "@/automation/planner/types";
import { detectExecutedClose } from "@/automation/position/executed-close";
import { reconcileClose } from "@/automation/position/close-accounting";
import type { PositionRecord } from "@/automation/position/PositionManagerTypes";
import { paperExchange, PaperExchange, TAKER_FEE, MAKER_FEE, TAKER_SLIPPAGE, type Candle1m } from "./exchange";
import { MemoryPaperStore } from "./store";
import { runWithTradingMode } from "./mode";

/**
 * End-to-end paper trade through the REAL production code paths: the order
 * executor and protective-order service place orders via CoinSwitchClient,
 * which (in PAPER mode) routes them to the paper exchange; fills come from
 * market candles; close detection + close accounting read the paper ledger.
 * Only the database (execution store) and the market data feed are faked.
 */
const MIN = 60_000;

function harness() {
  let now = Date.UTC(2026, 9, 1, 0, 0);
  let price = 100;
  const candles: Candle1m[] = [];
  const store = new MemoryPaperStore();
  const exchange = new PaperExchange(store, { price: async () => price, candles: async (_u, _s, since) => candles.filter((c) => c.start >= since) }, () => now);

  // Real client; market-data endpoints (instrument info) stubbed — the network is never used.
  const client = new CoinSwitchClient();
  vi.spyOn(client, "getInstrumentInfo").mockResolvedValue({
    symbol: "BTCUSDT", min_base_quantity: "0.001", base_quantity_step_size: "0.001", lot_size: "0.001",
    quantity_precision: 3, price_precision: 2, min_leverage: "1", max_leverage: "100", leverage_step: "1",
  });
  vi.spyOn(client, "getCurrentPrice").mockImplementation(async () => price);

  let execution: ExecutionRecord | null = null;
  const execStore = {
    getActiveByExecutionKey: vi.fn(async () => null),
    createExecution: vi.fn(async (row: Partial<ExecutionRecord>) => {
      execution = { id: 1, botId: 1, userId: 1, ...row, entry: { orderId: null, clientOrderId: null, status: null }, stopLossOrder: { orderId: null, clientOrderId: null, status: null }, takeProfitOrder: { orderId: null, clientOrderId: null, status: null }, protectiveStatus: "NONE", createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() } as ExecutionRecord;
      return 1;
    }),
    claimSubmission: vi.fn(async () => ({ ok: true, holderExecutionId: null })),
    updateState: vi.fn(async (_id: number, state: ExecutionRecord["state"]) => { if (execution) execution.state = state; }),
    saveNotification: vi.fn(async () => {}),
    updateEntryRef: vi.fn(async (_id: number, ref: ExecutionRecord["entry"]) => { if (execution) execution.entry = { ...execution.entry, ...ref }; }),
    updateFill: vi.fn(async () => {}),
    updateProtectiveRef: vi.fn(async (_id: number, kind: string, ref: ExecutionRecord["entry"]) => {
      if (!execution) return;
      if (kind === "STOP_LOSS" || kind === "stopLoss") execution.stopLossOrder = ref;
      else execution.takeProfitOrder = ref;
    }),
    updateProtectiveStatus: vi.fn(async () => {}),
    getExecution: vi.fn(async () => execution),
  } as unknown as ExecutionStore;

  return {
    exchange, store, client, execStore,
    get execution() { return execution as ExecutionRecord | null; },
    setPrice: (p: number) => (price = p),
    candle: (high: number, low: number) => { now += MIN; candles.push({ start: now, high, low, close: (high + low) / 2 }); now += MIN; },
    now: () => now,
  };
}

async function usePaperExchange(ex: PaperExchange) {
  // Point the production singleton (used by CoinSwitchClient.call) at the test exchange.
  const prod = await paperExchange();
  Object.assign(prod, { store: (ex as unknown as { store: unknown }).store, market: (ex as unknown as { market: unknown }).market, now: (ex as unknown as { now: unknown }).now });
}

const plan: TradePlan = {
  action: "BUY", side: "BUY", entryType: "LIMIT", limitPrice: 99, entryPrice: 99, stopLoss: 97, takeProfit: 109,
  riskRewardRatio: 5, confidence: 0.7, reason: "paper e2e", expiryTime: new Date(Date.UTC(2026, 9, 1, 4)).toISOString(), symbol: "BTCUSDT",
};

describe("paper trading — full trade through the real executor", () => {
  it("places the entry on the paper exchange, fills it, protects it, and books the stop-out", async () => {
    const h = harness();
    await usePaperExchange(h.exchange);
    await h.store.saveWallet({ userId: 1, balance: 1000, initialBalance: 1000 });

    await runWithTradingMode("PAPER", async () => {
      const executor = new OrderExecutorService({ client: h.client, store: h.execStore, botState: { updateBotStatus: vi.fn(async () => {}), updateBotHeartbeat: vi.fn(async () => {}) } as never, statusPollAttempts: 1, statusPollIntervalMs: 1 });
      await executor.execute({ userId: 1, botId: 1, plan, quantity: 2, leverage: 5, allocatedCapital: 500, maxRiskAmount: 10 });
    });

    // Entry rests on the PAPER exchange at the planned limit with the bot's leverage.
    const [entry] = await h.store.listOrders(1);
    expect(entry).toMatchObject({ symbol: "BTCUSDT", side: "BUY", orderType: "LIMIT", price: 99, quantity: 2, leverage: 5, status: "OPEN" });

    // Price dips through 99 -> filled at 99 (maker).
    h.setPrice(99.5);
    h.candle(100, 98.8);
    await runWithTradingMode("PAPER", () => h.exchange.match(1));
    expect((await h.store.listPositions(1))[0]).toMatchObject({ side: "LONG", quantity: 2, entryPrice: 99 });

    // Real protective-order service places SL + TP on the paper exchange.
    const exec = { ...(h.execution as ExecutionRecord), entry: { orderId: entry.orderId, clientOrderId: entry.clientOrderId, status: "EXECUTED" }, filledQuantity: 2, avgEntryPrice: 99, quantity: 2, stopLoss: 97, takeProfit: 109, side: "BUY" as const, symbol: "BTCUSDT" };
    const protection = await runWithTradingMode("PAPER", () => new ProtectiveOrdersService(h.client, h.execStore).placeProtection(exec as ExecutionRecord, 2));
    const open = await h.store.listOrders(1, { status: "OPEN" });
    expect(open.map((o) => o.orderType).sort()).toEqual(["STOP_MARKET", "TAKE_PROFIT_MARKET"]);
    expect(open.find((o) => o.orderType === "STOP_MARKET")).toMatchObject({ triggerPrice: 97, reduceOnly: true, side: "SELL" });
    void protection;

    // Price falls through the stop.
    h.setPrice(96.5);
    h.candle(98.5, 96.5);
    const sl = open.find((o) => o.orderType === "STOP_MARKET")!;
    const tp = open.find((o) => o.orderType === "TAKE_PROFIT_MARKET")!;

    await runWithTradingMode("PAPER", async () => {
      // The monitor's close detection reads the order status through the real client.
      const closeInfo = await detectExecutedClose(h.client, 1, { stopLossOrderId: sl.orderId, takeProfitOrderId: tp.orderId });
      const slFill = 97 * (1 - TAKER_SLIPPAGE);
      expect(closeInfo?.reason).toBe("STOP_LOSS");
      expect(closeInfo?.price).toBeCloseTo(slFill, 6);
      expect(closeInfo?.realizedPnl).toBeCloseTo((slFill - 99) * 2, 6);

      // Close accounting reads commissions from the paper ledger through the real client.
      const position = { side: "BUY", filledQuantity: 2, quantity: 2, createdAt: new Date(Date.UTC(2026, 9, 1)).toISOString(), closedAt: null, symbol: "BTCUSDT" } as unknown as PositionRecord;
      const accounting = await reconcileClose(h.client, 1, position, 99, slFill);
      const fees = 99 * 2 * MAKER_FEE + slFill * 2 * TAKER_FEE;
      const gross = (slFill - 99) * 2;
      expect(accounting.grossProfit).toBeCloseTo(gross, 6);
      expect(accounting.commission).toBeCloseTo(fees, 6);
      expect(accounting.realizedPnl).toBeCloseTo(gross - fees, 6);

      // Paper wallet reflects exactly that, and the take-profit was cancelled.
      expect(await h.client.getWalletBalance(1)).toBeCloseTo(1000 + gross - fees, 6);
      expect((await h.client.getOrderStatus(1, tp.orderId)).status).toBe("CANCELLED");
      expect(await h.client.getPositions(1, "BTCUSDT")).toEqual([]);
    });
  });

  it("never sends anything to CoinSwitch while in PAPER mode", async () => {
    const h = harness();
    await usePaperExchange(h.exchange);
    const realFetch = globalThis.fetch;
    const fetchSpy = vi.fn(async () => { throw new Error("network used"); });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      await runWithTradingMode("PAPER", async () => {
        await h.client.setLeverage(1, "BTCUSDT", 5);
        await h.client.placeOrder(1, { symbol: "BTCUSDT", side: "BUY", orderType: "MARKET", quantity: 0.01, clientOrderId: crypto.randomUUID() });
        await h.client.getPositions(1);
        await h.client.getOpenOrders(1);
        await h.client.getWalletSnapshot(1);
        await h.client.getTransactions(1, { type: "commission" });
        await h.client.getClosedOrders(1, { symbol: "BTCUSDT" });
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
