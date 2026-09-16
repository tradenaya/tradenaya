import { NextResponse, NextRequest } from "next/server";
import { coinSwitchRequest } from "@/lib/coinswitch";
import { getKeysFromRequest } from "@/app/api/coinswitch/_helpers";

/**
 * GET /api/currency/rate
 *
 * Returns the live USDT→INR conversion rate for display purposes.
 *
 * Source of truth: CoinSwitch's spot ticker USDT/INR pair when it is listed.
 * Falls back to deriving the cross rate from BTC/INR ÷ BTC/USDT when it is not.
 * The quote is cached server-side for a short TTL so a fleet of browsers polls
 * this endpoint without hammering the exchange; a previous known-good quote is
 * served with a `stale` flag if the exchange call fails. Never falls back to a
 * hardcoded rate.
 */

interface TickerRow {
  last_price?: string | number;
  last?: string | number;
  price?: string | number;
  price_24h_pcnt?: string | number;
}

const TTL_MS = 45_000;

let cache: { inrRate: number; at: number } | null = null;

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : NaN;
}

function findPair(data: Record<string, TickerRow>, base: string, quote: string): number {
  const wantsBase = new Set([base, `${base}USDT`, `USDT${base}`]);
  for (const [key, row] of Object.entries(data)) {
    const norm = key.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    if (!norm.includes(base) || !norm.includes(quote)) continue;
    const price = toNumber(row?.last_price ?? row?.last ?? row?.price);
    if (!Number.isNaN(price)) return price;
  }
  return Number.NaN;
}

export async function GET(req: NextRequest) {
  try {
    const keys = await getKeysFromRequest(req as any);
    if (!keys?.apiKey || !keys?.apiSecret) {
      return NextResponse.json({ error: "No saved CoinSwitch credentials were found for this account. Please reconnect your CoinSwitch account." }, { status: 401 });
    }

    if (cache && Date.now() - cache.at < TTL_MS) {
      return NextResponse.json({ success: true, inrRate: cache.inrRate, updatedAt: new Date(cache.at).toISOString() });
    }

    let inrRate = Number.NaN;
    let fetchError: unknown = null;
    try {
      const ticker = await coinSwitchRequest("/24hr/all-pairs/ticker?exchange=coinswitchx", "GET", keys.apiKey, keys.apiSecret);
      const data = (ticker?.data ?? {}) as Record<string, TickerRow>;
      inrRate = findPair(data, "USDT", "INR");
      if (Number.isNaN(inrRate)) {
        const btcInr = findPair(data, "BTC", "INR");
        const futureTicker = await coinSwitchRequest(
          "/futures/all-pairs/ticker",
          "GET",
          keys.apiKey,
          keys.apiSecret,
          undefined,
          { exchange: "EXCHANGE_2" },
        );
        const btcUsdt = findPair((futureTicker?.data ?? {}) as Record<string, TickerRow>, "BTC", "USDT");
        if (!Number.isNaN(btcInr) && !Number.isNaN(btcUsdt) && btcUsdt > 0) {
          inrRate = btcInr / btcUsdt;
        }
      }
    } catch (error) {
      fetchError = error;
    }

    if (!Number.isNaN(inrRate)) {
      cache = { inrRate, at: Date.now() };
      return NextResponse.json({ success: true, inrRate, updatedAt: new Date().toISOString() });
    }

    if (cache) {
      return NextResponse.json({
        success: true,
        inrRate: cache.inrRate,
        updatedAt: new Date(cache.at).toISOString(),
        stale: true,
        message: "Live rate temporarily unavailable; serving last known quote.",
      });
    }

    throw fetchError instanceof Error ? fetchError : new Error("Unable to fetch the live USDT→INR rate from the exchange.");
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message ?? "Failed to fetch rate" }, { status: 502 });
  }
}