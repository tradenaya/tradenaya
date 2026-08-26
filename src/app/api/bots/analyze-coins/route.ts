import type { NextRequest } from "next/server";
import { coinSwitchRequest } from "@/lib/coinswitch";
import { getKeysFromRequest } from "@/app/api/coinswitch/_helpers";
import { ok, fail, requireUserId } from "@/app/api/bots/_helpers";
import { serverMarketDataService } from "@/automation/market/service";
import { normalizeInterval } from "@/automation/market/normalizer";
import { botScheduler } from "@/automation/scheduler/BotScheduler";
import { scanCandles, type CoinOpportunity } from "@/automation/opportunity/scanner";

interface TickerRow {
  symbol?: string;
  last_price?: string;
  price_24h_pcnt?: string;
  quote_asset_volume_24h?: string;
  funding_rate?: string;
}

const num = (value: unknown): number | undefined => {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

async function mapConcurrently<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await fn(items[current]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function GET(req: NextRequest) {
  try {
    const userId = requireUserId(req);
    if (!userId) return fail(401, "Not authenticated");

    const url = new URL(req.url);
    const timeframe = url.searchParams.get("timeframe") || "5m";
    if (normalizeInterval(timeframe) == null) return fail(400, `Unsupported timeframe "${timeframe}"`);
    const limit = Math.max(5, Math.min(50, Number(url.searchParams.get("limit") ?? 25) || 25));

    const keys = await getKeysFromRequest(req);
    const apiKey = keys?.apiKey;
    const apiSecret = keys?.apiSecret;
    if (!apiKey || !apiSecret) {
      return fail(401, "No saved CoinSwitch credentials were found for this account. Please reconnect your CoinSwitch account.");
    }

    await botScheduler.ensureStarted();

    const ticker = await coinSwitchRequest("/futures/all-pairs/ticker", "GET", apiKey, apiSecret, undefined, {
      exchange: "EXCHANGE_2",
    });

    const candidates = Object.entries((ticker.data ?? {}) as Record<string, TickerRow>)
      .map(([symbol, value]) => ({
        symbol,
        quoteVolume24h: num(value.quote_asset_volume_24h) ?? 0,
        change24h: num(value.price_24h_pcnt) ?? 0,
        fundingRate: num(value.funding_rate) ?? 0,
      }))
      .filter((c) => c.symbol.length >= 5 && c.quoteVolume24h > 0)
      .sort((a, b) => b.quoteVolume24h - a.quoteVolume24h)
      .slice(0, limit);

    const adapter = serverMarketDataService.adapterFor(userId);

    const scanned: CoinOpportunity[] = [];

    await mapConcurrently(candidates, 4, async (candidate) => {
      try {
        const snapshot = await adapter.getSnapshot(candidate.symbol, timeframe);
        const interval = String(normalizeInterval(timeframe) ?? "");
        const candles =
          snapshot.candles[timeframe] ??
          snapshot.candles[interval] ??
          Object.values(snapshot.candles)[0] ??
          [];
        const opportunity = scanCandles(candidate.symbol, timeframe, candles, {
          quoteVolume24h: candidate.quoteVolume24h,
        });
        if (opportunity && opportunity.tradable) {
          scanned.push({
            ...opportunity,
            symbol: candidate.symbol,
            quoteVolume24h: candidate.quoteVolume24h,
            change24h: candidate.change24h,
            fundingRate: candidate.fundingRate,
          });
        }
      } catch {
        // A single coin's market data failing must not kill the whole scan.
      }
    });

    scanned.sort((a, b) => b.score - a.score);
    return ok(scanned);
  } catch (error: unknown) {
    console.error("ANALYZE COINS ERROR", error);
    return fail(500, error instanceof Error ? error.message : "Failed to analyze coins");
  }
}
