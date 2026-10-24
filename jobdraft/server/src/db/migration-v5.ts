import type { Migration } from "./migrations.js";

/**
 * v5: each user's own Gemini API key (the server's key is no longer used).
 * Stored encrypted (AES-256-GCM, like Gmail tokens); only the last 4
 * characters are kept in clear, to show which key is saved.
 */
export const migrationV5: Migration = {
  version: 5,
  name: "user_gemini_key",
  statements: [
    `ALTER TABLE profiles
       ADD COLUMN gemini_key_enc TEXT NULL,
       ADD COLUMN gemini_key_hint VARCHAR(8) NULL,
       ADD COLUMN gemini_key_status ENUM('valid','invalid') NULL,
       ADD COLUMN gemini_key_updated_at DATETIME(3) NULL`,
  ],
};
