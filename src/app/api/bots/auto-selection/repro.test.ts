import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MarketSnapshot } from "@/automation/types";

const INTERVAL_MS = 60 * 60_000;

function buildCandles(count: number, drift: number): MarketSnapshot["candles"]["x"] {
  const candles: unknown[] = [];
  let price = 100;
  for (let i = 0; i < count; i += 1) {
    const open = price;
    const close = open * (1 + drift + (Math.sin(i / 7) * 0.0008));
    candles.push({
      timestamp: 1_700_000_000_000 + i * INTERVAL_MS,
      open,
      high: Math.max(open, close) * 1.0004,
      low: Math.min(open, close) * 0.9996,
      close,
      volume: 5000 * (1 + (i % 5) * 0.1),
      timeframe: "60",
    });
    price = close;
  }
  return candles as MarketSnapshot["candles"]["x"];
}

const mocks = vi.hoisted(() => {
  const states = {
    tickerPayload: null as unknown,
    keys: { apiKey: "k", apiSecret: "s", status: "A" },
    snapshotFor: (_symbol: string, timeframe: string): MarketSnapshot => ({
      symbol: "X",
      exchange: "EXCHANGE_2",
      timestamp: Date.now(),
      price: 100,
      bid: 100,
      ask: 100,
      volume: 0,
      candles: { [String(60)]: buildCandles(320, 0.0018) },
      isFresh: "FRESH",
    }),
  };
  return states;
});

vi.mock("@/lib/coinswitch", () => ({
  coinSwitchRequest: vi.fn(async () => mocks.tickerPayload),
}));

vi.mock("@/lib/coinswitch.store", () => ({
  getKeysForUser: vi.fn(async () => mocks.keys),
}));

vi.mock("@/automation/executor/client", () => ({
  coinswitchClient: { getInstrumentInfo: vi.fn(async () => null) },
}));

vi.mock("@/automation/market/service", () => ({
  serverMarketDataService: {
    adapterFor: () => ({
      getSnapshot: (symbol: string, timeframe: string) => mocks.snapshotFor(symbol, timeframe),
    }),
  },
}));

vi.mock("@/app/api/bots/_helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/api/bots/_helpers")>();
  return { ...actual, requireUserId: () => 1 };
});

import { GET } from "./route";

async function run(query: string) {
  const res = await GET({ url: `http://localhost/api/bots/auto-selection?${query}` } as never);
  const body = await res.json();
  return { status: res.status, body };
}

const DOC_TICKER = {
  data: {
    BTCUSDT: { last_price: "100", price_24h_pcnt: "1.2", quote_asset_volume_24h: "5000000000", funding_rate: "0.0001" },
    ETHUSDT: { last_price: "50", price_24h_pcnt: "-0.5", quote_asset_volume_24h: "2000000000", funding_rate: "0.0002" },
    DOTUSDT: { last_price: "8", price_24h_pcnt: "0.2", quote_asset_volume_24h: "300000000", funding_rate: "0.00001" },
  },
};

