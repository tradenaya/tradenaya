import type { NextRequest } from "next/server";
import { ok, fail, requireUserId } from "@/app/api/bots/_helpers";
import { serverMarketDataService } from "@/automation/market/service";
import { normalizeInterval } from "@/automation/market/normalizer";
import { MAJOR_COINS } from "@/automation/coinauto/auto-best-selector";
import { assessCoinCondition, combineConditions, type CoinCondition } from "@/automation/market/condition";
import { errorResponse } from "@/lib/api-error";

/**
 * GET /api/bots/market-condition?timeframe=1h[&symbol=XRPUSDT]
 *
 * Is the market predictable or volatile right now, on this timeframe? A fixed-
 * coin bot is judged on its coin; an auto-select bot on the market leaders
 * (they set the tone for the whole crypto market). Real prices, so it is the
 * same for paper and live bots.
 */
export async function GET(req: NextRequest) {
  try {
    const userId = requireUserId(req);
    if (!userId) return fail(401, "Not authenticated");

    const url = new URL(req.url);
    const timeframe = url.searchParams.get("timeframe") || "1h";
    const minutes = normalizeInterval(timeframe);
    if (minutes == null) return fail(400, `Unsupported timeframe "${timeframe}"`);

    const requested = String(url.searchParams.get("symbol") ?? "").trim().toUpperCase();
    const symbols = requested && requested !== "AUTO" && /^[A-Z0-9]{2,20}USDT$/.test(requested) ? [requested] : MAJOR_COINS;

    const adapter = serverMarketDataService.adapterFor(userId);
    const results = await Promise.all(
      symbols.map(async (symbol): Promise<CoinCondition | null> => {
        try {
          const snapshot = await adapter.getSnapshot(symbol, timeframe);
          const candles = snapshot.candles[String(minutes)] ?? snapshot.candles[timeframe] ?? Object.values(snapshot.candles)[0] ?? [];
          return assessCoinCondition(symbol, candles);
        } catch {
          return null; // one coin's data failing must not hide the others
        }
      }),
    );

    return ok({ timeframe, basis: symbols.length === 1 ? "coin" : "market-leaders", ...combineConditions(results.filter((r): r is CoinCondition => r != null)) });
  } catch (error: unknown) {
    console.error("MARKET CONDITION ERROR", error);
    return errorResponse(error, 500, "Failed to read market condition", "/api/bots/market-condition");
  }
}
