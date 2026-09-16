import { db } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto";

/** Convert an ISO-8601 or datetime-local value to MySQL "YYYY-MM-DD HH:MM:SS". */
function toMySQLDatetime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export interface CoinSwitchRow {
  id: number;
  user_id: number;
  api_key: string;
  api_secret_enc: string;
  status: "A" | "I";
  created_at: Date;
}

export async function ensureTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS coinswitch_keys (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      api_key TEXT NOT NULL,
      api_secret_enc TEXT NOT NULL,
      status CHAR(1) NOT NULL DEFAULT 'A',
      valid_until DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_user (user_id),
      CONSTRAINT coinswitch_keys_user_fk FOREIGN KEY (user_id) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  try {
    await db.query(`ALTER TABLE coinswitch_keys ADD COLUMN valid_until DATETIME NULL AFTER created_at`);
  } catch {
    // Column already exists — may have been created as DATE; widen silently.
    try {
      await db.query(`ALTER TABLE coinswitch_keys MODIFY COLUMN valid_until DATETIME NULL`);
    } catch { /* already DATETIME or column missing */ }
  }
}

export async function saveKeysForUser(userId: number, apiKey: string, apiSecret: string, validUntil?: string | null) {
  await ensureTable();
  const api_secret_enc = encrypt(apiSecret);
  const vu = validUntil ? toMySQLDatetime(validUntil) : null;
  // upsert (refreshes created_at so the renewal timer resets when keys rotate)
  await db.query(
    `INSERT INTO coinswitch_keys (user_id, api_key, api_secret_enc, status, valid_until) VALUES (?, ?, ?, 'A', ?) ON DUPLICATE KEY UPDATE api_key=VALUES(api_key), api_secret_enc=VALUES(api_secret_enc), status='A', valid_until=VALUES(valid_until), created_at=CURRENT_TIMESTAMP`,
    [userId, apiKey, api_secret_enc, vu]
  );
}

export async function getKeysForUser(userId: number): Promise<{ apiKey: string; apiSecret: string; status: string } | null> {
  await ensureTable();
  const [rows]: any = await db.query(`SELECT * FROM coinswitch_keys WHERE user_id = ? LIMIT 1`, [userId]);
  if (!rows || rows.length === 0) return null;
  const row = rows[0];
  try {
    return { apiKey: row.api_key, apiSecret: decrypt(row.api_secret_enc), status: row.status };
  } catch (e) {
    console.error("Failed to decrypt coinswitch secret", e);
    return null;
  }
}

/**
 * Key metadata WITHOUT the secret (or the full key) — safe to return to the
 * browser so the UI can show when the keys were linked and when to renew.
 */
export async function getKeyMetaForUser(userId: number): Promise<{ apiKeyMasked: string; status: string; createdAt: Date; validUntil: Date | null } | null> {
  await ensureTable();
  const [rows]: any = await db.query(
    `SELECT api_key, status, created_at, valid_until FROM coinswitch_keys WHERE user_id = ? LIMIT 1`,
    [userId],
  );
  if (!rows || rows.length === 0) return null;
  const row = rows[0];
  const raw = String(row.api_key ?? "");
  const masked =
    raw.length <= 8
      ? "••••••••"
      : `${raw.slice(0, 6)}••••••••${raw.slice(-4)}`;
  return {
    apiKeyMasked: masked,
    status: row.status,
    createdAt: new Date(row.created_at),
    validUntil: row.valid_until ? new Date(row.valid_until) : null,
  };
}

export async function setStatusForUser(userId: number, status: "A" | "I") {
  await ensureTable();
  await db.query(`UPDATE coinswitch_keys SET status = ? WHERE user_id = ?`, [status, userId]);
}

export async function setExpiryForUser(userId: number, validUntil: string) {
  await ensureTable();
  await db.query(`UPDATE coinswitch_keys SET valid_until = ? WHERE user_id = ?`, [toMySQLDatetime(validUntil), userId]);
}
