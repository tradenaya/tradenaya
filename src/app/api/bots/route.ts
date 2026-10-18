import type { NextRequest } from "next/server";
import { botScheduler } from "@/automation/scheduler/BotScheduler";
import { fail, ok, requireUserId, sanitizeConfig } from "./_helpers";
import { errorResponse } from "@/lib/api-error";
import { currentTradingMode } from "@/automation/paper/mode";

export async function GET(req: NextRequest) {
  const userId = requireUserId(req);
  if (!userId) return fail(401, "Unauthorized");
  try {
    await botScheduler.ensureStarted();
    // Live view lists live bots, paper view lists paper bots.
    const mode = currentTradingMode();
    const bots = (await botScheduler.listBots(userId)).filter((b) => (b.tradingMode ?? "LIVE") === mode);
    return Response.json({ success: true, schedulerActive: botScheduler.isRunning(), tradingMode: mode, data: bots });
  } catch (error: any) {
    console.error("[bots] list failed", error);
    return errorResponse(error, 500, "Failed to list bots", "/api/bots");
  }
}

export async function POST(req: NextRequest) {
  const userId = requireUserId(req);
  if (!userId) return fail(401, "Unauthorized");
  try {
    const body = await req.json();
    // A bot created while the Paper toggle is on is a paper bot (fixed for its lifetime).
    const config = { ...sanitizeConfig(body ?? {}), tradingMode: currentTradingMode() };

    // Wallet-% bots SHARE the wallet: each cycle sizes from the balance that is
    // free at that moment (money locked in other bots' trades is not free), so
    // several bots may each be set to 100%. No reservation, no idle money.

    // Creating a bot only saves it; the user turns it on separately.
    const { botId } = await botScheduler.createBot(userId, config);
    return ok({ botId, started: false });
  } catch (error: any) {
    console.error("[bots] create failed", error);
    return errorResponse(error, 400, "Failed to create bot", "/api/bots");
  }
}
