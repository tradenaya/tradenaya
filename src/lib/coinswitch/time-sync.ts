const TIME_ENDPOINT = "https://coinswitch.co/trade/api/v2/time";

const isDev = process.env.NODE_ENV !== "production";

// Refresh the offset every 30 seconds. The offset is stable over time because
// both clocks tick at the same rate; refreshing just compensates for any
// transient NTP adjustments or network jitter. 30 s is well within the 5 s
// tolerance window — even a fully stale offset still produces a corrected epoch
// that tracks real server time as long as local clock drift is < ~160 ms/s.
const OFFSET_TTL_MS = 30_000;

let cachedOffset: number | null = null;
let lastFetchAt = 0;

/**
 * Fetch CoinSwitch server time and compute the offset:
 *   offset = serverTime − localTime
 *
 * On failure returns the previous cached offset (or 0 on first call) so that
 * the system degrades gracefully to uncorrected Date.now().
 */
async function fetchOffset(): Promise<number> {
  try {
    const res = await fetch(TIME_ENDPOINT, { cache: "no-store" });
    if (!res.ok) throw new Error(`CoinSwitch time endpoint returned ${res.status}`);
    const body = await res.json();
    // The response may be { serverTime: <ms> }, { server_time: <ms> }, or nested under .data
    const serverTime: number | undefined =
      body?.serverTime ?? body?.server_time ?? body?.data?.serverTime ?? body?.data?.server_time ?? body?.time ?? body?.data?.time;
    if (typeof serverTime !== "number" || !Number.isFinite(serverTime)) {
      throw new Error("Unexpected CoinSwitch time response shape");
    }
    const localNow = Date.now();
    const offset = serverTime - localNow;

    if (isDev) {
    }

    cachedOffset = offset;
    lastFetchAt = Date.now();
    return offset;
  } catch (err: any) {
    console.error("[CoinSwitch TimeSync] failed to fetch server time, using cached offset:", err?.message ?? err);
    return cachedOffset ?? 0;
  }
}

/**
 * Return the current offset (server − local) in milliseconds.
 * Refreshes automatically when stale. Never throws.
 */
export async function getOffset(): Promise<number> {
  if (cachedOffset === null || Date.now() - lastFetchAt > OFFSET_TTL_MS) {
    return fetchOffset();
  }
  return cachedOffset;
}

/**
 * Return a 13-digit millisecond epoch string synchronized to CoinSwitch
 * server time. This single value MUST be used for both:
 *   1. X-AUTH-EPOCH header
 *   2. Ed25519 signature message
 */
export async function getCoinSwitchEpoch(): Promise<string> {
  const offset = await getOffset();
  const epoch = String(Date.now() + offset);

  if (isDev) {
    const localNow = Date.now();
    const diff = Number(epoch) - localNow;
  }

  return epoch;
}
