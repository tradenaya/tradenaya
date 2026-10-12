"use client";

export interface BotView {
  id: number;
  symbol: string;
  strategy: string;
  leverage: number;
  capital: number;
  capitalMode?: string;
  walletPercent?: number | null;
  name?: string | null;
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
  /** Auto-select scan universe. */
  coinUniverse: "MAJORS" | "TOP_VOLUME";
  /** LIVE or PAPER (fixed at creation). */
  tradingMode: "LIVE" | "PAPER";
  /** User-assigned display name for this bot (optional). */
  name?: string;
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
  /** Only take entries with strong momentum in the trade's direction. */
  momentumEntriesOnly: boolean;
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

export function parseBotConfig(bot: Pick<BotView, "symbol" | "configJson" | "leverage" | "capital" | "capitalMode" | "walletPercent" | "strategy" | "name">): BotConfig {
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
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : bot.name?.trim() || undefined,
    timeframe: String(raw.timeframe ?? "5m"),
    strategy: String(raw.strategy ?? bot.strategy ?? "TradenayaSmartV1"),
    leverage: Number(raw.leverage ?? bot.leverage),
    autoSelect: Boolean(raw.autoSelect),
    coinUniverse: raw.coinUniverse === "MAJORS" ? "MAJORS" : "TOP_VOLUME",
    tradingMode: raw.tradingMode === "PAPER" ? "PAPER" : "LIVE",
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
    momentumEntriesOnly: raw.momentumEntriesOnly === true,
    orderExpiryMinutes: raw.orderExpiryMinutes != null ? Number(raw.orderExpiryMinutes) : null,
    minConfidence: raw.minConfidence != null ? Number(raw.minConfidence) : null,
    driftAtr: raw.driftAtr != null ? Number(raw.driftAtr) : 1.5,
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

import { formatWithUnit } from "@/lib/currency/store";

/** Price / amount in the display currency, always with its unit ("121,572.7 INR"). */
export function fmtMoney(value: number | string | null | undefined, digits?: number): string {
  return formatWithUnit(value, digits);
}

/**
 * The symbol to display for a bot. Auto-select bots seed the DB `symbol` column
 * with the live best opportunity at start and re-sync it on every successful
 * selection, so that column is the source of truth for display. The
 * `config_json.symbol` is just the static placeholder the UI sent at creation
 * (e.g. BTCUSDT) and must not be shown for auto bots.
 */
export function displaySymbol(bot: Pick<BotView, "symbol">, cfg: BotConfig): string {
  if (cfg.autoSelect) {
    const live = String(bot.symbol ?? "").trim();
    return live.toUpperCase() === "AUTO" || live.toLowerCase() === "auto-select mode" ? "" : live.toUpperCase();
  }
  const configured = String(cfg.symbol ?? "").trim();
  if (configured && configured.toUpperCase() !== "AUTO" && configured.toLowerCase() !== "auto-select mode") {
    return configured.toUpperCase();
  }
  const fallback = String(bot.symbol ?? "").trim();
  return fallback.toUpperCase() === "AUTO" || fallback.toLowerCase() === "auto-select mode" ? "" : fallback.toUpperCase();
}

/** The user-assigned name for a bot, or null when none was set. */
export function botName(bot: Pick<BotView, "name">, cfg?: { name?: string }): string | null {
  const name = (cfg?.name ?? bot.name ?? "").trim();
  return name || null;
}

/** Normalizes a direction (LONG/SHORT/BUY/SELL) into a Long/Short label, or null. */
export function sideLabel(side?: string | null): "Long" | "Short" | null {
  const s = String(side ?? "").toUpperCase();
  if (s === "LONG" || s === "BUY") return "Long";
  if (s === "SHORT" || s === "SELL") return "Short";
  return null;
}
/** Bot statuses during which the bot is actually working a trade. */
const IN_TRADE_STATUSES = new Set(["TRADE_PLANNED", "ORDER_PENDING", "POSITION_OPEN", "POSITION_MANAGED"]);

export function botInTrade(bot: Pick<BotView, "status">): boolean {
  return IN_TRADE_STATUSES.has(String(bot.status ?? "").toUpperCase());
}

/**
 * What a bot is trading RIGHT NOW. Auto-select bots remember their last pick
 * (coin, side, leverage) in config, but once that trade closes they're back
 * to scanning, so only show the pick while the bot is in a trade.
 */
export function activeTrade(bot: Pick<BotView, "symbol" | "status" | "leverage">, cfg: BotConfig): {
  symbol: string;
  side: "Long" | "Short" | null;
  leverage: string;
  scanning: boolean;
} {
  if (cfg.autoSelect && !botInTrade(bot)) return { symbol: "", side: null, leverage: "auto lev", scanning: true };
  return { symbol: displaySymbol(bot, cfg), side: sideLabel(cfg.side), leverage: `${bot.leverage}x`, scanning: false };
}

/** How much the bot trades with: "25% of wallet" for percent bots, else the fixed amount. */
export function capitalText(cfg: BotConfig): string {
  if (cfg.capitalMode === "percent" && cfg.walletPercent != null) return `${cfg.walletPercent}% of wallet`;
  return fmtMoney(cfg.capital, 2);
}
