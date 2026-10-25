import type { Migration } from "./migrations.js";

const TABLE_OPTS = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

/**
 * v7: admin.
 * - users.role: 'admin' is granted ONLY from the server shell (npm run admin -- grant <email>);
 *   there is no sign-up path and no default admin account.
 * - users.status: an admin can deactivate a user (no login, no runs, no sends).
 * - admin_audit: every admin action, who did it, to whom, when.
 */
export const migrationV7: Migration = {
  version: 7,
  name: "admin",
  statements: [
    `ALTER TABLE users
       ADD COLUMN role ENUM('user','admin') NOT NULL DEFAULT 'user' AFTER password_hash,
       ADD COLUMN status ENUM('active','inactive') NOT NULL DEFAULT 'active' AFTER role,
       ADD COLUMN status_changed_at DATETIME(3) NULL AFTER status`,
    `CREATE TABLE IF NOT EXISTS admin_audit (
       id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
       admin_id INT UNSIGNED NULL,
       action VARCHAR(40) NOT NULL,
       target_user_id INT UNSIGNED NULL,
       target_email VARCHAR(254) NULL,
       detail VARCHAR(300) NULL,
       created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
       PRIMARY KEY (id),
       KEY idx_audit_created (created_at)
     ) ${TABLE_OPTS}`,
  ],
};
