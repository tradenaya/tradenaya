import { NON_CRYPTO_SNAPSHOT } from "./non-crypto-snapshot";

/**
 * Keep auto-select on REAL crypto coins. CoinSwitch also lists gold, oil and
 * tokenized stocks / ETFs (e.g. XAUUSDT, SOXLUSDT) by trading volume; those
 * move on stock-market hours and news and the strategies are not built for
 * them (both such paper trades were losses). CoinSwitch's ticker has no asset
 * class, so the authoritative list comes from Binance USD-M futures
 * (underlyingType !== "COIN"), cached for 6 hours, merged with a built-in
 * snapshot so a Binance outage never lets them back in.
 */
const SOURCE = "https://fapi.binance.com/fapi/v1/exchangeInfo";
const TTL_MS = 6 * 60 * 60_000;
const FETCH_TIMEOUT_MS = 8_000;

/** Stablecoins and wrapped assets never trend; skip them too. */
const ALWAYS_EXCLUDED = ["USDCUSDT", "FDUSDUSDT", "TUSDUSDT", "USDPUSDT", "DAIUSDT", "BUSDUSDT", "USDEUSDT", "PYUSDUSDT", "EURUSDT", "XAUTUSDT", "PAXGUSDT", "WBTCUSDT"];

let cache: { at: number; symbols: Set<string> } | null = null;
let inflight: Promise<Set<string>> | null = null;

const snapshot = () => new Set([...NON_CRYPTO_SNAPSHOT, ...ALWAYS_EXCLUDED]);

async function fetchLive(fetcher: typeof fetch): Promise<Set<string>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetcher(SOURCE, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { symbols?: Array<{ symbol?: string; underlyingType?: string }> };
    const set = snapshot();
    for (const s of body.symbols ?? []) {
      if (s.symbol && s.underlyingType && s.underlyingType !== "COIN") set.add(s.symbol.toUpperCase());
    }
    return set;
  } finally {
    clearTimeout(timer);
  }
}

/** Symbols that are NOT crypto (cached; never throws — falls back to the snapshot). */
export async function nonCryptoSymbols(fetcher?: typeof fetch, now = Date.now()): Promise<Set<string>> {
  // Unit tests never touch the network unless they pass their own fetcher.
  if (!fetcher && process.env.VITEST) return snapshot();
  if (cache && now - cache.at < TTL_MS) return cache.symbols;
  if (!inflight) {
    inflight = fetchLive(fetcher ?? fetch)
      .then((symbols) => {
        cache = { at: Date.now(), symbols };
        return symbols;
      })
      .catch((error) => {
        console.warn(`[crypto-universe] live list unavailable, using snapshot: ${error instanceof Error ? error.message : String(error)}`);
        const symbols = cache?.symbols ?? snapshot();
        // retry sooner than the full TTL when the live source failed
        cache = { at: Date.now() - TTL_MS + 15 * 60_000, symbols };
        return symbols;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function isCryptoSymbol(symbol: string, nonCrypto: Set<string>): boolean {
  return !nonCrypto.has(String(symbol).toUpperCase());
}

/** Test hook. */
export function resetCryptoUniverseCache(): void {
  cache = null;
  inflight = null;
}
