import type { Migration } from "./migrations.js";

/**
 * v4: per-user sending mode.
 * - profiles.send_mode (existing users get 'smart', the previous behaviour)
 * - run_items.send_mode: the mode used when the email was created
 * - run_items.sent_by: who sent it — 'auto' (the send queue) or 'user' (by hand in Gmail)
 */
export const migrationV4: Migration = {
  version: 4,
  name: "send_mode",
  statements: [
    `ALTER TABLE profiles
       ADD COLUMN send_mode ENUM('drafts_only','smart','send_all','send_all_instant') NOT NULL DEFAULT 'smart' AFTER automation_changed_at,
       ADD COLUMN send_mode_changed_at DATETIME(3) NULL AFTER send_mode`,
    `ALTER TABLE run_items
       ADD COLUMN send_mode ENUM('drafts_only','smart','send_all','send_all_instant') NULL AFTER type,
       ADD COLUMN sent_by ENUM('auto','user') NULL AFTER sent_at`,
    // Before v4 every email was created in what is now "smart" mode.
    `UPDATE run_items SET send_mode = 'smart' WHERE type <> 'link_only'`,
    // The queue only ever sent auto-send items (it counts attempts); anything else that was sent, the user sent.
    `UPDATE run_items SET sent_by = IF(type = 'auto_send' AND send_attempts > 0, 'auto', 'user') WHERE send_state = 'sent'`,
  ],
};
