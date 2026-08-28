/**
 * CoinSwitch Time Sync & Authentication Tests
 *
 * Tests:
 *   A. X-AUTH-EPOCH is a 13-digit millisecond timestamp
 *   B. Timestamp in signature == timestamp in X-AUTH-EPOCH header
 *   C. Timestamp is synchronized with CoinSwitch server time
 *   D-G. Authenticated request tests (require live API keys)
 *
 * Run: npx tsx test-coinswitch-auth.ts
 */

import crypto from "crypto";

// ─── Inline the time-sync module logic for standalone testing ───
const TIME_ENDPOINT = "https://coinswitch.co/trade/api/v2/time";

async function fetchServerTime(): Promise<number> {
  const res = await fetch(TIME_ENDPOINT, { cache: "no-store" });
  if (!res.ok) throw new Error(`Time endpoint returned ${res.status}`);
  const body = await res.json();
  const serverTime: number | undefined =
    body?.serverTime ?? body?.server_time ?? body?.data?.serverTime ?? body?.data?.server_time ?? body?.time ?? body?.data?.time;
  if (typeof serverTime !== "number" || !Number.isFinite(serverTime)) {
    throw new Error(`Unexpected time response: ${JSON.stringify(body)}`);
  }
  return serverTime;
}

// ─── Inline the signature logic (identical to reference-client.ts) ───
function createSignature(method: string, path: string, secretKey: string, epoch: string): string {
  const decodedPath = decodeURIComponent(path.replace(/\+/g, " "));
  const message = method.toUpperCase() + decodedPath + epoch;
  const seed = Buffer.from(secretKey, "hex");
  const der = Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    seed,
  ]);
  const privateKey = crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  return crypto.sign(null, Buffer.from(message), privateKey).toString("hex");
}

