import { describe, expect, it } from "vitest";
import { FUNDING_INTERVAL_MS, LIMIT_TRADE_THROUGH, MAKER_FEE, PaperExchange, TAKER_FEE, TAKER_SLIPPAGE, liquidationPrice, type Candle1m, type PaperMarket } from "./exchange";
import { MemoryPaperStore } from "./store";
import { runWithTradingMode, currentTradingMode } from "./mode";
import { CoinSwitchClient } from "@/automation/executor/client";

const T0 = Date.UTC(2026, 9, 1, 0, 0);
const MIN = 60_000;

/** Controllable market: a live price + 1m candles. */
function setup(startBalance?: number) {
  let now = T0;
  let price = 100;
  const candles: Candle1m[] = [];
  const market: PaperMarket = {
    price: async () => price,
    candles: async (_u, _s, since) => candles.filter((c) => c.start >= since),
  };
  const store = new MemoryPaperStore();
  const ex = new PaperExchange(store, market, () => now);
  if (startBalance != null) void store.saveWallet({ userId: 1, balance: startBalance, initialBalance: startBalance });
  return {
    ex,
    store,
    setPrice: (p: number) => (price = p),
    advance: (ms: number) => (now += ms),
    candle: (high: number, low: number, close = (high + low) / 2) => {
      candles.push({ start: now, high, low, close });
      now += MIN;
    },
    call: (method: "GET" | "POST" | "DELETE", endpoint: string, params: Record<string, unknown> = {}) => ex.handle(method, endpoint, params, 1),
  };
}

// JSON.parse's return type keeps the test assertions concise without `any`.
const body = (r: Awaited<ReturnType<PaperExchange["handle"]>>): ReturnType<typeof JSON.parse> => (r!.body as { data: unknown }).data;

describe("paper exchange — wallet", () => {
  it("starts every user with a 100 USDT paper wallet in the CoinSwitch wallet shape", async () => {
    const { call } = setup();
    const data = body(await call("GET", "/futures/wallet_balance"));
    expect(data.base_asset_balances[0]).toMatchObject({ base_asset: "USDT", balances: { total_balance: "100", total_available_balance: "100" } });
  });

  it("can be reset to any amount, but not while trades are open", async () => {
    const { ex, call } = setup();
    expect((await ex.resetWallet(1, 250)).balance).toBe(250);
    await call("POST", "/futures/leverage", { symbol: "btcusdt", leverage: 5 });
    await call("POST", "/futures/order", { symbol: "btcusdt", side: "BUY", order_type: "LIMIT", quantity: 1, price: 90 });
    await expect(ex.resetWallet(1, 50)).rejects.toThrow(/Close your open paper positions/);
  });

  it("rejects orders that need more margin than the paper wallet has", async () => {
    const { call } = setup(10);
    await call("POST", "/futures/leverage", { symbol: "btcusdt", leverage: 2 });
    const r = await call("POST", "/futures/order", { symbol: "btcusdt", side: "BUY", order_type: "LIMIT", quantity: 1, price: 99 });
    expect(r!.status).toBe(400);
    expect((r!.body as { message: string }).message).toMatch(/Insufficient balance/);
  });
});

