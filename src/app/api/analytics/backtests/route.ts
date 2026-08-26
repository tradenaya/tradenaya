import { NextRequest } from "next/server";
import { BacktestError } from "@/automation/backtest/errors";
import type { BacktestConfig } from "@/automation/backtest/types";
import { fail, getBacktestService, ok, requireUserId } from "../_helpers";

function statusForCode(code: string): number {
  switch (code) {
    case "INVALID_CONFIG":
      return 400;
    case "DUPLICATE_JOB":
      return 409;
    case "NO_DATA":
    case "DATA_UNAVAILABLE":
    case "DATA_QUALITY":
      return 422;
    case "NOT_FOUND":
      return 404;
    case "FORBIDDEN":
      return 403;
    default:
      return 500;
  }
}

export async function GET(req: NextRequest) {
  const userId = requireUserId(req);
  if (!userId) return fail(401, "Unauthorized");
  try {
    const url = new URL(req.url);
    const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : 20;
    const data = await getBacktestService().list(userId, limit);
    return ok(data);
  } catch (error: any) {
    console.error("[analytics/backtests]", error);
    return fail(500, error?.message ?? "Failed to list backtests");
  }
}

export async function POST(req: NextRequest) {
  const userId = requireUserId(req);
  if (!userId) return fail(401, "Unauthorized");
  try {
    const body = (await req.json()) as BacktestConfig;
    const data = await getBacktestService().run(userId, body);
    return ok(data);
  } catch (error: any) {
    console.error("[analytics/backtests] run failed", error);
    if (error instanceof BacktestError) {
      return fail(statusForCode(error.code), error.message);
    }
    return fail(500, error?.message ?? "Failed to run backtest");
  }
}
