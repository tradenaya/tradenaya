/**
 * Telegram notification service (official Telegram Bot API, server-side only).
 *
 * - Uses TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID from environment variables.
 * - NEVER exposes the token or chat id to the browser/frontend.
 * - ALL calls are non-blocking / fire-and-forget. Any failure is logged and
 *   swallowed so trading continues no matter what.
 *
 * If the environment variables are not configured, the service is a silent
 * no-op (isTelegramConfigured() === false) so the rest of the app is unaffected.
 */

const BOT_API_BASE = "https://api.telegram.org";

interface TelegramConfig {
  token?: string;
  chatId?: string;
}

function readConfig(): TelegramConfig {
  return {
    token: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  };
}

export function isTelegramConfigured(): boolean {
  const { token, chatId } = readConfig();
  return Boolean(token && chatId);
}

/**
 * Escape text for Telegram HTML parse mode. Only the characters that break
 * HTML formatting are escaped, so emoji and plain text pass through cleanly.
 */
function escapeHtml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return c;
    }
  });
}

/** Build a Telegram sendMessage payload. All dynamic text is HTML-escaped. */
function buildPayload(text: string): Record<string, unknown> {
  return {
    chat_id: readConfig().chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
}

/**
 * Send a plain multi-line message to Telegram. Never throws. A returned
 * `ok` flag is exposed for the optional test endpoint/probe.
 */
export async function sendTelegram(text: string): Promise<{ ok: boolean; error?: string }> {
  const { token } = readConfig();
  if (!isTelegramConfigured() || !token) {
    console.warn("[telegram] not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID missing). Skipping send.");
    return { ok: false, error: "not_configured" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(`${BOT_API_BASE}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload(text)),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || data?.ok !== true) {
      const detail = data?.description ?? data?.error ?? `HTTP ${res.status}`;
      console.warn(`[telegram] send failed: ${detail}`);
      return { ok: false, error: String(detail) };
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[telegram] send error: ${message}`);
    return { ok: false, error: message };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fire-and-forget wrapper for trading paths. Guaranteed non-blocking: the
 * promise is not awaited by the caller and any rejection is caught here.
 */
export function sendTelegramAsync(text: string): void {
  if (!isTelegramConfigured()) return;
  void sendTelegram(text).catch(() => {
    // never propagate — Telegram must never affect trading
  });
}

function fmt(n: number | null | undefined, digits = 4): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return String(Number(n.toFixed(digits)));
}

function fmtSigned(n: number | null | undefined, digits = 4): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  const v = Number(n.toFixed(digits));
  return `${v >= 0 ? "+" : ""}${v}`;
}

function sideLabel(side?: string | null): string {
  const s = String(side ?? "").toUpperCase();
  if (s === "SELL") return "SHORT";
  if (s === "BUY") return "LONG";
  return s || "n/a";
}

function typeOfSide(side?: string | null): string {
  const s = String(side ?? "").toUpperCase();
  return s === "SELL" || s === "SHORT" ? "SHORT" : "LONG";
}

/* ---------------------------------------------------------------------------
 * Message builders
 * ------------------------------------------------------------------------ */

export function telegramBotStarted(p: {
  symbol?: string | null;
  timeframe?: string;
  leverage?: number | null;
  capital?: number | null;
  strategy?: string | null;
}): string {
  return [
    "🤖 <b>BOT STARTED</b>",
    ``,
    `Symbol: ${escapeHtml(String(p.symbol ?? "n/a")).toUpperCase()}`,
    `Timeframe: ${escapeHtml(String(p.timeframe ?? "n/a"))}`,
    `Leverage: ${fmt(p.leverage, 0)}x`,
    `Capital: ${fmt(p.capital ?? p.capital, 2)} USDT`,
    `Strategy: ${escapeHtml(String(p.strategy ?? "n/a"))}`,
  ].join("\n");
}

export function telegramBotStopped(p: {
  symbol?: string | null;
  reason?: string | null;
}): string {
  return [
    "🤖 <b>BOT STOPPED</b>",
    ``,
    `Symbol: ${escapeHtml(String(p.symbol ?? "n/a")).toUpperCase()}`,
    `Reason: ${escapeHtml(String(p.reason ?? "User stopped automation"))}`,
  ].join("\n");
}

/** Analysis completed — only sent for meaningful terminal analysis outcomes. */
export function telegramAnalysis(p: {
  symbol?: string | null;
  status: string;
  confidence?: number | null;
  detail?: string | null;
}): string {
  const conf =
    p.confidence != null && Number.isFinite(p.confidence) ? `${Math.round(p.confidence * 100)}%` : null;
  const lines = [
    "🔎 <b>ANALYSIS</b>",
    ``,
    `Symbol: ${escapeHtml(String(p.symbol ?? "n/a")).toUpperCase()}`,
    `Status: ${escapeHtml(p.status)}`,
  ];
  if (conf) lines.push(`Confidence: ${conf}`);
  if (p.detail) lines.push(`Detail: ${escapeHtml(p.detail)}`);
  return lines.join("\n");
}

export function telegramEntryOrder(p: {
  symbol?: string | null;
  side?: string | null;
  type?: string | null;
  entryPrice?: number | null;
  quantity?: number | null;
  leverage?: number | null;
}): string {
  return [
    "📋 <b>ENTRY ORDER</b>",
    ``,
    `Symbol: ${escapeHtml(String(p.symbol ?? "n/a")).toUpperCase()}`,
    `Side: ${sideLabel(p.side)}`,
    `Type: ${escapeHtml(String(p.type ?? "LIMIT"))}`,
    `Entry Price: ${fmt(p.entryPrice)}`,
    `Quantity: ${fmt(p.quantity)}`,
    `Leverage: ${fmt(p.leverage, 0)}x`,
  ].join("\n");
}

export function telegramPositionOpened(p: {
  symbol?: string | null;
  side?: string | null;
  entry?: number | null;
  quantity?: number | null;
  leverage?: number | null;
  margin?: number | null;
}): string {
  const margin =
    p.margin != null && Number.isFinite(p.margin)
      ? `${fmt(p.margin, 2)} USDT`
      : p.entry && p.quantity && p.leverage
        ? `${fmt((p.quantity * p.entry) / p.leverage, 2)} USDT`
        : "n/a";
  return [
    "🟢 <b>POSITION OPENED</b>",
    ``,
    `Symbol: ${escapeHtml(String(p.symbol ?? "n/a")).toUpperCase()}`,
    `Side: ${sideLabel(p.side)}`,
    `Entry: ${fmt(p.entry)}`,
    `Quantity: ${fmt(p.quantity)}`,
    `Leverage: ${fmt(p.leverage, 0)}x`,
    `Margin: ${margin}`,
  ].join("\n");
}

export function telegramProtected(p: {
  symbol?: string | null;
  sl?: number | null;
  tp?: number | null;
  trailing?: boolean | null;
}): string {
  return [
    "🛡️ <b>PROTECTED</b>",
    ``,
    `Symbol: ${escapeHtml(String(p.symbol ?? "n/a")).toUpperCase()}`,
    `SL: ${fmt(p.sl)}`,
    `TP: ${fmt(p.tp)}`,
    `Trailing Stop: ${p.trailing ? "ON" : "OFF"}`,
  ].join("\n");
}

export function telegramTakeProfit(p: {
  symbol?: string | null;
  side?: string | null;
  entry?: number | null;
  exit?: number | null;
  gross?: number | null;
  commission?: number | null;
  net?: number | null;
  roi?: number | null;
}): string {
  return [
    "🎯 <b>TAKE PROFIT HIT</b>",
    ``,
    `Symbol: ${escapeHtml(String(p.symbol ?? "n/a")).toUpperCase()}`,
    `Side: ${sideLabel(p.side)}`,
    `Entry: ${fmt(p.entry)}`,
    `Exit: ${fmt(p.exit)}`,
    ``,
    `Gross P&L: ${fmtSigned(p.gross)} USDT`,
    `Commission: ${p.commission != null ? fmtSigned(-Math.abs(p.commission)) : "n/a"} USDT`,
    `Net P&L: ${fmtSigned(p.net)} USDT`,
    `ROI: ${p.roi != null ? `${fmtSigned(p.roi, 2)}%` : "n/a"}`,
  ].join("\n");
}

export function telegramStopLoss(p: {
  symbol?: string | null;
  side?: string | null;
  entry?: number | null;
  exit?: number | null;
  pnl?: number | null;
  roi?: number | null;
}): string {
  return [
    "🛑 <b>STOP LOSS HIT</b>",
    ``,
    `Symbol: ${escapeHtml(String(p.symbol ?? "n/a")).toUpperCase()}`,
    `Side: ${sideLabel(p.side)}`,
    `Entry: ${fmt(p.entry)}`,
    `Exit: ${fmt(p.exit)}`,
    ``,
    `P&L: ${fmtSigned(p.pnl)} USDT`,
    `ROI: ${p.roi != null ? `${fmtSigned(p.roi, 2)}%` : "n/a"}`,
  ].join("\n");
}

export function telegramManualClose(p: {
  symbol?: string | null;
  side?: string | null;
  entry?: number | null;
  exit?: number | null;
  pnl?: number | null;
  roi?: number | null;
}): string {
  return [
    "✋ <b>POSITION CLOSED</b>",
    ``,
    `Symbol: ${escapeHtml(String(p.symbol ?? "n/a")).toUpperCase()}`,
    `Side: ${sideLabel(p.side)}`,
    ``,
    `Entry: ${fmt(p.entry)}`,
    `Exit: ${fmt(p.exit)}`,
    `P&L: ${fmtSigned(p.pnl)} USDT`,
    `ROI: ${p.roi != null ? `${fmtSigned(p.roi, 2)}%` : "n/a"}`,
  ].join("\n");
}

/** Generic position-closed message used when the reason is neither TP nor SL. */
export function telegramPositionClosed(p: {
  symbol?: string | null;
  side?: string | null;
  reason?: string | null;
  entry?: number | null;
  exit?: number | null;
  gross?: number | null;
  commission?: number | null;
  net?: number | null;
  roi?: number | null;
}): string {
  return [
    "✅ <b>POSITION CLOSED</b>",
    ``,
    `Symbol: ${escapeHtml(String(p.symbol ?? "n/a")).toUpperCase()}`,
    `Side: ${sideLabel(p.side)}`,
    `Reason: ${escapeHtml(String(p.reason ?? "n/a"))}`,
    `Entry: ${fmt(p.entry)}`,
    `Exit: ${fmt(p.exit)}`,
    ``,
    `Gross P&L: ${fmtSigned(p.gross)} USDT`,
    `Commission: ${p.commission != null ? fmtSigned(-Math.abs(p.commission)) : "n/a"} USDT`,
    `Net P&L: ${fmtSigned(p.net)} USDT`,
    `ROI: ${p.roi != null ? `${fmtSigned(p.roi, 2)}%` : "n/a"}`,
  ].join("\n");
}

export function telegramOrderFailed(p: {
  symbol?: string | null;
  orderType?: string | null;
  reason: string;
}): string {
  return [
    "❌ <b>ORDER FAILED</b>",
    ``,
    `Symbol: ${escapeHtml(String(p.symbol ?? "n/a")).toUpperCase()}`,
    `Order Type: ${escapeHtml(String(p.orderType ?? "n/a"))}`,
    ``,
    `Reason:`,
    escapeHtml(p.reason),
  ].join("\n");
}

/** Position is live but protective SL/TP could not be placed/confirmed. */
export function telegramUnprotected(p: {
  symbol?: string | null;
  reason: string;
}): string {
  return [
    "⚠️ <b>POSITION UNPROTECTED</b>",
    ``,
    `Symbol: ${escapeHtml(String(p.symbol ?? "n/a")).toUpperCase()}`,
    ``,
    `Reason:`,
    escapeHtml(p.reason),
  ].join("\n");
}

/** CoinSwitch / API error — never includes keys, secrets, signatures or headers. */
export function telegramCoinSwitchError(p: {
  endpoint?: string | null;
  symbol?: string | null;
  error: string;
  kind?: string | null;
}): string {
  const type = p.kind === "permanent" ? "PERMANENT" : "API";
  return [
    `⚠️ <b>COINSWITCH ${type}</b>`,
    ``,
    `Endpoint:`,
    escapeHtml(String(p.endpoint ?? "n/a")),
    ``,
    `Symbol:`,
    escapeHtml(String(p.symbol ?? "n/a").toUpperCase() || "n/a"),
    ``,
    `Error:`,
    escapeHtml(p.error),
  ].join("\n");
}

/** Public-facing "test" message to confirm the bot is connected. */
export function telegramTestConnected(): string {
  return [
    "🤖 TradiAura",
    ``,
    "Telegram notifications connected successfully.",
  ].join("\n");
}

export function sideLft(side?: string | null): string {
  return sideLabel(side);
}

export function longShort(side?: string | null): string {
  return typeOfSide(side);
}
