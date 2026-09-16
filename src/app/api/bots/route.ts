import type { NextRequest } from "next/server";
import { botScheduler } from "@/automation/scheduler/BotScheduler";
import { fail, ok, requireUserId, sanitizeConfig } from "./_helpers";

export async function GET(req: NextRequest) {
  const userId = requireUserId(req);
  if (!userId) return fail(401, "Unauthorized");
  try {
    await botScheduler.ensureStarted();
    const bots = await botScheduler.listBots(userId);
    return Response.json({ success: true, schedulerActive: botScheduler.isRunning(), data: bots });
  } catch (error: any) {
    console.error("[bots] list failed", error);
    return fail(500, error?.message ?? "Failed to list bots");
  }
}

export async function POST(req: NextRequest) {
  const userId = requireUserId(req);
  if (!userId) return fail(401, "Unauthorized");
  try {
    const body = await req.json();
    const config = sanitizeConfig(body ?? {});

    // Wallet-% must be a percentage of REMAINING available across running bots:
    // sum every other bot's walletPercent for this user, block at 100%.
    if (config.capitalMode === "percent" && config.walletPercent != null) {
      const others = await botScheduler.listBots(userId);
      const allocatedTotal =
        others.reduce((sum, bot) => sum + (bot.capitalMode === "percent" ? bot.walletPercent ?? 0 : 0), 0) +
        config.walletPercent;
      if (allocatedTotal - 100 > 1e-9) {
        return fail(
          400,
          `Cannot start bot: ${config.walletPercent}% of remaining + existing allocations would exceed 100% of your available futures balance. Lower the wallet %, or reduce another bot's allocation first.`,
        );
      }
      if (allocatedTotal > 100 - 1e-9) {
        return fail(
          400,
          `Cannot start bot: your wallet is 100% allocated already. No remaining available balance for a new % bot. Lower another bot's % or delete a bot first.`,
        );
      }
    }

    const { botId } = await botScheduler.startBot(userId, config);
    return ok({ botId });
  } catch (error: any) {
    console.error("[bots] create failed", error);
    return fail(400, error?.message ?? "Failed to create bot");
  }
}
