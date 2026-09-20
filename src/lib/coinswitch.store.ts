import { db } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto";

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
        api_key_masked TEXT DEFAULT NULL,
      api_secret_enc TEXT NOT NULL,
        valid_until DATETIME NULL,
      status CHAR(1) NOT NULL DEFAULT 'A',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_user (user_id),
      CONSTRAINT coinswitch_keys_user_fk FOREIGN KEY (user_id) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

export async function saveKeysForUser(userId: number, apiKey: string, apiSecret: string) {
  await ensureTable();
  const api_secret_enc = encrypt(apiSecret);
  const mask = (k: string) => {
    if (!k) return null;
    const s = String(k);
    if (s.length <= 8) return s;
    return `${s.slice(0, 4)}...${s.slice(-4)}`;
  };
  const api_key_masked = mask(apiKey);
  // upsert
  await db.query(
    `INSERT INTO coinswitch_keys (user_id, api_key, api_key_masked, api_secret_enc, status) VALUES (?, ?, ?, ?, 'A') ON DUPLICATE KEY UPDATE api_key=VALUES(api_key), api_key_masked=VALUES(api_key_masked), api_secret_enc=VALUES(api_secret_enc), status='A'`,
    [userId, apiKey, api_key_masked, api_secret_enc]
  );
}

export async function getKeyMetaForUser(userId: number): Promise<{ apiKeyMasked: string | null; status: string; createdAt: Date; validUntil: Date | null } | null> {
  await ensureTable();
  const [rows]: any = await db.query(`SELECT api_key_masked, status, created_at, valid_until FROM coinswitch_keys WHERE user_id = ? LIMIT 1`, [userId]);
  if (!rows || rows.length === 0) return null;
  const row = rows[0];
  return {
    apiKeyMasked: row.api_key_masked ?? null,
    status: row.status,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
    validUntil: row.valid_until ? (row.valid_until instanceof Date ? row.valid_until : new Date(row.valid_until)) : null,
  };
}

export async function setExpiryForUser(userId: number, validUntil: string | null): Promise<void> {
  await ensureTable();
  const dt = validUntil ? new Date(validUntil) : null;
  await db.query(`UPDATE coinswitch_keys SET valid_until = ? WHERE user_id = ?`, [dt ? dt.toISOString().slice(0, 19).replace('T', ' ') : null, userId]);
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

export async function setStatusForUser(userId: number, status: "A" | "I") {
  await ensureTable();
  await db.query(`UPDATE coinswitch_keys SET status = ? WHERE user_id = ?`, [status, userId]);
}