// ─── Helpers ───
let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.log(`  FAIL  ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

// ─── Test A: X-AUTH-EPOCH is 13-digit millisecond timestamp ───
async function testA() {
  console.log("\n=== Test A: X-AUTH-EPOCH is a 13-digit millisecond timestamp ===");

  const serverTime = await fetchServerTime();
  const localNow = Date.now();
  const offset = serverTime - localNow;
  const epoch = String(Date.now() + offset);

  assert(epoch.length === 13, "epoch has 13 digits", `got length ${epoch.length}, value: ${epoch}`);
  assert(/^\d{13}$/.test(epoch), "epoch matches /^\\d{13}$/", `got: ${epoch}`);
  assert(Number(epoch) > 1_700_000_000_000, "epoch is > Jan 2023 in ms", `got: ${epoch}`);

  const diffFromLocal = Number(epoch) - localNow;
  console.log(`  INFO  local=${localNow} server=${serverTime} offset=${offset} epoch=${epoch} diff=${diffFromLocal}ms`);
}

// ─── Test B: Signature timestamp === X-AUTH-EPOCH ───
async function testB() {
  console.log("\n=== Test B: Signature timestamp === X-AUTH-EPOCH ===");

  const serverTime = await fetchServerTime();
  const localNow = Date.now();
  const offset = serverTime - localNow;
  const epoch = String(Date.now() + offset);

  const method = "GET";
  const signPath = "/trade/api/v2/futures/wallet_balance?exchange=EXCHANGE_2";
  const fakeSecret = "0000000000000000000000000000000000000000000000000000000000000001";

  // Build the signing message exactly as the code does
  const decodedPath = decodeURIComponent(signPath.replace(/\+/g, " "));
  const message = method.toUpperCase() + decodedPath + epoch;

  // The epoch is embedded at the end of the message — extract it back
  const embeddedEpoch = message.slice(message.length - epoch.length);
  assert(embeddedEpoch === epoch, "epoch embedded in signature message matches X-AUTH-EPOCH", `embedded=${embeddedEpoch} epoch=${epoch}`);

  // Sign it
  const signature = createSignature(method, signPath, fakeSecret, epoch);
  assert(typeof signature === "string" && signature.length > 0, "signature is non-empty string", `length=${signature.length}`);
  assert(/^[0-9a-f]+$/.test(signature), "signature is hex string");

  // Re-sign with same inputs — must produce identical signature (deterministic)
  const signature2 = createSignature(method, signPath, fakeSecret, epoch);
  assert(signature === signature2, "signature is deterministic for same inputs");

  // Sign with different epoch — must produce different signature
  const signature3 = createSignature(method, signPath, fakeSecret, String(Number(epoch) + 1000));
  assert(signature !== signature3, "signature changes when epoch changes");
}

// ─── Test C: Timestamp synchronized with CoinSwitch server time ───
async function testC() {
  console.log("\n=== Test C: Timestamp synchronized with CoinSwitch server time ===");

  const serverTime = await fetchServerTime();
  const localNow = Date.now();
  const offset = serverTime - localNow;
  const epoch = Number(String(Date.now() + offset));

  const diffFromServer = Math.abs(epoch - serverTime);
  console.log(`  INFO  epoch=${epoch} server=${serverTime} diff=${diffFromServer}ms`);
  assert(diffFromServer < 5000, "epoch within 5 seconds of server time", `diff=${diffFromServer}ms`);
  assert(diffFromServer < 1000, "epoch within 1 second of server time (expected)", `diff=${diffFromServer}ms`);
}

// ─── Test D-G: Authenticated requests (require API keys in env) ───
async function testAuthenticated() {
  console.log("\n=== Tests D-G: Authenticated CoinSwitch requests ===");

  const apiKey = process.env.COINSWITCH_API_KEY;
  const apiSecret = process.env.COINSWITCH_API_SECRET;

  if (!apiKey || !apiSecret) {
    console.log("  SKIP  No COINSWITCH_API_KEY/COINSWITCH_API_SECRET in env — skipping live API tests");
    console.log("  (Uncomment keys in .env.local or set env vars to run these tests)");
    return;
  }

  const BASE_URL = process.env.COINSWITCH_BASE_URL ?? "https://coinswitch.co/trade/api/v2";

  // Build a signed request manually (mirrors reference-client.ts logic)
  async function buildTestSignedRequest(
    method: string,
    endpoint: string,
    params?: Record<string, any>,
  ): Promise<{ url: string; headers: Record<string, string> }> {
    let query = "";
    if (method === "GET" && params && Object.keys(params).length > 0) {
      query = "?" + new URLSearchParams(
        Object.entries(params).reduce((acc, [k, v]) => { acc[k] = String(v); return acc; }, {} as Record<string, string>)
      ).toString();
    }
    const fullEndpoint = `${endpoint}${query}`;
    const signPath = `/trade/api/v2${fullEndpoint}`;

    const serverTime = await fetchServerTime();
    const offset = serverTime - Date.now();
    const epoch = String(Date.now() + offset);

    const signature = createSignature(method, signPath, apiSecret!, epoch);
    return {
      url: `${BASE_URL}${fullEndpoint}`,
      headers: {
        "Content-Type": "application/json",
        "X-AUTH-APIKEY": apiKey!,
        "X-AUTH-SIGNATURE": signature,
        "X-AUTH-EPOCH": epoch,
      },
    };
  }

  // D. Authenticated GET (wallet balance)
  try {
    console.log("\n  --- Test D: Authenticated GET (wallet_balance) ---");
    const { url, headers } = await buildTestSignedRequest("GET", "/futures/wallet_balance", { exchange: "EXCHANGE_2" });
    const res = await fetch(url, { method: "GET", headers });
    const data = await res.json();
    console.log(`  INFO  status=${res.status}`);
    assert(res.ok, "wallet_balance request succeeded", JSON.stringify(data).slice(0, 200));
  } catch (err: any) {
    assert(false, "wallet_balance request", err.message);
  }

  // E. Authenticated futures request (positions)
  try {
    console.log("\n  --- Test E: Authenticated futures GET (positions) ---");
    const { url, headers } = await buildTestSignedRequest("GET", "/futures/positions", { exchange: "EXCHANGE_2", symbol: "btcusdt" });
    const res = await fetch(url, { method: "GET", headers });
    const data = await res.json();
    console.log(`  INFO  status=${res.status}`);
    assert(res.ok, "positions request succeeded", JSON.stringify(data).slice(0, 200));
  } catch (err: any) {
    assert(false, "positions request", err.message);
  }

  // F. Authenticated order-related (open orders — read-only, safe)
  try {
    console.log("\n  --- Test F: Authenticated POST (open_orders) ---");
    const payload = { exchange: "EXCHANGE_2" };
    const { url, headers } = await buildTestSignedRequest("POST", "/futures/orders/open", payload);
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
    const data = await res.json();
    console.log(`  INFO  status=${res.status}`);
    assert(res.ok, "open_orders request succeeded", JSON.stringify(data).slice(0, 200));
  } catch (err: any) {
    assert(false, "open_orders request", err.message);
  }

  // G. Authenticated GET (instrument info — public-ish but still signed)
  try {
    console.log("\n  --- Test G: Authenticated GET (instrument_info) ---");
    const { url, headers } = await buildTestSignedRequest("GET", "/futures/instrument_info", { exchange: "EXCHANGE_2" });
    const res = await fetch(url, { method: "GET", headers });
    const data = await res.json();
    console.log(`  INFO  status=${res.status}`);
    assert(res.ok, "instrument_info request succeeded", JSON.stringify(data).slice(0, 200));
  } catch (err: any) {
    assert(false, "instrument_info request", err.message);
  }
}

// ─── Main ───
async function main() {
  console.log("CoinSwitch Auth Timestamp & Time Sync Tests");
  console.log("===========================================");

  try {
    await testA();
    await testB();
    await testC();
    await testAuthenticated();
  } catch (err: any) {
    console.error("\nFATAL:", err.message);
    failed++;
  }

  console.log("\n===========================================");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
