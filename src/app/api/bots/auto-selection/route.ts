import type { NextRequest } from "next/server";
import { ok, fail, requireUserId } from "@/app/api/bots/_helpers";
import { CoinAutoSelector } from "@/automation/coinauto/coin-auto-selector";
import { coinswitchClient } from "@/automation/executor/client";
import { serverMarketDataService } from "@/automation/market/service";

/**
 * Live auto-select preview: given the bot settings, compute the currently
 * strongest coin opportunity + the leverage the bot would actually use
 * (manual % mapping or auto risk-scaled). Pure read — never creates orders.
 */
export async function GET(req: NextRequest) {
  try {
    const userId = requireUserId(req);
    if (!userId) return fail(401, "Not authenticated");

    const url = new URL(req.url);
    const timeframe = url.searchParams.get("timeframe") || "1h";
    const leverageMode: "auto" | "manual" =
      url.searchParams.get("leverageMode") === "auto" ? "auto" : "manual";
    const leveragePercent = Number(url.searchParams.get("leveragePercent")) || 50;
    const config = {
      symbol: url.searchParams.get("symbol") || "AUTO",
      timeframe,
      leverage: 5,
      leverageMode,
      leveragePercent,
      autoSelect: true,
      capital: Number(url.searchParams.get("capital")) || 100,
      capitalMode: "fixed" as const,
      maxRiskPerTrade: Number(url.searchParams.get("maxRiskPerTrade")) || 1,
      dailyLossLimit: 5,
      enableTrailingStop: false,
    };

    const selector = new CoinAutoSelector({
      client: coinswitchClient,
      marketData: (userId) => serverMarketDataService.adapterFor(userId),
    });
    const best = await selector.selectBestOpportunity(userId, config, { limit: 30 });

    if (!best) {
      return ok({ best: null, message: "No suitable trading opportunity currently meets the bot's requirements." });
    }

    return ok({
      best: {
        symbol: best.symbol,
        side: best.side,
        score: best.opportunity.score,
        confidence: best.opportunity.confidence,
        price: best.opportunity.price,
        atrPct: best.opportunity.atrPct,
        trend: best.opportunity.trend,
        factors: best.opportunity.factors,
        leverage: best.leverage,
        maxLeverage: Number(best.instrument?.max_leverage) || null,
        minLeverage: Number(best.instrument?.min_leverage) || null,
      },
    });
  } catch (error: unknown) {
    console.error("AUTO-SELECT PREVIEW ERROR", error);
    return fail(500, error instanceof Error ? error.message : "Failed to preview auto-selection");
  }
}