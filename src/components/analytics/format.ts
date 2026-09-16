import { getCurrencyState, convertUsdt } from "@/lib/currency/store";

export function formatMoney(value: number | null | undefined, decimals = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const state = getCurrencyState();
  const conv = convertUsdt(value);
  const isInr = state.currency === "INR" && conv != null;
  const num = conv ?? value;
  return `${isInr ? "₹" : "$"}${num.toLocaleString(isInr ? "en-IN" : "en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

export function formatPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const state = getCurrencyState();
  const conv = convertUsdt(value);
  const isInr = state.currency === "INR" && conv != null;
  const num = conv ?? value;
  const decimals = num >= 1000 ? 2 : num >= 1 ? 4 : 6;
  const body = num.toLocaleString(isInr ? "en-IN" : "en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return isInr ? `₹${body}` : body;
}

export function formatPercent(value: number | null | undefined, decimals = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(decimals)}%`;
}

export function formatSignedPercent(value: number | null | undefined, decimals = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(decimals)}%`;
}

export function formatTimestamp(value: string | number | null | undefined): string {
  if (value == null) return "—";
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e11 ? value : value * 1000;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) return formatDate(date.toISOString());
  }
  return formatDate(String(value));
}

export function formatDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = {}): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...opts,
  });
}

export function formatShortDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function pnlClass(value: number | null | undefined): string {
  if (value == null) return "";
  if (value > 0) return "text-emerald-400";
  if (value < 0) return "text-red-400";
  return "text-muted-foreground";
}

export function pnlText(value: number | null | undefined, decimals = 2): string {
  if (value == null) return "—";
  return `${value > 0 ? "+" : ""}${formatMoney(value, decimals)}`;
}

export function signClass(value: number | null | undefined): string {
  if (value == null) return "";
  return value > 0 ? "text-emerald-400" : value < 0 ? "text-red-400" : "text-muted-foreground";
}
