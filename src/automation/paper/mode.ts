import { AsyncLocalStorage } from "node:async_hooks";
import { db } from "@/lib/db";

/**
 * Trading mode of the work currently running.
 *
 * LIVE  = real CoinSwitch account (the default everywhere).
 * PAPER = simulated account (see paper/exchange.ts): orders, positions and the
 *         wallet live in the database and fill against REAL market prices.
 *
 * The mode travels with the async call chain (AsyncLocalStorage), so the whole
 * existing pipeline — scheduler, planner, risk, order executor, position
 * monitor, close accounting — runs unchanged for a paper bot: the single
 * CoinSwitchClient.call() choke point checks the mode and sends account
 * requests to the paper exchange. Market data (prices, klines, instruments)
 * always comes from the real exchange.
 */
export type TradingMode = "LIVE" | "PAPER";

const storage = new AsyncLocalStorage<{ mode: TradingMode }>();

export function normalizeTradingMode(value: unknown): TradingMode {
  return String(value ?? "").toUpperCase() === "PAPER" ? "PAPER" : "LIVE";
}

export function currentTradingMode(): TradingMode {
  return storage.getStore()?.mode ?? "LIVE";
}

export function isPaperContext(): boolean {
  return currentTradingMode() === "PAPER";
}

export function runWithTradingMode<T>(mode: TradingMode, fn: () => T): T {
  return storage.run({ mode }, fn);
}

/** Header the browser sends on every /api request (set by the Paper toggle). */
export const TRADING_MODE_HEADER = "x-trading-mode";

/** Mode a request asked for (header, or ?mode= for EventSource streams). */
export function requestTradingMode(req: { headers: { get(name: string): string | null }; url?: string }): TradingMode {
  const header = req.headers.get(TRADING_MODE_HEADER);
  if (header) return normalizeTradingMode(header);
  try {
    if (req.url) return normalizeTradingMode(new URL(req.url).searchParams.get("mode"));
  } catch {
    // ignore malformed URLs
  }
  return "LIVE";
}

// ---- bot -> mode lookup (positions/executions only know their bot) ----------

const BOT_MODE_TTL_MS = 5 * 60_000;
const botModes = new Map<number, { mode: TradingMode; at: number }>();

export function rememberBotMode(botId: number, mode: TradingMode): void {
  botModes.set(botId, { mode, at: Date.now() });
}

export async function tradingModeOfBot(botId: number | null | undefined): Promise<TradingMode> {
  if (botId == null) return "LIVE";
  const cached = botModes.get(botId);
  if (cached && Date.now() - cached.at < BOT_MODE_TTL_MS) return cached.mode;
  try {
    const [rows] = await db.query(`SELECT trading_mode FROM automation_bots WHERE id = ? LIMIT 1;`, [botId]);
    const mode = normalizeTradingMode((rows as Array<{ trading_mode?: string }>)[0]?.trading_mode);
    rememberBotMode(botId, mode);
    return mode;
  } catch {
    // Column not created yet (old database) => every bot is live.
    return "LIVE";
  }
}

/** Run `fn` in the trading mode of the bot that owns the work. */
export async function withBotMode<T>(botId: number | null | undefined, fn: () => Promise<T>): Promise<T> {
  const mode = await tradingModeOfBot(botId);
  return runWithTradingMode(mode, fn);
}

/**
 * Put the rest of the current request in the mode it asked for (x-trading-mode
 * header / ?mode=). Called from the shared auth helpers every API route uses,
 * so repositories and the exchange client see the right mode without each
 * route wrapping itself. Scoped to this request's async chain only.
 */
export function enterRequestTradingMode(req: { headers: { get(name: string): string | null }; url?: string }): TradingMode {
  const mode = requestTradingMode(req);
  storage.enterWith({ mode });
  return mode;
}
