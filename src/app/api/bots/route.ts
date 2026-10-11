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

    // Wallet-% bots share one wallet: the other bots' % plus this one may total
    // at most 100%. Exactly 100% is allowed — the scheduler caps it to the safe
    // share (fee + margin headroom), as the create dialog explains.
    if (config.capitalMode === "percent" && config.walletPercent != null) {
      const others = (await botScheduler.listBots(userId)).filter((b) => (b.tradingMode ?? "LIVE") === config.tradingMode);
      const othersTotal = others.reduce((sum, bot) => sum + (bot.capitalMode === "percent" ? bot.walletPercent ?? 0 : 0), 0);
      const remaining = Math.max(0, 100 - othersTotal);
      if (remaining <= 1e-9) {
        return fail(
          400,
          `Cannot start bot: your other bots already use 100% of the wallet. Lower another bot's % or delete a bot first.`,
        );
      }
      if (othersTotal + config.walletPercent - 100 > 1e-9) {
        return fail(
          400,
          `Cannot start bot: your other bots already use ${othersTotal}% of the wallet, so at most ${remaining}% is left for this bot. Lower the wallet % to ${remaining}% or less, or reduce another bot's allocation first.`,
        );
      }
    }

    // Creating a bot only saves it; the user turns it on separately.
    const { botId } = await botScheduler.createBot(userId, config);
    return ok({ botId, started: false });
  } catch (error: any) {
    console.error("[bots] create failed", error);
    return errorResponse(error, 400, "Failed to create bot", "/api/bots");
  }
}
