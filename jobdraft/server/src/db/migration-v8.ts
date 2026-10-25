import type { Migration } from "./migrations.js";

const TABLE_OPTS = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

/**
 * v8: sign-up approval.
 * - users.status 'pending': registered, waiting for the admin to approve (no login).
 *   While the Google app is in Testing mode, only emails on its test-user list can
 *   connect Gmail, so the admin adds them there, then approves.
 * - app_settings: admin switches (e.g. whether new sign-ups need approval).
 */
export const migrationV8: Migration = {
  version: 8,
  name: "signup_approval",
  statements: [
    `ALTER TABLE users MODIFY status ENUM('pending','active','inactive') NOT NULL DEFAULT 'active'`,
    `CREATE TABLE IF NOT EXISTS app_settings (
       name VARCHAR(64) NOT NULL,
       value VARCHAR(255) NOT NULL,
       updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
       PRIMARY KEY (name)
     ) ${TABLE_OPTS}`,
  ],
};
