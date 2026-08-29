import { NextRequest } from "next/server";
import { requireUserId } from "../../bots/_helpers";
import { isTelegramConfigured, sendTelegram, telegramTestConnected } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/**
 * Server-side test endpoint for Telegram notifications.
 *
 * Sends a "connected successfully" message to the configured chat. This only
 * sends a message — it NEVER places an order, touches automation, or affects
 * trading in any way.
 */
export async function POST(req: NextRequest) {
  const userId = requireUserId(req);
  if (!userId) return Response.json({ success: false, message: "Unauthorized" }, { status: 401 });

  if (!isTelegramConfigured()) {
    return Response.json(
      {
        success: false,
        message:
          "Telegram is not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in your server environment variables.",
      },
      { status: 400 },
    );
  }

  const result = await sendTelegram(telegramTestConnected());
  if (result.ok) {
    return Response.json({ success: true, message: "Telegram test notification sent." });
  }
  return Response.json(
    {
      success: false,
      message: `Telegram test failed: ${result.error ?? "unknown error"}`,
    },
    { status: 500 },
  );
}
