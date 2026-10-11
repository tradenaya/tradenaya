/**
 * View mode for the whole app: LIVE (real CoinSwitch account) or PAPER
 * (simulated account). Saved per browser. While PAPER is on, every /api request
 * carries `x-trading-mode: PAPER` (see TradingModeProvider), so all screens —
 * bots, positions, orders, PnL, analytics, logs — show paper data only, and new
 * bots are created as paper bots.
 */
export type TradingMode = "LIVE" | "PAPER";

export const TRADING_MODE_STORAGE_KEY = "tradenaya-trading-mode";
export const TRADING_MODE_HEADER = "x-trading-mode";

function read(): TradingMode {
  if (typeof window === "undefined") return "LIVE";
  try {
    return window.localStorage.getItem(TRADING_MODE_STORAGE_KEY) === "PAPER" ? "PAPER" : "LIVE";
  } catch {
    return "LIVE";
  }
}

let mode: TradingMode = read();
const listeners = new Set<() => void>();

export function getTradingMode(): TradingMode {
  return mode;
}

export function subscribeTradingMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Switch mode. Reloads the page so every screen refetches its data in the new
 * mode at once (nothing stale from the other account stays on screen).
 */
export function setTradingMode(next: TradingMode, { reload = true }: { reload?: boolean } = {}): void {
  if (next === mode) return;
  mode = next;
  try {
    window.localStorage.setItem(TRADING_MODE_STORAGE_KEY, next);
  } catch {
    // persistence is best-effort
  }
  for (const l of listeners) l();
  if (reload && typeof window !== "undefined") window.location.reload();
}

/** True when `input` targets this app's own /api routes. */
export function isAppApiRequest(input: RequestInfo | URL): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, window.location.origin);
    return url.origin === window.location.origin && url.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}
