import { describe, expect, it, vi } from "vitest";
import { BacktestService, clampToNow } from "./service";
import { BacktestingEngine } from "./engine";
import { BacktestError } from "./errors";
import type { BacktestStore, BacktestRecord } from "./store";
import type { BacktestConfig, BacktestProgress } from "./types";
import type { HistoricalMarketDataProvider } from "./data-provider";

/**
 * Production (Oct 29): "Run Backtest" loaded for ~60 s and failed with HTTP 504
 * from the web server. The backtest ran inside the request (far longer than the
 * proxy waits), the "To" date of today asked for candles that do not exist yet,
 * and that failure triggered a second full download. Backtests now start in the
 * background, never ask for the future, and an interrupted run is cleaned up.
 */
const H = 3_600_000;
const NOW = Date.UTC(2026, 9, 29, 14, 0, 0);

const config = (over: Partial<BacktestConfig> = {}): BacktestConfig => ({
  symbol: "BTCUSDT", timeframe: "1h", startTime: NOW - 90 * 24 * H, endTime: NOW - H, initialCapital: 100, capitalMode: "fixed",
  leverage: 5, maxRiskPerTrade: 5, dailyLossLimit: 30, enableTrailingStop: false, strategy: "TradenayaSmartV1", ...over,
});

describe("never ask for candles that don't exist yet", () => {
  it("an end of 'today 23:59' is cut to now", () => {
    expect(clampToNow(config({ endTime: NOW + 10 * H }), NOW).endTime).toBe(NOW);
  });
  it("a past end is left alone", () => {
    expect(clampToNow(config(), NOW).endTime).toBe(NOW - H);
  });
  it("a start in the future is a clear error", () => {
    expect(() => clampToNow(config({ startTime: NOW + H, endTime: NOW + 2 * H }), NOW)).toThrow(/start date must be in the past/);
  });
});

describe("missing price history: no second full download for a missing END", () => {
  const run = async (edge: "start" | "end") => {
    const getCandles = vi.fn(async () => {
      throw new BacktestError("no data", "DATA_UNAVAILABLE", edge);
    });
    const engine = new BacktestingEngine({ provider: { getCandles } as HistoricalMarketDataProvider, backtestId: 1 });
    await expect(engine.run(config())).rejects.toThrow("no data");
    return getCandles.mock.calls.length;
  };
  it("end missing → fails after ONE download", async () => expect(await run("end")).toBe(1));
  it("start missing (coin listed recently) → retries once without warm-up", async () => expect(await run("start")).toBe(2));
});

/** In-memory stand-in for the MySQL store. */
function memoryStore(opts: { slowProgressMs?: number } = {}) {
  const rows = new Map<number, BacktestRecord>();
  let nextId = 1;
  const record = (id: number) => rows.get(id)!;
  const store = {
    rows,
    create: vi.fn(async (input: { userId: number; symbol: string; timeframe: string; startTime: number; endTime: number; initialCapital: number }) => {
      const id = nextId++;
      rows.set(id, {
        id, userId: input.userId, botId: null, symbol: input.symbol, timeframe: input.timeframe, startTime: input.startTime, endTime: input.endTime,
        initialCapital: input.initialCapital, config: null, status: "QUEUED", progress: null, executionPolicy: null, slippageApplied: false,
        metrics: null, equityCurve: [], errorMessage: null, createdAt: new Date().toISOString(), completedAt: null,
      } as BacktestRecord);
      return id;
    }),
    updateStatus: vi.fn(async (id: number, status: BacktestRecord["status"], o: { progress?: BacktestProgress | null; errorMessage?: string | null } = {}) => {
      if (status === "RUNNING" && o.progress && opts.slowProgressMs) await new Promise((r) => setTimeout(r, opts.slowProgressMs));
      Object.assign(record(id), { status, progress: o.progress ?? null, errorMessage: o.errorMessage ?? null });
    }),
    saveResult: vi.fn(async (id: number) => {
      Object.assign(record(id), { status: "COMPLETED", progress: null, metrics: { totalReturnPct: 1, tradeCount: 2 } });
    }),
    insertTrades: vi.fn(async () => {}),
    get: vi.fn(async (_u: number, id: number) => (rows.has(id) ? { ...record(id) } : null)),
    list: vi.fn(async () => [...rows.values()].map((r) => ({ ...r }))),
    countActive: vi.fn(async () => [...rows.values()].filter((r) => r.status === "RUNNING" || r.status === "QUEUED").length),
    activeIds: vi.fn(async () => [...rows.values()].filter((r) => r.status === "RUNNING" || r.status === "QUEUED").map((r) => r.id)),
  };
  return store;
}

