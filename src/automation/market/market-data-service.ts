import type { CoinSwitchClient } from "@/automation/executor/client";
import type { MarketCandle, MarketSnapshot } from "@/automation/types";

export interface MarketDataService {
  getSnapshot(symbol: string, timeframe: string): Promise<MarketSnapshot>;
}

export interface MarketDataServerSource {
  client: CoinSwitchClient;
  userId: number;
}

export class CoinSwitchMarketDataService implements MarketDataService {
  private readonly baseUrl = "/api/coinswitch/futures";

  constructor(private readonly server?: MarketDataServerSource) {}

  async getSnapshot(symbol: string, timeframe: string): Promise<MarketSnapshot> {
    const candleJson = this.server ? await this.fetchServerCandles(symbol, timeframe) : await this.fetchBrowserCandles(symbol, timeframe);

    const candles = Array.isArray(candleJson?.data)
      ? candleJson.data.map((item: unknown[]): MarketCandle => ({
          timestamp: Number(item[0]) || Date.now(),
          open: Number(item[1]) || 0,
          high: Number(item[2]) || 0,
          low: Number(item[3]) || 0,
          close: Number(item[4]) || 0,
          volume: Number(item[5]) || 0,
          timeframe,
        }))
      : [];

    const tickerJson = this.server ? await this.fetchServerTicker(symbol) : await this.fetchBrowserTicker(symbol);
    const ticker = (tickerJson?.data ?? tickerJson) as Record<string, unknown>;

    return {
      symbol,
      exchange: "EXCHANGE_2",
      timestamp: Date.now(),
      price: Number(ticker?.c ?? ticker?.last ?? 0),
      bid: Number(ticker?.b ?? ticker?.bid ?? 0),
      ask: Number(ticker?.a ?? ticker?.ask ?? 0),
      volume: Number(ticker?.v ?? ticker?.volume ?? 0),
      candles: {
        [timeframe]: candles,
      },
    };
  }

  private async fetchServerCandles(symbol: string, timeframe: string): Promise<{ data: unknown }> {
    const rows = await this.server!.client.getKline(this.server!.userId, symbol, timeframe);
    return { data: rows };
  }

  private async fetchServerTicker(symbol: string): Promise<{ data: unknown }> {
    const price = await this.server!.client.getCurrentPrice(this.server!.userId, symbol);
    return { data: { c: price, last: price, b: price, a: price } };
  }

  private async fetchBrowserCandles(symbol: string, timeframe: string): Promise<{ data: unknown }> {
    const res = await fetch(`${this.baseUrl}/kline?symbol=${encodeURIComponent(symbol)}&interval=${timeframe}`, {
      cache: "no-store",
    });
    return res.json();
  }

  private async fetchBrowserTicker(symbol: string): Promise<{ data: unknown }> {
    const res = await fetch(`${this.baseUrl}/ticker?symbol=${encodeURIComponent(symbol)}`, {
      cache: "no-store",
    });
    return res.json();
  }
}
