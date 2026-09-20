import type { NextRequest } from "next/server";
import type { AutomationConfig } from "@/automation/types";
import { ok, fail, requireUserId } from "@/app/api/bots/_helpers";
import { AutoBestSelector } from "@/automation/coinauto/auto-best-selector";
import { coinswitchClient } from "@/automation/executor/client";
import { serverMarketDataService } from "@/automation/market/service";

const DEFAULT_AUTO_SELECTION_TIMEOUT_MS = 90_000;

/**
 * Live auto-select preview: given the bot settings, compute the single BEST
 * currently tradable coin opportunity + the leverage the bot would actually
 * use. Pure read — never creates orders.
 *
 * The API makes ONE request to the new selector and receives ONE best coin.
 */
export async function GET(req: NextRequest) {
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  console.log(`[AUTO_API ${requestId}] START url=${req.url}`);

  try {
    const userId = requireUserId(req);
    console.log(`[AUTO_API ${requestId}] USER userId=${userId ?? "none"}`);
    if (!userId) return fail(401, "Not authenticated");

    const url = new URL(req.url);

    console.log(`[AUTO_API ${requestId}] CONFIG_PARSE_START`);
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
        leverageMode:
          url.searchParams.get("leverageMode") === "auto" ? "auto" : "manual",
        leveragePercent:
          Number(url.searchParams.get("leveragePercent")) || 50,
        capital: Number(url.searchParams.get("capital")) || 100,
        capitalMode: "fixed",
        maxRiskPerTrade:
          Number(url.searchParams.get("maxRiskPerTrade")) || 1,
        dailyLossLimit:
          Number(url.searchParams.get("dailyLossLimit")) || 5,
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
      walletPercent:
        base.walletPercent != null
          ? Number(base.walletPercent)
          : undefined,
      maxRiskPerTrade: Number(base.maxRiskPerTrade) || 1,
      dailyLossLimit: Number(base.dailyLossLimit) || 5,
      enableTrailingStop: Boolean(base.enableTrailingStop),
      trailingDistancePercent:
        base.trailingDistancePercent != null
          ? Number(base.trailingDistancePercent)
          : undefined,
      minConfidence:
        base.minConfidence != null
          ? Number(base.minConfidence)
          : undefined,
      driftAtr:
        base.driftAtr != null
          ? Number(base.driftAtr)
          : undefined,
      maxCandles:
        base.maxCandles != null
          ? Number(base.maxCandles)
          : undefined,
      hardCapCandles:
        base.hardCapCandles != null
          ? Number(base.hardCapCandles)
          : undefined,
      regimeTolerancePct:
        base.regimeTolerancePct != null
          ? Number(base.regimeTolerancePct)
          : undefined,
    };

    console.log(
      `[AUTO_API ${requestId}] CONFIG_PARSED timeframe=${config.timeframe} leverageMode=${config.leverageMode}`,
    );

    const selector = new AutoBestSelector({
      client: coinswitchClient,
      marketData: () => serverMarketDataService.adapterFor(userId),
    });

    console.log(`[AUTO_API ${requestId}] SELECTOR_CREATED`);
    console.log(`[AUTO_API ${requestId}] SELECT_START`);

    // Overall request timeout. This only guards against a genuine hang — the
    // selector logs every stage, so the underlying error is never hidden behind
    // a generic timeout message.
    const timeoutMs = Number(process.env.AUTO_SELECTION_TIMEOUT_MS);
    const effectiveTimeoutMs =
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? timeoutMs
        : DEFAULT_AUTO_SELECTION_TIMEOUT_MS;

    let timedOut = false;
    const best = await Promise.race([
      selector.selectBestOpportunity(userId, config),
      new Promise<null>((resolve) => {
        const timer = setTimeout(() => {
          timedOut = true;
          console.error(
            `[AUTO_API ${requestId}] TIMEOUT after ${effectiveTimeoutMs}ms`,
          );
          resolve(null);
        }, effectiveTimeoutMs);
        if (typeof timer.unref === "function") timer.unref();
      }),
    ]);

    if (timedOut) {
      return fail(504, `Auto-selection timed out after ${effectiveTimeoutMs}ms`);
    }

    console.log(
      `[AUTO_API ${requestId}] SELECT_END symbol=${best?.symbol ?? "none"}`,
    );

    if (!best) {
      return ok({
        best: null,
        message:
          "No suitable trading opportunity currently meets the bot's requirements.",
      });
    }

    const asNumber = (value: unknown): number | null => {
      const n = Number(value);
      return Number.isFinite(n) && n > 0 ? n : null;
    };

    console.log(`[AUTO_API ${requestId}] RESPONSE_BUILD_START`);

    const response = ok({
      best: {
        symbol: best.symbol,
        side: best.side,
        score: best.score,
        confidence: best.confidence,
        price: best.price,
        atrPct: best.atrPct,
        trend: best.trend,
        factors: best.factors,
        leverage: best.leverage,
        instrument: best.instrument,
        maxLeverage: asNumber(best.instrument?.max_leverage),
        minLeverage: asNumber(best.instrument?.min_leverage),
        minQty: asNumber(best.instrument?.min_base_quantity),
        step: asNumber(
          best.instrument?.base_quantity_step_size ??
            best.instrument?.lot_size,
        ),
      },
    });

    console.log(`[AUTO_API ${requestId}] RESPONSE_SENT`);
    return response;
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to preview auto-selection";

    console.error(`[AUTO_API ${requestId}] ERROR`, error);

    return fail(500, message);
  }
}
