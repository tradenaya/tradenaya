import type { NextRequest } from "next/server";
import type { AutomationConfig } from "@/automation/types";
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

    // Prefer the caller's full config JSON (exact mirror of what the bot runs
    // with) so the preview reflects the real settings — timeframe, leverage
    // mode/%%, capital mode, regime tolerance, etc. Fall back to query params.
    const rawConfig = url.searchParams.get("config");
    let base: Partial<AutomationConfig>;
    if (rawConfig) {
      try {
        base = JSON.parse(rawConfig) as Partial<AutomationConfig>;
      } catch {
        return fail(400, "Invalid config JSON for auto-selection preview");
      }
    } else {
      base = {
        timeframe: url.searchParams.get("timeframe") || "1h",
        leverage: Number(url.searchParams.get("leverage")) || 5,
        leverageMode: url.searchParams.get("leverageMode") === "auto" ? "auto" : "manual",
        leveragePercent: Number(url.searchParams.get("leveragePercent")) || 50,
        capital: Number(url.searchParams.get("capital")) || 100,
        capitalMode: "fixed",
        maxRiskPerTrade: Number(url.searchParams.get("maxRiskPerTrade")) || 1,
        dailyLossLimit: Number(url.searchParams.get("dailyLossLimit")) || 5,
      };
    }

    const config: AutomationConfig = {
      symbol: "AUTO",
      timeframe: String(base.timeframe ?? "1h"),
      leverage: Number(base.leverage) || 5,
      leverageMode: base.leverageMode === "auto" ? "auto" : "manual",
      leveragePercent: Number(base.leveragePercent) || 50,
      autoSelect: true,
      capital: Number(base.capital) || 100,
      capitalMode: base.capitalMode === "percent" ? "percent" : "fixed",
      walletPercent: base.walletPercent != null ? Number(base.walletPercent) : undefined,
      maxRiskPerTrade: Number(base.maxRiskPerTrade) || 1,
      dailyLossLimit: Number(base.dailyLossLimit) || 5,
      enableTrailingStop: Boolean(base.enableTrailingStop),
      trailingDistancePercent: base.trailingDistancePercent != null ? Number(base.trailingDistancePercent) : undefined,
      minConfidence: base.minConfidence != null ? Number(base.minConfidence) : undefined,
      driftAtr: base.driftAtr != null ? Number(base.driftAtr) : undefined,
      maxCandles: base.maxCandles != null ? Number(base.maxCandles) : undefined,
      hardCapCandles: base.hardCapCandles != null ? Number(base.hardCapCandles) : undefined,
      regimeTolerancePct: base.regimeTolerancePct != null ? Number(base.regimeTolerancePct) : undefined,
    };

    const selector = new CoinAutoSelector({
      client: coinswitchClient,
      marketData: (userId) => serverMarketDataService.adapterFor(userId),
    });
    const best = await selector.selectBestOpportunity(userId, config);

    if (!best) {
      return ok({ best: null, message: "No suitable trading opportunity currently meets the bot's requirements." });
    }

    const asNumber = (value: unknown): number | null => {
      const n = Number(value);
      return Number.isFinite(n) && n > 0 ? n : null;
    };

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
        maxLeverage: asNumber(best.instrument?.max_leverage),
        minLeverage: asNumber(best.instrument?.min_leverage),
        minQty: asNumber(best.instrument?.min_base_quantity),
        step: asNumber(best.instrument?.base_quantity_step_size ?? best.instrument?.lot_size),
      },
    });
  } catch (error: unknown) {
    console.error("AUTO-SELECT PREVIEW ERROR", error);
    return fail(500, error instanceof Error ? error.message : "Failed to preview auto-selection");
  }
}