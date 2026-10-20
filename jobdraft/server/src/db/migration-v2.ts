import type { Migration } from "./migrations.js";

const TABLE_OPTS = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

/**
 * v2: per-user daily run time, automation switch, excluded companies,
 * auto-send queue, Gmail tracking and (at most two) follow-ups.
 * Existing data is converted in place; run history and users are kept.
 */
export const migrationV2: Migration = {
  version: 2,
  name: "daily_runs_sending_followups",
  statements: [
    // ── profiles ────────────────────────────────────────────────────────────
    `ALTER TABLE profiles
       CHANGE experience_years total_experience_years DECIMAL(4,1) NULL,
       ADD COLUMN run_time TIME NOT NULL DEFAULT '09:00:00' AFTER expected_salary_lpa,
       ADD COLUMN run_time_changed_at DATETIME(3) NULL AFTER run_time,
       ADD COLUMN automation_changed_at DATETIME(3) NULL AFTER automation_enabled`,

    // ── gmail_connections ───────────────────────────────────────────────────
    `ALTER TABLE gmail_connections
       MODIFY status ENUM('connected','disconnected','error','needs_reconnect') NOT NULL DEFAULT 'connected',
       ADD COLUMN granted_scopes VARCHAR(1000) NULL AFTER refresh_token_enc,
       ADD COLUMN send_paused_until DATETIME(3) NULL,
       ADD COLUMN next_send_after DATETIME(3) NULL`,
    // v1 connections lack the gmail.metadata scope (tracking), so they must reconnect,
    // and automation starts OFF until the user turns it on again with all permissions.
    `UPDATE gmail_connections SET status = 'needs_reconnect',
       last_error = 'JobDraft now also needs permission to read email headers (to track replies). Please reconnect Gmail.'
     WHERE status = 'connected'`,
    `UPDATE profiles SET automation_enabled = 0, automation_changed_at = UTC_TIMESTAMP(3) WHERE automation_enabled = 1`,

    // ── excluded_companies ──────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS excluded_companies (
       id INT UNSIGNED NOT NULL AUTO_INCREMENT,
       user_id INT UNSIGNED NOT NULL,
       company_name VARCHAR(255) NOT NULL,
       company_key VARCHAR(191) NOT NULL,
       source ENUM('resume','manual') NOT NULL,
       created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
       PRIMARY KEY (id),
       UNIQUE KEY uq_excluded (user_id, company_key),
       CONSTRAINT fk_excluded_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
     ) ${TABLE_OPTS}`,

    // ── runs: slot → trigger, one scheduled run per user per IST date ──────
    "ALTER TABLE runs ADD COLUMN `trigger` ENUM('scheduled','manual') NOT NULL DEFAULT 'manual' AFTER user_id",
    // v1 had two scheduled slots a day; keep the morning one as "scheduled".
    "UPDATE runs SET `trigger` = IF(slot = 'morning', 'scheduled', 'manual')",
    `ALTER TABLE runs DROP INDEX uq_runs_user_day_slot, DROP COLUMN scheduled_slot, DROP COLUMN slot`,
    `ALTER TABLE runs
       ADD COLUMN scheduled_for DATETIME(3) NULL AFTER run_date,
       ADD COLUMN scheduled_key DATE GENERATED ALWAYS AS (CASE WHEN \`trigger\` = 'scheduled' THEN run_date ELSE NULL END) STORED AFTER scheduled_for,
       ADD UNIQUE KEY uq_runs_user_scheduled (user_id, scheduled_key),
       MODIFY status ENUM('running','ready_to_send','sending','sent','no_matches','failed','completed') NOT NULL DEFAULT 'running',
       ADD COLUMN auto_send_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER drafts_count,
       ADD COLUMN sent_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER auto_send_count`,

    // ── run_items: one row per application (or link-only job) ──────────────
    `ALTER TABLE run_items
       MODIFY type ENUM('draft','auto_send','link_only') NOT NULL,
       ADD COLUMN company_key VARCHAR(191) NOT NULL DEFAULT '' AFTER company,
       ADD COLUMN posted_at DATETIME(3) NULL AFTER source,
       ADD COLUMN confidence TINYINT UNSIGNED NULL AFTER body_preview,
       ADD COLUMN gmail_thread_id VARCHAR(128) NULL AFTER gmail_draft_id,
       ADD COLUMN gmail_message_id VARCHAR(128) NULL AFTER gmail_thread_id,
       ADD COLUMN rfc_message_id VARCHAR(255) NULL AFTER gmail_message_id,
       ADD COLUMN send_state ENUM('none','scheduled','sending','sent','cancelled','failed','skipped','removed') NOT NULL DEFAULT 'none',
       ADD COLUMN send_at DATETIME(3) NULL,
       ADD COLUMN sent_at DATETIME(3) NULL,
       ADD COLUMN send_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
       ADD COLUMN sending_started_at DATETIME(3) NULL,
       ADD COLUMN skip_reason VARCHAR(300) NULL,
       ADD COLUMN reply_state ENUM('none','replied','bounced') NOT NULL DEFAULT 'none',
       ADD COLUMN replied_at DATETIME(3) NULL,
       ADD COLUMN last_checked_at DATETIME(3) NULL,
       ADD COLUMN followup_mode ENUM('auto','draft') NOT NULL DEFAULT 'draft',
       ADD COLUMN followups_stopped TINYINT(1) NOT NULL DEFAULT 0,
       ADD COLUMN followup_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
       ADD COLUMN outcome ENUM('open','replied','bounced','no_response','stopped') NOT NULL DEFAULT 'open',
       ADD CONSTRAINT chk_items_followup_count CHECK (followup_count <= 2),
       ADD KEY idx_items_send (send_state, send_at),
       ADD KEY idx_items_tracking (user_id, outcome, created_at)`,
    `UPDATE run_items SET send_state = IF(draft_state = 'sent_or_removed', 'removed', 'none'), company_key = LEFT(LOWER(company), 191)`,
    `ALTER TABLE run_items DROP INDEX idx_items_user_state, DROP COLUMN draft_state`,

    // ── followups: max 2 per application, enforced by the database ─────────
    `CREATE TABLE IF NOT EXISTS followups (
       id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
       run_item_id BIGINT UNSIGNED NOT NULL,
       user_id INT UNSIGNED NOT NULL,
       sequence TINYINT UNSIGNED NOT NULL,
       mode ENUM('auto','draft') NOT NULL,
       state ENUM('scheduled','draft_created','sending','sent','cancelled','skipped','not_needed','expired','failed') NOT NULL,
       due_at DATETIME(3) NOT NULL,
       send_at DATETIME(3) NULL,
       gmail_draft_id VARCHAR(128) NULL,
       gmail_message_id VARCHAR(128) NULL,
       rfc_message_id VARCHAR(255) NULL,
       subject VARCHAR(255) NULL,
       body_preview VARCHAR(600) NULL,
       sent_at DATETIME(3) NULL,
       attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
       sending_started_at DATETIME(3) NULL,
       skip_reason VARCHAR(300) NULL,
       created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
       PRIMARY KEY (id),
       UNIQUE KEY uq_followup_seq (run_item_id, sequence),
       KEY idx_followups_send (state, send_at),
       KEY idx_followups_user (user_id, created_at),
       CONSTRAINT chk_followup_sequence CHECK (sequence IN (1, 2)),
       CONSTRAINT fk_followups_item FOREIGN KEY (run_item_id) REFERENCES run_items (id) ON DELETE CASCADE,
       CONSTRAINT fk_followups_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
     ) ${TABLE_OPTS}`,

    // ── contacted companies / emails ────────────────────────────────────────
    `ALTER TABLE contacted_companies CHANGE last_drafted_at last_contacted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)`,
    `CREATE TABLE IF NOT EXISTS contacted_emails (
       user_id INT UNSIGNED NOT NULL,
       email VARCHAR(254) NOT NULL,
       first_contacted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
       PRIMARY KEY (user_id, email),
       CONSTRAINT fk_contacted_emails_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
     ) ${TABLE_OPTS}`,
    `INSERT IGNORE INTO contacted_emails (user_id, email, first_contacted_at)
       SELECT user_id, LOWER(to_email), MIN(created_at) FROM run_items WHERE to_email IS NOT NULL GROUP BY user_id, LOWER(to_email)`,

    // ── job_cache: per (source, query, location), reused for 6 hours ───────
    `DROP TABLE IF EXISTS job_cache`,
    `CREATE TABLE job_cache (
       id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
       source VARCHAR(16) NOT NULL,
       query VARCHAR(191) NOT NULL,
       location VARCHAR(191) NOT NULL,
       payload JSON NOT NULL,
       fetched_at DATETIME(3) NOT NULL,
       PRIMARY KEY (id),
       UNIQUE KEY uq_job_cache (source, query, location),
       KEY idx_job_cache_fetched (fetched_at)
     ) ${TABLE_OPTS}`,

    // ── job_locks: cron jobs never overlap, across processes ────────────────
    `CREATE TABLE IF NOT EXISTS job_locks (
       name VARCHAR(64) NOT NULL,
       locked_until DATETIME(3) NOT NULL,
       owner VARCHAR(64) NOT NULL,
       PRIMARY KEY (name)
     ) ${TABLE_OPTS}`,
  ],
};
