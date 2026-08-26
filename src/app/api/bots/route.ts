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
    const { botId } = await botScheduler.startBot(userId, config);
    return ok({ botId });
  } catch (error: any) {
    console.error("[bots] create failed", error);
    return fail(400, error?.message ?? "Failed to create bot");
  }
}
