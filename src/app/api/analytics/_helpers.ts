import type { NextRequest } from "next/server";
import { getCustomerFromRequest } from "@/lib/auth";
import { BotAnalyticsRepository } from "@/automation/analytics/repository";
import { BotAnalyticsService } from "@/automation/analytics/service";
import type { AnalyticsFilters } from "@/automation/analytics/types";
import { BacktestService } from "@/automation/backtest/service";
import type { Granularity } from "@/automation/analytics/calculators";

let analyticsService: BotAnalyticsService | null = null;
export function getAnalyticsService(): BotAnalyticsService {
  if (!analyticsService) analyticsService = new BotAnalyticsService(new BotAnalyticsRepository());
  return analyticsService;
}

let backtestService: BacktestService | null = null;
export function getBacktestService(): BacktestService {
  if (!backtestService) backtestService = new BacktestService();
  return backtestService;
}

/** Resolve the authenticated trading user id, or null when unauthenticated. */
export function requireUserId(req: NextRequest): number | null {
  const customer = getCustomerFromRequest(req);
  if (!customer) return null;
  return customer.customerId;
}

function toNumber(value: string | null): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Parse analytics filters from a URL's query string. */
export function parseFilters(url: URL): AnalyticsFilters {
  const startTime = toNumber(url.searchParams.get("startTime"));
  const endTime = toNumber(url.searchParams.get("endTime"));
  const side = url.searchParams.get("side");
  return {
    botId: toNumber(url.searchParams.get("botId")),
    symbol: url.searchParams.get("symbol") || null,
    strategy: url.searchParams.get("strategy") || null,
    side: side === "BUY" || side === "SELL" ? side : null,
    exitReason: url.searchParams.get("exitReason") || null,
    startTime,
    endTime,
  };
}

export interface PagedQuery {
  page: number;
  pageSize: number;
  sortBy: string;
  sortDir: "asc" | "desc";
}

export function parsePagedQuery(url: URL): PagedQuery {
  const page = Math.max(1, toNumber(url.searchParams.get("page")) ?? 1);
  const pageSize = Math.min(200, Math.max(1, toNumber(url.searchParams.get("pageSize")) ?? 25));
  const sortDir = url.searchParams.get("sortDir") === "asc" ? "asc" : "desc";
  const sortBy = url.searchParams.get("sortBy") ?? "closedAt";
  return { page, pageSize, sortBy, sortDir };
}

export function parseGranularity(url: URL): Granularity {
  const value = url.searchParams.get("granularity");
  return value === "weekly" || value === "monthly" ? value : "daily";
}

export function ok(data: unknown) {
  return Response.json({ success: true, data });
}

export function fail(status: number, message: string) {
  return Response.json({ success: false, message }, { status });
}