describe("paper exchange — fills against market data", () => {
  it("fills a resting limit only on a candle that starts after the order (no look-ahead), at the limit, maker fee", async () => {
    const { call, candle } = setup(1000);
    await call("POST", "/futures/leverage", { symbol: "btcusdt", leverage: 5 });
    const placed = body(await call("POST", "/futures/order", { symbol: "btcusdt", side: "BUY", order_type: "LIMIT", quantity: 2, price: 95, client_order_id: "c-1" }));
    expect(placed.status).toBe("OPEN");

    candle(101, 96); // never reaches 95
    expect(body(await call("GET", "/futures/order", { order_id: placed.order_id })).order.status).toBe("OPEN");

    candle(99, 94.5); // trades through 95
    const filled = body(await call("GET", "/futures/order", { order_id: "c-1" })).order;
    expect(filled).toMatchObject({ status: "EXECUTED", exec_quantity: 2, avg_execution_price: 95 });
    expect(filled.execution_fee).toBeCloseTo(95 * 2 * MAKER_FEE, 8);

    const [pos] = body(await call("GET", "/futures/positions", { symbol: "btcusdt" }));
    expect(pos).toMatchObject({ position_side: "LONG", position_size: 2, avg_entry_price: 95, leverage: 5 });
    expect(pos.liquidation_price).toBeCloseTo(liquidationPrice("LONG", 95, 5), 6);
  });

  it("closes on the stop-loss, books the loss + fees, and cancels the take-profit", async () => {
    const { call, candle, setPrice } = setup(1000);
    await call("POST", "/futures/leverage", { symbol: "btcusdt", leverage: 5 });
    await call("POST", "/futures/order", { symbol: "btcusdt", side: "BUY", order_type: "MARKET", quantity: 1 }); // fills at 100
    const sl = body(await call("POST", "/futures/order", { symbol: "btcusdt", side: "SELL", order_type: "STOP_MARKET", quantity: 1, trigger_price: 97, reduce_only: true }));
    const tp = body(await call("POST", "/futures/order", { symbol: "btcusdt", side: "SELL", order_type: "TAKE_PROFIT_MARKET", quantity: 1, trigger_price: 110, reduce_only: true }));

    setPrice(96);
    candle(100, 96.5);
    candle(98, 96); // hits 97

    const entryFill = 100 * (1 + TAKER_SLIPPAGE); // market entry slips up
    const slFill = 97 * (1 - TAKER_SLIPPAGE); // stop sells slip down
    const slStatus = body(await call("GET", "/futures/order", { order_id: sl.order_id })).order;
    expect(slStatus.status).toBe("EXECUTED");
    expect(slStatus.avg_execution_price).toBeCloseTo(slFill, 6);
    expect(slStatus.realised_pnl).toBeCloseTo(slFill - entryFill, 5);
    expect(body(await call("GET", "/futures/order", { order_id: tp.order_id })).order.status).toBe("CANCELLED");
    expect(body(await call("GET", "/futures/positions"))).toEqual([]);

    const fees = entryFill * TAKER_FEE + slFill * TAKER_FEE;
    const wallet = body(await call("GET", "/futures/wallet_balance")).base_asset_balances[0].balances;
    expect(Number(wallet.total_balance)).toBeCloseTo(1000 + (slFill - entryFill) - fees, 6);

    // Ledger + closed-order history in the shapes the close accounting reads.
    const tx = body(await call("GET", "/futures/transactions", { symbol: "btcusdt", type: "COMMISSION" }));
    expect(tx.reduce((s: number, t: { amount: number }) => s + t.amount, 0)).toBeCloseTo(-fees, 6);
    const closed = body(await call("POST", "/futures/orders/closed", { symbol: "btcusdt" })).orders;
    expect(closed.find((o: { order_id: string }) => o.order_id === sl.order_id)).toMatchObject({ reduce_only: true, status: "EXECUTED" });
  });

  it("takes profit when the target is reached first", async () => {
    const { call, candle, setPrice } = setup(1000);
    await call("POST", "/futures/order", { symbol: "ethusdt", side: "SELL", order_type: "MARKET", quantity: 1 }); // short @100
    await call("POST", "/futures/order", { symbol: "ethusdt", side: "BUY", order_type: "STOP_MARKET", quantity: 1, trigger_price: 105, reduce_only: true });
    const tp = body(await call("POST", "/futures/order", { symbol: "ethusdt", side: "BUY", order_type: "TAKE_PROFIT_MARKET", quantity: 1, trigger_price: 90, reduce_only: true }));
    setPrice(89);
    candle(101, 89);
    const tpOrder = body(await call("GET", "/futures/order", { order_id: tp.order_id })).order;
    expect(tpOrder.status).toBe("EXECUTED");
    expect(tpOrder.realised_pnl).toBeCloseTo(100 * (1 - TAKER_SLIPPAGE) - 90 * (1 + TAKER_SLIPPAGE), 6);
  });

  it("assumes the stop first when a candle reaches both stop and target", async () => {
    const { call, candle, setPrice } = setup(1000);
    await call("POST", "/futures/order", { symbol: "solusdt", side: "BUY", order_type: "MARKET", quantity: 1 });
    const sl = body(await call("POST", "/futures/order", { symbol: "solusdt", side: "SELL", order_type: "STOP_MARKET", quantity: 1, trigger_price: 95, reduce_only: true }));
    await call("POST", "/futures/order", { symbol: "solusdt", side: "SELL", order_type: "TAKE_PROFIT_MARKET", quantity: 1, trigger_price: 105, reduce_only: true });
    setPrice(100);
    candle(106, 94);
    expect(body(await call("GET", "/futures/order", { order_id: sl.order_id })).order.status).toBe("EXECUTED");
  });

  it("liquidates the whole margin if price reaches liquidation before any stop", async () => {
    const { call, candle, setPrice } = setup(1000);
    await call("POST", "/futures/leverage", { symbol: "dogeusdt", leverage: 10 });
    await call("POST", "/futures/order", { symbol: "dogeusdt", side: "BUY", order_type: "MARKET", quantity: 10 }); // margin 100
    setPrice(85);
    candle(100, 85); // liq ~90.5
    expect(body(await call("GET", "/futures/positions"))).toEqual([]);
    const wallet = body(await call("GET", "/futures/wallet_balance")).base_asset_balances[0].balances;
    const entry = 100 * (1 + TAKER_SLIPPAGE);
    expect(Number(wallet.total_balance)).toBeCloseTo(1000 - entry - entry * 10 * TAKER_FEE, 6); // margin = entry*10/10
  });

  it("rejects a stop that would trigger immediately (like the exchange)", async () => {
    const { call } = setup(1000);
    await call("POST", "/futures/order", { symbol: "btcusdt", side: "BUY", order_type: "MARKET", quantity: 1 });
    const r = await call("POST", "/futures/order", { symbol: "btcusdt", side: "SELL", order_type: "STOP_MARKET", quantity: 1, trigger_price: 101, reduce_only: true });
    expect(r!.status).toBe(400);
  });

  it("does NOT fill a limit that price only touched (needs a trade-through)", async () => {
    const { call, candle } = setup(1000);
    const o = body(await call("POST", "/futures/order", { symbol: "btcusdt", side: "BUY", order_type: "LIMIT", quantity: 1, price: 95 }));
    candle(100, 95); // touched exactly
    expect(body(await call("GET", "/futures/order", { order_id: o.order_id })).order.status).toBe("OPEN");
    candle(100, 95 * (1 - LIMIT_TRADE_THROUGH) - 0.001); // traded through
    expect(body(await call("GET", "/futures/order", { order_id: o.order_id })).order.status).toBe("EXECUTED");
  });

  it("fills a stop that price gapped through at the worse price, not the stop", async () => {
    const { call, candle, setPrice } = setup(1000);
    await call("POST", "/futures/order", { symbol: "btcusdt", side: "BUY", order_type: "MARKET", quantity: 1 });
    const sl = body(await call("POST", "/futures/order", { symbol: "btcusdt", side: "SELL", order_type: "STOP_MARKET", quantity: 1, trigger_price: 97, reduce_only: true }));
    setPrice(90);
    candle(92, 90); // whole candle below the stop
    const o = body(await call("GET", "/futures/order", { order_id: sl.order_id })).order;
    expect(o.avg_execution_price).toBeCloseTo(92 * (1 - TAKER_SLIPPAGE), 6);
  });

  it("charges funding every 8h at the live rate (longs pay, shorts receive), once per settlement", async () => {
    let now = Date.UTC(2026, 9, 1, 7, 0);
    const store = new MemoryPaperStore();
    const ex = new PaperExchange(store, { price: async () => 100, candles: async () => [], funding: async () => ({ rate: 0.0001, nextFundingTime: null }) }, () => now);
    await store.saveWallet({ userId: 1, balance: 1000, initialBalance: 1000 });
    await ex.handle("POST", "/futures/order", { symbol: "btcusdt", side: "BUY", order_type: "MARKET", quantity: 5 }, 1);
    const afterEntry = (await store.getWallet(1))!.balance;
    now += 2 * 60 * 60_000; // 09:00 -> crossed the 08:00 settlement
    await ex.match(1);
    await ex.match(1); // repeated reads must not charge twice
    const funding = store.transactions.filter((t) => t.type === "FUNDING_FEE");
    expect(funding).toHaveLength(1);
    expect(funding[0].createdAt).toBe(Date.UTC(2026, 9, 1, 8, 0));
    expect(funding[0].amount).toBeCloseTo(-0.0001 * 100 * 5, 8);
    expect((await store.getWallet(1))!.balance).toBeCloseTo(afterEntry - 0.05, 8);
    now += FUNDING_INTERVAL_MS; // next settlement at 16:00
    await ex.match(1);
    expect(store.transactions.filter((t) => t.type === "FUNDING_FEE")).toHaveLength(2);
  });

  it("leaves market-data endpoints to the real exchange", async () => {
    const { call } = setup();
    expect(await call("GET", "/futures/klines", { symbol: "btcusdt" })).toBeNull();
    expect(await call("GET", "/futures/instrument_info")).toBeNull();
  });
});

