import { describe, it, expect } from "vitest";
import {
  parseTickerRow,
  parseTickerPayload,
  parseCandleMessage,
  parseCandleRow,
  validateSnapshot,
} from "./validator";
import type { WsCandleMessage, WsTickerMessage } from "./types";

describe("parseTickerRow", () => {
  it("normalizes the symbol and parses prices", () => {
    const ticker = parseTickerRow(
      { s: "doge/usdt", c: "0.12", b: "0.119", a: "0.121", h: "0.13", l: "0.11", bv: "100", qv: "2000", P: "-2.5" },
      "rest",
      1000,
    );
    expect(ticker).not.toBeNull();
    expect(ticker!.symbol).toBe("DOGEUSDT");
    expect(ticker!.lastPrice).toBe(0.12);
    expect(ticker!.bidPrice).toBe(0.119);
    expect(ticker!.askPrice).toBe(0.121);
    expect(ticker!.high24h).toBe(0.13);
    expect(ticker!.low24h).toBe(0.11);
    expect(ticker!.volume24h).toBe(100);
    expect(ticker!.source).toBe("rest");
    expect(ticker!.receivedAt).toBe(1000);
  });

  it("rejects rows with no symbol", () => {
    expect(parseTickerRow({ c: "1" })).toBeNull();
  });

  it("rejects non-positive prices", () => {
    expect(parseTickerRow({ s: "BTCUSDT", c: "0" })).toBeNull();
    expect(parseTickerRow({ s: "BTCUSDT", c: "-1" })).toBeNull();
    expect(parseTickerRow({ s: "BTCUSDT", c: "abc" })).toBeNull();
  });

  it("rejects high < low", () => {
    expect(parseTickerRow({ s: "BTCUSDT", c: "100", h: "90", l: "110" })).toBeNull();
  });

  it("tolerates missing optional fields", () => {
    const ticker = parseTickerRow({ s: "BTCUSDT", c: "100" });
    expect(ticker).not.toBeNull();
    expect(ticker!.bidPrice).toBe(0);
  });
});

describe("parseTickerPayload", () => {
  it("parses a map keyed by symbol", () => {
    const payload: Record<string, WsTickerMessage> = {
      BTCUSDT: { s: "BTCUSDT", e: "", E: 0, o: "", h: "", l: "", c: "100", bv: "", qv: "", P: "", b: "", a: "", T: 0, p: 0, i: 0, r: 0, oi: "", oiv: "", bs: "", as: "" },
      ETHUSDT: { s: "ETHUSDT", e: "", E: 0, o: "", h: "", l: "", c: "200", bv: "", qv: "", P: "", b: "", a: "", T: 0, p: 0, i: 0, r: 0, oi: "", oiv: "", bs: "", as: "" },
    };
    const tickers = parseTickerPayload(payload, 42);
    expect(tickers).toHaveLength(2);
    expect(tickers.map((t) => t.symbol).sort()).toEqual(["BTCUSDT", "ETHUSDT"]);
  });

  it("parses a single ticker object", () => {
    const tickers = parseTickerPayload({ s: "BTCUSDT", c: "100" }, 7);
    expect(tickers).toHaveLength(1);
    expect(tickers[0].symbol).toBe("BTCUSDT");
  });

  it("returns empty for garbage and rejects invalid members of a map", () => {
    expect(parseTickerPayload(null)).toEqual([]);
    expect(parseTickerPayload("nope")).toEqual([]);
    const tickers = parseTickerPayload({ GOOD: { s: "BTCUSDT", c: "100" }, BAD: { s: "ETHUSDT", c: "0" } });
    expect(tickers).toHaveLength(1);
    expect(tickers[0].symbol).toBe("BTCUSDT");
  });
});

describe("parseCandleMessage", () => {
  const base: WsCandleMessage = {
    o: "100", h: "110", l: "95", c: "105", v: "50", q: "5000",
    s: "BTCUSDT", i: "5", x: false, t: 1000, T: 1300, ts: 1200,
  };

  it("parses a valid candle", () => {
    const candle = parseCandleMessage(base);
    expect(candle).not.toBeNull();
    expect(candle!.open).toBe(100);
    expect(candle!.high).toBe(110);
    expect(candle!.low).toBe(95);
    expect(candle!.close).toBe(105);
    expect(candle!.volume).toBe(50);
    expect(candle!.timeframe).toBe("5");
  });

  it("rejects close outside high/low", () => {
    expect(parseCandleMessage({ ...base, c: "115" })).toBeNull();
  });

  it("rejects high < low", () => {
    expect(parseCandleMessage({ ...base, h: "90", l: "110" })).toBeNull();
  });

  it("rejects non-positive prices", () => {
    expect(parseCandleMessage({ ...base, o: "0" })).toBeNull();
  });

  it("rejects negative volume", () => {
    expect(parseCandleMessage({ ...base, v: "-1" })).toBeNull();
  });
});

describe("parseCandleRow", () => {
  it("parses an array row [t,o,h,l,c,v]", () => {
    const candle = parseCandleRow([1000, "100", "110", "95", "105", "50"], "5");
    expect(candle).not.toBeNull();
    expect(candle!.timestamp).toBe(1000);
    expect(candle!.close).toBe(105);
    expect(candle!.timeframe).toBe("5");
  });

  it("parses an object row", () => {
    const candle = parseCandleRow({ start_time: 2000, o: "1", h: "2", l: "0.5", c: "1.5", v: "10" }, "5");
    expect(candle!.timestamp).toBe(2000);
    expect(candle!.close).toBe(1.5);
  });

  it("rejects garbage rows", () => {
    expect(parseCandleRow(null)).toBeNull();
    expect(parseCandleRow([])).toBeNull();
    expect(parseCandleRow([1, 2, 3, 4])).toBeNull();
  });
});

describe("validateSnapshot", () => {
  it("accepts a valid snapshot", () => {
    const snapshot = {
      symbol: "BTCUSDT", exchange: "EXCHANGE_2", timestamp: Date.now(),
      price: 100, bid: 99, ask: 101, volume: 0, candles: {},
    };
    expect(validateSnapshot(snapshot)).toBe(true);
  });

  it("rejects non-positive price and bid > ask", () => {
    const base = { symbol: "BTCUSDT", exchange: "EXCHANGE_2", timestamp: Date.now(), price: 100, bid: 99, ask: 101, volume: 0, candles: {} };
    expect(validateSnapshot({ ...base, price: 0 })).toBe(false);
    expect(validateSnapshot({ ...base, bid: 102, ask: 101 })).toBe(false);
    expect(validateSnapshot({ ...base, symbol: "" })).toBe(false);
  });
});