function deferredEngine() {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  let progress!: (p: BacktestProgress) => void;
  const done = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  const result = { metrics: {}, equityCurve: [], executionPolicy: "CONSERVATIVE", slippageApplied: false, completedAt: new Date().toISOString(), trades: [] };
  const factory = ({ onProgress }: { onProgress: (p: BacktestProgress) => void }) => {
    progress = onProgress;
    return { run: async () => { await done; return result as never; } };
  };
  return { factory, finish: () => resolve(), fail: (m: string) => reject(new Error(m)), progress: (pct: number) => progress({ percentage: pct } as BacktestProgress) };
}

const flush = () => new Promise((r) => setTimeout(r, 30));

describe("backtests run in the background", () => {
  it("starting returns at once (RUNNING); the result is saved when it finishes", async () => {
    const store = memoryStore();
    const engine = deferredEngine();
    const service = new BacktestService({ store: store as unknown as BacktestStore, engineFactory: engine.factory, providerFactory: () => ({}) as never });
    const started = await service.start(1, config());
    expect(started.status).toBe("RUNNING");
    engine.finish();
    await flush();
    expect(store.rows.get(started.id)!.status).toBe("COMPLETED");
  });

  it("a failure is recorded on the backtest (shown in the list), not thrown at the page", async () => {
    const store = memoryStore();
    const engine = deferredEngine();
    const service = new BacktestService({ store: store as unknown as BacktestStore, engineFactory: engine.factory, providerFactory: () => ({}) as never });
    const started = await service.start(1, config());
    engine.fail("Historical data for BTCUSDT does not reach the requested end time");
    await flush();
    expect(store.rows.get(started.id)!.status).toBe("FAILED");
    expect(store.rows.get(started.id)!.errorMessage).toMatch(/does not reach/);
  });

  it("a slow progress write can never turn a finished backtest back into RUNNING", async () => {
    const store = memoryStore({ slowProgressMs: 20 });
    const engine = deferredEngine();
    const service = new BacktestService({ store: store as unknown as BacktestStore, engineFactory: engine.factory, providerFactory: () => ({}) as never });
    const started = await service.start(1, config());
    engine.progress(100);
    engine.finish();
    await new Promise((r) => setTimeout(r, 80));
    expect(store.rows.get(started.id)!.status).toBe("COMPLETED");
  });

  it("a run cut off by a server restart is marked stopped — and no longer blocks new backtests", async () => {
    const store = memoryStore();
    const engine = deferredEngine();
    const service = new BacktestService({ store: store as unknown as BacktestStore, engineFactory: engine.factory, providerFactory: () => ({}) as never });
    // two rows left RUNNING by the previous server process
    for (const id of [await store.create({ userId: 1, symbol: "BTCUSDT", timeframe: "1h", startTime: 1, endTime: 2, initialCapital: 100 }), await store.create({ userId: 1, symbol: "ETHUSDT", timeframe: "1h", startTime: 1, endTime: 2, initialCapital: 100 })]) {
      store.rows.get(id)!.status = "RUNNING";
    }
    const started = await service.start(1, config()); // used to fail: "You already have 2 backtests in progress"
    const others = [...store.rows.values()].filter((r) => r.id !== started.id);
    expect(others.every((r) => r.status === "FAILED" && /server restarted/.test(r.errorMessage ?? ""))).toBe(true);
    // ... while the live job in this process is left alone
    await service.list(1);
    expect(store.rows.get(started.id)!.status).toBe("RUNNING");
    engine.finish();
    await flush();
  });

  it("the list shows progress while running", async () => {
    const store = memoryStore();
    const engine = deferredEngine();
    const service = new BacktestService({ store: store as unknown as BacktestStore, engineFactory: engine.factory, providerFactory: () => ({}) as never });
    const started = await service.start(1, config());
    engine.progress(40);
    await flush();
    const row = (await service.list(1)).find((b) => b.id === started.id)!;
    expect(row.progressPct).toBe(40);
    engine.finish();
    await flush();
  });
});
