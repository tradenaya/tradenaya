import type { NextRequest } from "next/server";
import { fail, ok, requireUserId } from "@/app/api/bots/_helpers";
import { errorResponse, HttpError } from "@/lib/api-error";

/**
 * GET  /api/paper/wallet          -> paper wallet snapshot (balance, available, equity, …)
 * POST /api/paper/wallet {amount} -> reset the paper wallet to `amount` USDT
 *
 * The paper wallet is a simulated balance (default 100 USDT) that paper bots
 * trade with. It never touches the real CoinSwitch wallet.
 */
export async function GET(req: NextRequest) {
  const userId = requireUserId(req);
  if (!userId) return fail(401, "Unauthorized");
  try {
    const { paperExchange } = await import("@/automation/paper/exchange");
    const ex = await paperExchange();
    await ex.match(userId).catch(() => undefined);
    return ok(await ex.snapshot(userId));
  } catch (error) {
    return errorResponse(error, 500, "Failed to load the paper wallet", "/api/paper/wallet");
  }
}

export async function POST(req: NextRequest) {
  const userId = requireUserId(req);
  if (!userId) return fail(401, "Unauthorized");
  try {
    const body = (await req.json().catch(() => ({}))) as { amount?: unknown };
    const amount = Number(body.amount);
    if (!(amount > 0) || amount > 10_000_000) throw new HttpError(400, "Enter a paper balance between 1 and 10,000,000 USDT.", "INVALID_AMOUNT");
    const { paperExchange } = await import("@/automation/paper/exchange");
    const ex = await paperExchange();
    try {
      await ex.resetWallet(userId, amount);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error), "PAPER_RESET_REFUSED");
    }
    return ok(await ex.snapshot(userId));
  } catch (error) {
    return errorResponse(error, 400, "Failed to reset the paper wallet", "/api/paper/wallet");
  }
}
