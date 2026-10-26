import type { NextRequest } from "next/server";
import { getCustomerFromRequest } from "@/lib/auth";
import type { AutomationConfig } from "@/automation/types";
import { DEFAULT_STRATEGY_ID, isKnownStrategy, strategyInfo } from "@/automation/strategy/catalog";

export function requireUserId(req: NextRequest): number | null {
  const customer = getCustomerFromRequest(req);
  if (!customer) return null;
  return customer.customerId;
}

export function ok(data: unknown) {
  return Response.json({ success: true, data });
}

export function fail(status: number, message: string) {
  return Response.json({ success: false, message }, { status });
}

export function parseBotId(id: string): number | null {
  const botId = Number(id);
  if (!Number.isFinite(botId)) return null;
  return botId;
}

const n = (v: unknown): number | undefined =>
  v == null || v === "" ? undefined : Number(v);

export function sanitizeConfig(body: Record<string, unknown>): AutomationConfig {
  const capitalMode = body.capitalMode === "percent" ? "percent" : "fixed";
  const strategy = isKnownStrategy(body.strategy) ? body.strategy : DEFAULT_STRATEGY_ID;
  const info = strategyInfo(strategy);
  return {
    symbol: body.symbol as string,
    // A strategy designed for one timeframe always runs on it.
    timeframe: info.fixedTimeframe ?? (body.timeframe as string),
    strategy,
    leverage: n(body.leverage) as number,
    name: typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 100) : undefined,
    autoSelect: body.autoSelect === true,
    leverageMode: body.leverageMode === "auto" ? "auto" : "manual",
    leveragePercent: n(body.leveragePercent),
    capital: n(body.capital) as number,
    capitalMode,
    walletPercent: capitalMode === "percent" ? n(body.walletPercent) : undefined,
    maxRiskPerTrade: n(body.maxRiskPerTrade) as number,
    dailyLossLimit: n(body.dailyLossLimit) as number,
    riskStyle: body.riskStyle === "RISKY" ? "RISKY" : "SAFE",
    enableTrailingStop: Boolean(body.enableTrailingStop),
    trailingDistancePercent: n(body.trailingDistancePercent),
    minRiskRewardRatio: n(body.minRiskRewardRatio),
    orderExpiryMinutes: n(body.orderExpiryMinutes),
    minConfidence: n(body.minConfidence),
    driftAtr: n(body.driftAtr),
    maxCandles: n(body.maxCandles),
    hardCapCandles: n(body.hardCapCandles),
    regimeTolerancePct: n(body.regimeTolerancePct),
    momentumEntriesOnly: info.supportsMomentumFilter && body.momentumEntriesOnly === true,
    coinUniverse: body.coinUniverse === "MAJORS" ? "MAJORS" : "TOP_VOLUME",
  };
}
