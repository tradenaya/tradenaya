/**
 * Central symbol/timeframe normalization for the Market Data Service.
 *
 * The rest of the application historically lowercases symbols inline and passes
 * interval values around as minutes strings ("5"), labels ("5m") or raw minute
 * numbers interchangeably. This is the single normalization layer for the
 * market-data path so consumers and the exchange always agree on a format:
 *  - internal symbol:   "BTCUSDT"
 *  - API symbol:        "btcusdt" (lowercased by the REST client)
 *  - internal interval: minutes as a number (5, 60, 1440, ...)
 *  - API interval:      minutes as a string ("5", "60", "1440")
 */

export interface IntervalDescriptor {
  label: string;
  minutes: number;
}

/** Intervals already supported by the existing chart/kline implementation. */
export const SUPPORTED_INTERVALS: IntervalDescriptor[] = [
  { label: "1m", minutes: 1 },
  { label: "3m", minutes: 3 },
  { label: "5m", minutes: 5 },
  { label: "15m", minutes: 15 },
  { label: "30m", minutes: 30 },
  { label: "1h", minutes: 60 },
  { label: "2h", minutes: 120 },
  { label: "4h", minutes: 240 },
  { label: "6h", minutes: 360 },
  { label: "8h", minutes: 480 },
  { label: "12h", minutes: 720 },
  { label: "1d", minutes: 1440 },
];

const LABEL_TO_MINUTES: Record<string, number> = Object.fromEntries(
  SUPPORTED_INTERVALS.map((interval) => [interval.label.toLowerCase(), interval.minutes]),
);

/**
 * Normalize a symbol into the canonical internal form: uppercase, no separators.
 * Accepts "btc/usdt", "BTC-USDT", "BTCUSDT", "BTC_USDT" and returns "BTCUSDT".
 */
export function normalizeSymbol(raw: string): string {
  return String(raw ?? "").replace(/[/\\_\-.,\s]+/g, "").toUpperCase().trim();
}

/** Lowercase form used by CoinSwitch REST endpoints. */
export function toApiSymbol(symbol: string): string {
  return normalizeSymbol(symbol).toLowerCase();
}

/** True when the raw value is a plausibly-normalizable trading symbol. */
export function isValidSymbol(raw: string): boolean {
  const normalized = normalizeSymbol(raw);
  return normalized.length >= 5 && /^[A-Z0-9]+$/.test(normalized);
}

/** Convert any interval representation ("5m", "1h", "5", 60, "240", "1D") to minutes. */
export function normalizeInterval(raw: string | number): number | null {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "") return null;

  if (LABEL_TO_MINUTES[value]) return LABEL_TO_MINUTES[value];

  const match = value.match(/^(\d+)([mhdw])$/);
  if (match) {
    const amount = Number(match[1]);
    const unit = match[2];
    if (unit === "m") return amount;
    if (unit === "h") return amount * 60;
    if (unit === "d") return amount * 1440;
    if (unit === "w") return amount * 10080;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0 && Number.isInteger(numeric)) {
    return numeric;
  }

  return null;
}

/** True when the raw value maps to a supported interval. */
export function isSupportedInterval(raw: string | number): boolean {
  const minutes = normalizeInterval(raw);
  return minutes !== null && SUPPORTED_INTERVALS.some((interval) => interval.minutes === minutes);
}

/** Interval as the API expects it (minutes as a string). */
export function toApiInterval(raw: string | number): string | null {
  const minutes = normalizeInterval(raw);
  return minutes === null ? null : String(minutes);
}
