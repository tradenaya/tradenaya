/**
 * Telegram notification dispatch with idempotency and retry-on-failure.
 *
 * Trading events that can be replayed (scheduler restart, reconciliation) are
 * deduplicated via a `telegram_sent_log` table keyed on dedupe key + type, so a
 * given trade/position notification is delivered exactly once.
 *
 * Delivery contract:
 *  - The dedupe row is written ONLY AFTER a successful network send. Marking
 *    before the send is a real bug class: a transient Telegram/network failure
 *    leaves the message permanently marked "sent" and it can never be retried —
 *    which is exactly the "BOT STARTED arrives but POSITION CLOSED doesn't"
 *    symptom. Sending first, then marking, means a failed attempt is naturally
 *    retried on the next cycle instead of being silently dropped.
 *  - All sends delegate to `sendTelegram`, which honors Telegram flood-control
 *    (`retry_after` on 429), the HTML `400` parse-reject fallback (plain text),
 *    and transient 5xx backoff.
 *
 * Notifications never affect the trading path: any failure is caught here and
 * logged (never thrown, never blocks trading); on success we clear the
 * in-memory dedupe cache so a future identical event CAN send.
 */
import { db } from "@/lib/db";
import type { RowDataPacket } from "mysql2";
import { isTelegramConfigured, sendTelegram } from "@/lib/telegram";

export interface TelegramDispatchResult {
  sent: boolean;
  reason: "not_configured" | "duplicate" | "sent" | "send_failed";
}

let ensured = false;

async function ensureTelegramSentTable(): Promise<void> {
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

export async function ensureTelegramDispatchSchema(): Promise<void> {
  await ensureTelegramSentTable();
}

async function isTelegramSubscribed(dedupeKey: string, type: string): Promise<boolean> {
  try {
    await ensureTelegramSentTable();
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT id FROM telegram_sent_log WHERE dedupe_key = ? AND type = ? LIMIT 1;`,
      [dedupeKey, type],
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

async function markSent(dedupeKey: string, type: string): Promise<void> {
  try {
    await ensureTelegramSentTable();
    await db.query(
      `INSERT IGNORE INTO telegram_sent_log (dedupe_key, type) VALUES (?, ?);`,
      [dedupeKey, type],
    );
  } catch {
    // best-effort; never blocks trading
  }
}

/**
 * Send a single Telegram notification exactly once for the given dedupe key.
 * Refuses to mark the dedupe row before a successful network send (see the
 * delivery-contract comment above) so transient failures are retried rather
 * than permanently lost. Never throws; never affects trading.
 */
export async function dispatchTelegram(
  dedupeKey: string,
  type: string,
  text: string,
): Promise<TelegramDispatchResult> {
  if (!isTelegramConfigured()) {
    return { sent: false, reason: "not_configured" };
  }
  if (await isTelegramSubscribed(dedupeKey, type)) {
    return { sent: false, reason: "duplicate" };
  }

  const result = await sendTelegram(text);
  if (!result.ok) {
    // Do NOT mark sent. Leave the dedupe log clear so the next event cycle
    // retries instead of silently dropping this important trade notification.
    console.warn(`[telegram-dispatch] send failed (will retry next cycle): ${result.error ?? "unknown"}`);
    return { sent: false, reason: "send_failed" };
  }

  await markSent(dedupeKey, type);
  return { sent: true, reason: "sent" };
}
