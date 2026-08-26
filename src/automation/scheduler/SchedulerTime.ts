const TIMEFRAME_MS: Record<string, number> = {
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "6h": 21_600_000,
  "8h": 28_800_000,
  "12h": 43_200_000,
  "1d": 86_400_000,
};

export function intervalMsFromTimeframe(timeframe: string, fallbackMs = 300_000): number {
  const key = String(timeframe ?? "").trim().toLowerCase();
  if (TIMEFRAME_MS[key]) return TIMEFRAME_MS[key];
  const match = key.match(/^(\d+)([mhdw])$/);
  if (match) {
    const value = Number(match[1]);
    const unit = match[2];
    if (unit === "m") return value * 60_000;
    if (unit === "h") return value * 3_600_000;
    if (unit === "d") return value * 86_400_000;
    if (unit === "w") return value * 604_800_000;
  }
  return fallbackMs;
}

export function backoffMs(attempt: number, baseMs: number, maxMs: number): number {
  if (attempt <= 0) return baseMs;
  const exponent = Math.min(attempt - 1, 8);
  const value = baseMs * 2 ** exponent;
  return Math.min(value, maxMs);
}
