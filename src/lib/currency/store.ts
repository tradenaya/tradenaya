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
/** Display decimals for a converted price: more precision for sub-unit prices. */
function priceDecimals(abs: number, maxDecimals: number): number {
  if (abs >= 1000) return Math.min(2, maxDecimals);
  if (abs >= 1) return Math.min(4, maxDecimals);
  return Math.max(maxDecimals, 6);
}

/**
 * Format a USDT-quoted market price (entry, mark, SL, TP, liquidation…) in the
 * active currency. USDT keeps the bare number the trading screens always
 * showed; INR gets a ₹ prefix. Falls back to USDT until the live rate loads.
 */
export function formatDisplayPrice(value: number | string | null | undefined, maxDecimals = 4): string {
  if (value == null || value === "") return "—";
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  const conv = convertUsdt(num);
  const isInr = state.currency === "INR" && conv != null;
  const shown = isInr ? (conv as number) : num;
  const decimals = isInr ? priceDecimals(Math.abs(shown), maxDecimals) : maxDecimals;
  const body = shown.toLocaleString(isInr ? INR_LOCALE : USDT_LOCALE, { maximumFractionDigits: decimals });
  return isInr ? `₹${body}` : body;
}

/** Compact money for large figures such as 24h volume: $1.2B / ₹10.4B. */
export function formatCompactAmount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const conv = convertUsdt(value);
  const isInr = state.currency === "INR" && conv != null;
  const shown = isInr ? (conv as number) : value;
  const sym = isInr ? "₹" : "$";
  const abs = Math.abs(shown);
  if (abs >= 1_000_000_000) return `${sym}${(shown / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sym}${(shown / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sym}${(shown / 1_000).toFixed(1)}K`;
  return `${sym}${shown.toFixed(0)}`;
}

/** A USDT amount converted for text: "12.34 USDT" or "₹1,030.25". */
function amountForText(value: number, sourceDecimals: number): string {
  const conv = convertUsdt(value) as number;
  const abs = Math.abs(conv);
  const decimals = abs >= 1 ? 2 : Math.max(sourceDecimals, 4);
  const body = abs.toLocaleString(INR_LOCALE, { minimumFractionDigits: abs >= 1 ? 2 : 0, maximumFractionDigits: decimals });
  return `${conv < 0 ? "-" : ""}₹${body}`;
}

// "<number> USDT" (not part of a symbol like BTCUSDT) or "$<number>".
const USDT_AMOUNT_RE = /(?<![A-Za-z0-9.])(-?)(?:\$(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?(?:e-?\d+)?) ?USDT\b(?!\/))/g;

/**
 * Rewrite the USDT amounts and prices inside server-written text (activity
 * logs, live trace, error messages) into the active display currency. Server
 * messages always tag money as "<number> USDT", so only those figures change —
 * percentages, RSI, quantities and symbols are left alone. A no-op in USDT mode
 * or before the live rate is known.
 */
export function localizeUsdtText(text: string | null | undefined): string {
  if (!text) return text ?? "";
  if (state.currency !== "INR" || state.inrRate == null || state.inrRate <= 0) return text;
  return text.replace(USDT_AMOUNT_RE, (match, sign: string, dollar?: string, plain?: string) => {
    const raw = (dollar ?? plain ?? "").replace(/,/g, "");
    const value = Number(raw);
    if (!Number.isFinite(value)) return match;
    const decimals = raw.includes(".") ? raw.split(".")[1].length : 0;
    return amountForText(sign === "-" ? -value : value, decimals);
  });
}

/**
 * A USDT-based price or amount in the display currency, ALWAYS with its unit,
 * e.g. "1,21,572.7 INR" or "1,382.42 USDT". Use this on every dashboard /
 * bots / positions screen so no number is shown without saying what it is in.
 * Falls back to USDT (and says so) until the live INR rate loads.
 */
export function formatWithUnit(value: number | string | null | undefined, maxDecimals?: number): string {
  if (value == null || value === "") return "—";
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  const conv = convertUsdt(num);
  const isInr = state.currency === "INR" && conv != null;
  const shown = isInr ? (conv as number) : num;
  const abs = Math.abs(shown);
  const digits = maxDecimals ?? (abs >= 100 ? 2 : abs >= 1 ? 4 : abs === 0 ? 2 : 6);
  const body = shown.toLocaleString(isInr ? INR_LOCALE : USDT_LOCALE, { maximumFractionDigits: digits });
  return `${body} ${isInr ? "INR" : "USDT"}`;
}

/** Signed version for profit/loss: "+1,153.2 INR" / "−108.4 INR". */
export function formatSignedWithUnit(value: number | null | undefined, maxDecimals = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatWithUnit(Math.abs(value), maxDecimals)}`;
}

/** Signed percentage: "+0.96%" / "−4.43%". */
export function formatPct(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(digits)}%`;
}