describe("trading mode routing", () => {
  it("only PAPER context work reaches the paper exchange", async () => {
    expect(currentTradingMode()).toBe("LIVE");
    await runWithTradingMode("PAPER", async () => {
      await Promise.resolve();
      expect(currentTradingMode()).toBe("PAPER");
    });
    expect(currentTradingMode()).toBe("LIVE");
  });

  it("CoinSwitchClient answers paper account calls without touching CoinSwitch", async () => {
    const realFetch = globalThis.fetch;
    let fetched = 0;
    globalThis.fetch = (async () => { fetched++; throw new Error("network must not be used"); }) as typeof fetch;
    try {
      const { paperExchange } = await import("./exchange");
      const ex = await paperExchange();
      (ex as unknown as { store: MemoryPaperStore }).store = new MemoryPaperStore();
      const balance = await runWithTradingMode("PAPER", () => new CoinSwitchClient().getWalletBalance(7));
      expect(balance).toBe(100);
      expect(fetched).toBe(0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("request trading mode", () => {
  it("applies the header mode to the rest of one request only", async () => {
    const { enterRequestTradingMode } = await import("./mode");
    const req = (mode?: string) => ({ headers: { get: (n: string) => (n === "x-trading-mode" ? mode ?? null : null) }, url: "http://x/api" });
    async function handler(mode?: string) {
      enterRequestTradingMode(req(mode)); // what getCustomerFromRequest does
      await new Promise((r) => setTimeout(r, 5));
      return currentTradingMode();
    }
    const [a, b, c] = await Promise.all([handler("PAPER"), handler(), handler("paper")]);
    expect([a, b, c]).toEqual(["PAPER", "LIVE", "PAPER"]);
  });

  it("background loops started from a paper request still run LIVE", async () => {
    const { enterRequestTradingMode } = await import("./mode");
    let seen: string | null = null;
    await (async () => {
      enterRequestTradingMode({ headers: { get: () => "PAPER" } });
      // what BotScheduler/PositionMonitor.start() do before creating timers
      await runWithTradingMode("LIVE", async () => {
        await new Promise<void>((resolve) => setTimeout(() => { seen = currentTradingMode(); resolve(); }, 5));
      });
    })();
    expect(seen).toBe("LIVE");
  });
});