describe("repro /api/bots/auto-selection", () => {
  beforeEach(() => {
    mocks.keys = { apiKey: "k", apiSecret: "s", status: "A" };
    mocks.tickerPayload = DOC_TICKER;
  });

  it("happy path: documented ticker shape + fresh candles", async () => {
    const query =
      "timeframe=1h&leverageMode=auto&leveragePercent=50&capital=100&maxRiskPerTrade=20&config=" +
      encodeURIComponent(
        JSON.stringify({
          timeframe: "1h",
          leverage: 5,
          leverageMode: "auto",
          capital: 100,
          capitalMode: "fixed",
          maxRiskPerTrade: 20,
          dailyLossLimit: 5,
          enableTrailingStop: false,
        }),
      );
    const { status, body } = await run(query);
    console.log("HAPPY STATUS", status, "SUCCESS", body.success, "BEST", body.data?.best?.symbol, "MSG", body.message);
    expect.soft(status).toBe(200);
    expect.soft(body.success).toBe(true);
  });

  it("ticker.data as an ARRAY (deviation from docs)", async () => {
    mocks.tickerPayload = {
      data: [
        { symbol: "BTCUSDT", last_price: "100", quote_asset_volume_24h: "5000000000" },
        { symbol: "ETHUSDT", last_price: "50", quote_asset_volume_24h: "2000000000" },
      ],
    };
    const query = "timeframe=1h&config=" + encodeURIComponent(JSON.stringify({ timeframe: "1h", leverageMode: "auto", capital: 100, capitalMode: "fixed", maxRiskPerTrade: 20, dailyLossLimit: 5, enableTrailingStop: false }));
    const { status, body } = await run(query);
    console.log("ARRAY STATUS", status, "SUCCESS", body.success, "BEST", body.data?.best ?? null, "MSG", body.message);
    expect.soft(status).toBe(200);
  });

  it("ticker.data missing quote volume per symbol", async () => {
    mocks.tickerPayload = { data: { BTCUSDT: { last_price: "100" }, ETHUSDT: { last_price: "50" } } };
    const query = "timeframe=1h&config=" + encodeURIComponent(JSON.stringify({ timeframe: "1h", leverageMode: "auto", capital: 100, capitalMode: "fixed", maxRiskPerTrade: 20, dailyLossLimit: 5, enableTrailingStop: false }));
    const { status, body } = await run(query);
    console.log("NOQQ STATUS", status, "SUCCESS", body.success, "BEST", body.data?.best ?? null, "MSG", body.message);
    expect.soft(status).toBe(200);
  });

  it("malformed ticker row without symbol property should not crash the selector", async () => {
    mocks.tickerPayload = {
      data: [
        { last_price: "100", quote_asset_volume_24h: "5000000000" },
        { symbol: "ETHUSDT", last_price: "50", quote_asset_volume_24h: "2000000000" },
        { symbol: "DOGEUSDT", last_price: "0.2", quote_asset_volume_24h: "1000000" },
      ],
    };
    const query = "timeframe=1h&config=" + encodeURIComponent(JSON.stringify({ timeframe: "1h", leverageMode: "auto", capital: 100, capitalMode: "fixed", maxRiskPerTrade: 20, dailyLossLimit: 5, enableTrailingStop: false }));
    const { status, body } = await run(query);
    console.log("MALFORMED STATUS", status, "SUCCESS", body.success, "BEST", body.data?.best ?? null, "MSG", body.message);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("returns a controlled 504 when auto-selection exceeds the route timeout", async () => {
    const originalTimeout = process.env.AUTO_SELECTION_TIMEOUT_MS;
    process.env.AUTO_SELECTION_TIMEOUT_MS = "50";

    const selectSpy = vi.spyOn((await import("@/automation/coinauto/coin-auto-selector")).CoinAutoSelector.prototype, "selectBestOpportunity");
    selectSpy.mockImplementation(async () => {
      await new Promise(() => undefined);
      return null;
    });

    try {
      const { status, body } = await run("timeframe=1h&config=" + encodeURIComponent(JSON.stringify({ timeframe: "1h", leverageMode: "auto", capital: 100, capitalMode: "fixed", maxRiskPerTrade: 20, dailyLossLimit: 5, enableTrailingStop: false })));
      console.log("TIMEOUT STATUS", status, "SUCCESS", body.success, "MSG", body.message);
      expect(status).toBe(504);
      expect(body.success).toBe(false);
      expect(body.message).toContain("timed out");
    } finally {
      if (originalTimeout === undefined) delete process.env.AUTO_SELECTION_TIMEOUT_MS;
      else process.env.AUTO_SELECTION_TIMEOUT_MS = originalTimeout;
      selectSpy.mockRestore();
    }
  });

  it("cookies not needed when user is authenticated (healthy)", async () => {
    const { status, body } = await run("timeframe=1h&config=" + encodeURIComponent(JSON.stringify({ timeframe: "1h", leverageMode: "auto", capital: 100, capitalMode: "fixed", maxRiskPerTrade: 20, dailyLossLimit: 5, enableTrailingStop: false })));
    console.log("OK STATUS", status, "SUCCESS", body.success);
    expect(status).toBe(200);
  });
});