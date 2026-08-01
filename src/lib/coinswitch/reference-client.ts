import crypto from "crypto";

export const BASE_URL = process.env.COINSWITCH_BASE_URL!;
const API_KEY = process.env.COINSWITCH_API_KEY!;
const API_SECRET = process.env.COINSWITCH_API_SECRET!;

if (!API_KEY || !API_SECRET || !BASE_URL) {
  throw new Error(
    "COINSWITCH_API_KEY / COINSWITCH_API_SECRET / COINSWITCH_BASE_URL are not set"
  );
}

function createSignature(
  method: string,
  path: string,
  secretKey: string,
  epoch: string
) {
  const decodedPath = decodeURIComponent(path.replace(/\+/g, " "));

  const message = method.toUpperCase() + decodedPath + epoch;

  const seed = Buffer.from(secretKey, "hex");

  const der = Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    seed,
  ]);

  const privateKey = crypto.createPrivateKey({
    key: der,
    format: "der",
    type: "pkcs8",
  });

  return crypto.sign(null, Buffer.from(message), privateKey).toString("hex");
}

export interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

/**
 * @param method    "GET" | "POST" | "DELETE"
 * @param endpoint  Short form relative to BASE_URL, e.g. "/futures/order"
 *                  (NOT prefixed with /trade/api/v2 — that's added
 *                  internally only for the signature, matching the
 *                  existing kline route's convention)
 * @param params    Query params for GET, or body params for POST/DELETE —
 *                   both get embedded into the signed path as a query string,
 *                   same as the existing kline route does for GET.
 */
export function buildSignedRequest(
  method: "GET" | "POST" | "DELETE",
  endpoint: string,
  params?: Record<string, any>
): SignedRequest {
  let query = "";

  if (params && Object.keys(params).length > 0) {
    query =
      "?" +
      new URLSearchParams(
        Object.entries(params).reduce((acc, [k, v]) => {
          acc[k] = String(v);
          return acc;
        }, {} as Record<string, string>)
      ).toString();
  }

  const fullEndpoint = `${endpoint}${query}`;
  const signPath = `/trade/api/v2${fullEndpoint}`;

  const epoch = Date.now().toString();

  const signature = createSignature(method, signPath, API_SECRET, epoch);

  return {
    url: `${BASE_URL}${fullEndpoint}`,
    headers: {
      "Content-Type": "application/json",
      "X-AUTH-APIKEY": API_KEY,
      "X-AUTH-SIGNATURE": signature,
      "X-AUTH-EPOCH": epoch,
    },
  };
}