"use client";

export interface BotView {
  id: number;
  symbol: string;
  strategy: string;
  leverage: number;
  capital: number;
  capitalMode?: string;
  walletPercent?: number | null;
  status: string;
  desiredStatus: string;
  currentTrade?: unknown | null;
  lastAnalysisAt?: string | null;
  lastExecutionAt?: string | null;
  configJson?: string | null;
  lastError?: string | null;
  retryCount?: number;
  nextRunAt?: string | null;
  heartbeatAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface BotConfig {
  symbol: string;
  timeframe: string;
  strategy: string;
  leverage: number;
  autoSelect: boolean;
  /** Last selected direction for an auto-select bot (LONG/SHORT). */
  side?: "LONG" | "SHORT";
  leverageMode: "auto" | "manual";
  leveragePercent: number;
  capital: number;
  capitalMode: string;
  walletPercent: number | null;
  maxRiskPerTrade: number | null;
  dailyLossLimit: number | null;
  enableTrailingStop: boolean;
  trailingDistancePercent: number | null;
  orderExpiryMinutes: number | null;
  minConfidence: number | null;
  driftAtr: number;
  maxCandles: number;
  hardCapCandles: number;
  regimeTolerancePct: number;
}

export const RUNNING_STATES = [
  "RUNNING",
  "STARTING",
  "RECOVERING",
  "ANALYZING",
  "TRADE_PLANNED",
  "ORDER_PENDING",
  "POSITION_OPEN",
  "POSITION_MANAGED",
  "STOPPING",
] as const;

export const PAUSED_STATES = ["PAUSED", "PAUSING"] as const;

const STATUS_META: Record<string, { label: string; className: string }> = {
  RUNNING: { label: "Running", className: "bg-emerald-500/15 text-emerald-400" },
  STARTING: { label: "Starting", className: "bg-sky-500/15 text-sky-400" },
  RECOVERING: { label: "Recovering", className: "bg-amber-500/15 text-amber-400" },
  ANALYZING: { label: "Analyzing", className: "bg-sky-500/15 text-sky-400" },
  TRADE_PLANNED: { label: "Trade planned", className: "bg-sky-500/15 text-sky-400" },
  ORDER_PENDING: { label: "Placing order", className: "bg-sky-500/15 text-sky-400" },
  POSITION_OPEN: { label: "In position", className: "bg-amber-500/15 text-amber-400" },
  POSITION_MANAGED: { label: "Managing", className: "bg-amber-500/15 text-amber-400" },
  PAUSED: { label: "Paused", className: "bg-zinc-500/15 text-zinc-400" },
  STOPPING: { label: "Stopping", className: "bg-zinc-500/15 text-zinc-400" },
  STOPPED: { label: "Stopped", className: "bg-red-500/15 text-red-400" },
  ERROR: { label: "Error", className: "bg-red-500/15 text-red-400" },
};

export function statusMeta(status: string): { label: string; className: string } {
  return STATUS_META[status] ?? { label: status, className: "bg-zinc-500/15 text-zinc-400" };
}

export function isRunning(statusValue: string): boolean {
  return (RUNNING_STATES as readonly string[]).includes(statusValue);
}

export function isPaused(statusValue: string): boolean {
  return (PAUSED_STATES as readonly string[]).includes(statusValue);
}

export function parseBotConfig(bot: Pick<BotView, "symbol" | "configJson" | "leverage" | "capital" | "capitalMode" | "walletPercent" | "strategy">): BotConfig {
  const raw: Record<string, unknown> = {};
  if (bot.configJson) {
    try {
      Object.assign(raw, JSON.parse(bot.configJson));
    } catch {
      // ignore malformed config_json
    }
  }
  return {
    symbol: raw.symbol != null ? String(raw.symbol) : String(bot.symbol ?? ""),
    timeframe: String(raw.timeframe ?? "5m"),
    strategy: String(raw.strategy ?? bot.strategy ?? "TradiAuraSmartV1"),
    leverage: Number(raw.leverage ?? bot.leverage),
    autoSelect: Boolean(raw.autoSelect),
    side: raw.side === "SHORT" || raw.side === "SELL" ? "SHORT" : raw.side === "LONG" || raw.side === "BUY" ? "LONG" : undefined,
    leverageMode: raw.leverageMode === "auto" ? "auto" : "manual",
    leveragePercent: raw.leveragePercent != null ? Number(raw.leveragePercent) : 50,
    capital: Number(raw.capital ?? bot.capital),
    capitalMode: String(raw.capitalMode ?? bot.capitalMode ?? "fixed"),
    walletPercent: raw.walletPercent != null ? Number(raw.walletPercent) : bot.walletPercent ?? null,
    maxRiskPerTrade: raw.maxRiskPerTrade != null ? Number(raw.maxRiskPerTrade) : null,
    dailyLossLimit: raw.dailyLossLimit != null ? Number(raw.dailyLossLimit) : null,
    enableTrailingStop: Boolean(raw.enableTrailingStop),
    trailingDistancePercent: raw.trailingDistancePercent != null ? Number(raw.trailingDistancePercent) : null,
    orderExpiryMinutes: raw.orderExpiryMinutes != null ? Number(raw.orderExpiryMinutes) : null,
    minConfidence: raw.minConfidence != null ? Number(raw.minConfidence) : null,
    driftAtr: raw.driftAtr != null ? Number(raw.driftAtr) : 2.5,
    maxCandles: raw.maxCandles != null ? Number(raw.maxCandles) : 24,
    hardCapCandles: raw.hardCapCandles != null ? Number(raw.hardCapCandles) : 48,
    regimeTolerancePct: raw.regimeTolerancePct != null ? Number(raw.regimeTolerancePct) : 0.3,
  };
}

export function fmtRelative(iso?: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (!Number.isFinite(diff)) return "—";
  const s = Math.max(0, Math.round(diff / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function fmtMoney(value: number | string | null | undefined, digits?: number): string {
  if (value == null) return "—";
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  if (digits == null) {
    const abs = Math.abs(num);
    digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : abs === 0 ? 2 : 6;
  }
  return num.toLocaleString("en-US", { maximumFractionDigits: digits });
}

/**
 * The symbol to display for a bot. Auto-select bots store a placeholder in the
 * `symbol` column but the real currently-selected coin in `config_json`, so we
 * prefer the config value and only fall back to the DB column when missing.
 */
export function displaySymbol(bot: Pick<BotView, "symbol">, cfg: BotConfig): string {
  const configured = String(cfg.symbol ?? "").trim();
  if (configured && configured.toUpperCase() !== "AUTO" && configured.toLowerCase() !== "auto-select mode") {
    return configured.toUpperCase();
  }
  const fallback = String(bot.symbol ?? "").trim();
  return fallback.toUpperCase() === "AUTO" || fallback.toLowerCase() === "auto-select mode" ? "" : fallback.toUpperCase();
}

/** Normalizes a direction (LONG/SHORT/BUY/SELL) into a Long/Short label, or null. */
export function sideLabel(side?: string | null): "Long" | "Short" | null {
  const s = String(side ?? "").toUpperCase();
  if (s === "LONG" || s === "BUY") return "Long";
  if (s === "SHORT" || s === "SELL") return "Short";
  return null;
}