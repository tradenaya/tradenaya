/**
 * Display-currency store for Tradenaya.
 *
 * A tiny module-level external store (no React internals, SSR-safe) that holds
 * the user's chosen display currency (USDT or INR) together with the live
 * USDT→INR conversion rate fetched from the exchange. All formatting helpers in
 * the app read from this store, so changing the currency switches every price,
 * PnL and wallet figure in the UI at once.
 *
 * React components that must re-render on change subscribe via
 * `useDisplayCurrency()` (see CurrencyProvider).
 */

export type DisplayCurrency = "USDT" | "INR";

export interface CurrencyState {
  currency: DisplayCurrency;
  /** Live USDT→INR rate when known; null before the first fetch succeeds. */
  inrRate: number | null;
  /** True when the rate was served from a stale server cache after a fetch failure. */
  rateStale: boolean;
}

export const CURRENCY_STORAGE_KEY = "tradenaya-display-currency";

const INR_LOCALE = "en-IN";
const USDT_LOCALE = "en-US";

function readStoredCurrency(): DisplayCurrency {
  if (typeof window === "undefined") return "USDT";
  try {
    const stored = window.localStorage.getItem(CURRENCY_STORAGE_KEY);
    if (stored === "INR" || stored === "USDT") return stored;
  } catch {
    // Storage unavailable — fall through to the default.
  }
  return "USDT";
}

let state: CurrencyState = {
  currency: readStoredCurrency(),
  inrRate: null,
  rateStale: false,
};

const listeners = new Set<() => void>();

function setState(next: CurrencyState): void {
  if (state === next) return;
  state = next;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A failing subscriber must never break the store.
    }
  }
}

export function getCurrencyState(): CurrencyState {
  return state;
}

export function subscribeCurrency(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshotCurrency(): CurrencyState {
  return state;
}

export function setDisplayCurrency(currency: DisplayCurrency): void {
  if (currency === state.currency) return;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(CURRENCY_STORAGE_KEY, currency);
    } catch {
      // Persistence is best-effort; the in-memory toggle still works.
    }
  }
  setState({ currency, inrRate: state.inrRate, rateStale: state.rateStale });
}

export function setInrRate(inrRate: number | null, stale = false): void {
  if (inrRate === state.inrRate && stale === state.rateStale) return;
  setState({ currency: state.currency, inrRate, rateStale: stale });
}

export function currencyLabel(): string {
  return state.currency === "INR" ? "INR" : "USDT";
}

export function currencySymbol(): string {
  return state.currency === "INR" ? "₹" : "$";
}

export function currencyLocale(): string {
  return state.currency === "INR" ? INR_LOCALE : USDT_LOCALE;
}

/**
 * Convert a USDT-denominated value to the active display currency.
 * Returns the original value when currency is USDT. When INR is active but the
 * live rate has not loaded yet, returns null so callers can fall back to the
 * USDT figure rather than showing a blank.
 */
export function convertUsdt(valueInUsdt: number): number | null {
  if (!Number.isFinite(valueInUsdt)) return null;
  if (state.currency === "USDT") return valueInUsdt;
  if (state.inrRate == null || state.inrRate <= 0) return null;
  return valueInUsdt * state.inrRate;
}

/**
 * Format a USDT-denominated amount in the active display currency, mirroring
 * the classic `formatMoney` behaviour but with live conversion.
 */
export function formatUsdtAmount(
  value: number | null | undefined,
  decimals = 2,
  withSymbol = true,
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const conv = convertUsdt(value);
  const isInr = state.currency === "INR" && conv != null;
  const num = isInr ? conv : value;
  const sym = isInr ? "₹" : "$";
  const locale = isInr ? INR_LOCALE : USDT_LOCALE;
  const body = num.toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return withSymbol ? `${sym}${body}` : body;
}