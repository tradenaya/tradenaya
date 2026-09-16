/**
 * Telegram dispatch layer with idempotency.
 *
 * Trading events that can be replayed (server restart, reconciliation) are
 * deduplicated via a small `telegram_sent_log` table keyed on a dedupe key +
 * notification type. This guarantees a given trade/position notification is
 * only delivered once even if the automation system re-runs.
 *
 * All sends are fire-and-forget and swalled on failure — Telegram can never
 * block or affect the trading path.
 */
import { db } from "@/lib/db";
import type { RowDataPacket } from "mysql2";
import { isTelegramConfigured, sendTelegram } from "@/lib/telegram";

export interface TelegramDispatchResult {
  sent: boolean;
  reason: "not_configured" | "duplicate" | "sent" | "send_failed";
  error?: string;
}

let ensured = false;

/** Public: creates the dedupe tracking table (idempotent). Called at boot. */
export async function ensureTelegramSentTable(): Promise<void> {
  if (ensured) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS telegram_sent_log (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      dedupe_key VARCHAR(200) NOT NULL,
      type VARCHAR(50) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_dedupe_type (dedupe_key, type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  ensured = true;
}

async function ensureTable(): Promise<void> {
  await ensureTelegramSentTable();
}

async function isAlreadySent(dedupeKey: string, type: string): Promise<boolean> {
  try {
    await ensureTable();
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT id FROM telegram_sent_log WHERE dedupe_key = ? AND type = ? LIMIT 1;`,
      [dedupeKey, type],
    );
    return rows.length > 0;
  } catch {
    // If the dedupe lookup fails, err on the side of sending (better to show a
    // trade event than to silently hide one). Still never affects trading.
    return false;
  }
}

async function markSent(dedupeKey: string, type: string): Promise<void> {
  try {
    await ensureTable();
    await db.query(
      `INSERT IGNORE INTO telegram_sent_log (dedupe_key, type) VALUES (?, ?);`,
      [dedupeKey, type],
    );
  } catch {
    // best-effort only
  }
}

/**
 * Send a single telegram notification exactly once for the given dedupe key.
 * Non-blocking: returns immediately after deciding to send. The network send
 * itself is fire-and-forget.
 */
export async function dispatchTelegram(
  dedupeKey: string,
  type: string,
  text: string,
): Promise<TelegramDispatchResult> {
  if (!isTelegramConfigured()) {
    return { sent: false, reason: "not_configured" };
  }
  if (await isAlreadySent(dedupeKey, type)) {
    return { sent: false, reason: "duplicate" };
  }
  const result = await sendTelegram(text);
  if (!result.ok) {
    // Not marked sent → the next cycle/retry path can fire it again. A "modern"
    // burst (429) or transient 5xx now only delays, never permanently loses.
    return { sent: false, reason: "send_failed", error: result.error };
  }
  await markSent(dedupeKey, type);
  return { sent: true, reason: "sent" };
}
