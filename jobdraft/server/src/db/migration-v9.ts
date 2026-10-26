import type { Migration } from "./migrations.js";

const TABLE_OPTS = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

/**
 * v9: JSearch quota sharing and personal keys; cover notes for "apply via link".
 * - profiles.rapidapi_key_*: a user's own (optional) RapidAPI key for JSearch,
 *   stored encrypted like the Gemini key. It gives them their own monthly quota.
 * - jsearch_user_usage: JSearch calls per user and day, on the shared key or
 *   their own, so the shared monthly quota is split fairly between users.
 * - run_items.job_description / cover_note: a suitable posting without an email
 *   keeps its description, so a cover note for the application form can be
 *   written on request.
 */
export const migrationV9: Migration = {
  version: 9,
  name: "jsearch_keys_and_cover_notes",
  statements: [
    `ALTER TABLE profiles
       ADD COLUMN rapidapi_key_enc TEXT NULL,
       ADD COLUMN rapidapi_key_hint VARCHAR(8) NULL,
       ADD COLUMN rapidapi_key_status ENUM('valid','not_subscribed','invalid') NULL,
       ADD COLUMN rapidapi_key_updated_at DATETIME(3) NULL`,
    `CREATE TABLE IF NOT EXISTS jsearch_user_usage (
       user_id INT UNSIGNED NOT NULL,
       day DATE NOT NULL,
       own_key TINYINT(1) NOT NULL,
       calls INT UNSIGNED NOT NULL DEFAULT 0,
       exhausted TINYINT(1) NOT NULL DEFAULT 0,
       PRIMARY KEY (user_id, day, own_key),
       KEY idx_jsearch_usage_day (day),
       CONSTRAINT fk_jsearch_usage_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
     ) ${TABLE_OPTS}`,
    `ALTER TABLE run_items
       ADD COLUMN job_description MEDIUMTEXT NULL,
       ADD COLUMN cover_note TEXT NULL`,
  ],
};
