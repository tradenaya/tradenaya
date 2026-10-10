import { NextRequest } from "next/server";
import { getCustomerFromRequest } from "@/lib/auth";
import { getKeysForUser } from "@/lib/coinswitch.store";
import { HttpError } from "@/lib/api-error";

export async function getKeysFromRequest(req: NextRequest) {
  const customer = getCustomerFromRequest(req as any as NextRequest);
  if (!customer) return null;
  const keys = await getKeysForUser(customer.customerId);
  return keys;
}

/**
 * Keys for a signed CoinSwitch call, or an HttpError that errorResponse()
 * turns into a clear 401/400 — instead of signing with an undefined secret and
 * crashing with "The first argument must be of type string… Received undefined".
 *
 * `allowServerKeys` keeps the existing fallback to the server's own
 * COINSWITCH_API_KEY/SECRET for market-data routes (ticker, klines).
 */
export async function requireKeysFromRequest(
  req: NextRequest,
  options: { allowServerKeys?: boolean } = {},
): Promise<{ apiKey: string; apiSecret: string }> {
  const customer = getCustomerFromRequest(req);
  const keys = customer ? await getKeysForUser(customer.customerId) : null;
  if (keys?.apiKey && keys?.apiSecret) return { apiKey: keys.apiKey, apiSecret: keys.apiSecret };

  const serverKey = process.env.COINSWITCH_API_KEY;
  const serverSecret = process.env.COINSWITCH_API_SECRET;
  if (options.allowServerKeys && serverKey && serverSecret) return { apiKey: serverKey, apiSecret: serverSecret };

  if (!customer) throw new HttpError(401, "You are not signed in (or your session expired). Please sign in again.", "UNAUTHENTICATED");
  throw new HttpError(
    400,
    "Your CoinSwitch account is not connected — no API keys are saved for this user. Connect it on the CoinSwitch connect page.",
    "COINSWITCH_NOT_CONNECTED",
  );
}
