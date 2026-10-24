// Ordered migrations. Append new entries with the next version number; never
// edit an applied one. Every statement must be safe to re-run.
import { migrationV2 } from "./migration-v2.js";
import { migrationV3 } from "./migration-v3.js";
import { migrationV4 } from "./migration-v4.js";
import { migrationV5 } from "./migration-v5.js";
import { migrationV6 } from "./migration-v6.js";

export interface Migration {
  version: number;
  name: string;
  statements: string[];
}

const TABLE_OPTS = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

export const migrations: Migration[] = [
  {
    version: 1,
    name: "initial_schema",
    statements: [
      `CREATE TABLE IF NOT EXISTS users (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(254) NOT NULL,
        password_hash VARCHAR(100) NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_users_email (email)
      ) ${TABLE_OPTS}`,

      `CREATE TABLE IF NOT EXISTS profiles (
        user_id INT UNSIGNED NOT NULL,
        resume_public_id VARCHAR(255) NULL,
        resume_url VARCHAR(1024) NULL,
        resume_file_name VARCHAR(255) NULL,
        resume_text MEDIUMTEXT NULL,
        resume_data JSON NULL,
        resume_uploaded_at DATETIME(3) NULL,
        experience_years DECIMAL(4,1) NULL,
        target_roles JSON NULL,
        locations JSON NULL,
        expected_salary_lpa DECIMAL(6,2) NULL,
        automation_enabled TINYINT(1) NOT NULL DEFAULT 0,
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (user_id),
        CONSTRAINT fk_profiles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ${TABLE_OPTS}`,

      `CREATE TABLE IF NOT EXISTS gmail_connections (
        user_id INT UNSIGNED NOT NULL,
        gmail_address VARCHAR(254) NOT NULL,
        refresh_token_enc TEXT NULL,
        status ENUM('connected','disconnected','error') NOT NULL DEFAULT 'connected',
        connected_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        last_error VARCHAR(500) NULL,
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (user_id),
        CONSTRAINT fk_gmail_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ${TABLE_OPTS}`,

      // scheduled_slot is NULL for manual runs, so the unique key below blocks a
      // second morning/afternoon run for the same user and day but allows any
      // number of manual runs (NULLs never collide in a UNIQUE index).
      `CREATE TABLE IF NOT EXISTS runs (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id INT UNSIGNED NOT NULL,
        slot ENUM('morning','afternoon','manual') NOT NULL,
        run_date DATE NOT NULL,
        scheduled_slot VARCHAR(10) GENERATED ALWAYS AS (CASE WHEN slot = 'manual' THEN NULL ELSE slot END) STORED,
        status ENUM('running','ready_to_send','no_matches','failed','completed') NOT NULL DEFAULT 'running',
        started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        finished_at DATETIME(3) NULL,
        drafts_count INT UNSIGNED NOT NULL DEFAULT 0,
        link_only_count INT UNSIGNED NOT NULL DEFAULT 0,
        jobs_considered INT UNSIGNED NOT NULL DEFAULT 0,
        error_message VARCHAR(500) NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_runs_user_day_slot (user_id, run_date, scheduled_slot),
        KEY idx_runs_user_started (user_id, started_at),
        KEY idx_runs_status (status),
        CONSTRAINT fk_runs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ${TABLE_OPTS}`,

      `CREATE TABLE IF NOT EXISTS run_items (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        run_id BIGINT UNSIGNED NOT NULL,
        user_id INT UNSIGNED NOT NULL,
        type ENUM('draft','link_only') NOT NULL,
        company VARCHAR(255) NOT NULL,
        job_title VARCHAR(255) NOT NULL,
        location VARCHAR(255) NULL,
        job_url VARCHAR(2048) NULL,
        source VARCHAR(32) NOT NULL,
        to_email VARCHAR(254) NULL,
        subject VARCHAR(255) NULL,
        body_preview VARCHAR(600) NULL,
        gmail_draft_id VARCHAR(128) NULL,
        draft_state ENUM('in_drafts','sent_or_removed','unknown') NULL,
        note VARCHAR(300) NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        KEY idx_items_run (run_id),
        KEY idx_items_user_state (user_id, draft_state),
        CONSTRAINT fk_items_run FOREIGN KEY (run_id) REFERENCES runs (id) ON DELETE CASCADE,
        CONSTRAINT fk_items_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ${TABLE_OPTS}`,

      `CREATE TABLE IF NOT EXISTS contacted_companies (
        user_id INT UNSIGNED NOT NULL,
        company_key VARCHAR(191) NOT NULL,
        company_name VARCHAR(255) NOT NULL,
        last_drafted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (user_id, company_key),
        CONSTRAINT fk_contacted_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ${TABLE_OPTS}`,

      `CREATE TABLE IF NOT EXISTS seen_jobs (
        user_id INT UNSIGNED NOT NULL,
        job_key VARCHAR(191) NOT NULL,
        seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (user_id, job_key),
        KEY idx_seen_at (seen_at),
        CONSTRAINT fk_seen_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ${TABLE_OPTS}`,

      // Shared across users: one fetch per (query, location, day, slot).
      `CREATE TABLE IF NOT EXISTS job_cache (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        query_key VARCHAR(191) NOT NULL,
        location_key VARCHAR(191) NOT NULL,
        run_date DATE NOT NULL,
        slot VARCHAR(16) NOT NULL,
        jobs JSON NOT NULL,
        sources JSON NULL,
        fetched_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_cache (query_key, location_key, run_date, slot),
        KEY idx_cache_fetched (fetched_at)
      ) ${TABLE_OPTS}`,
    ],
  },
  migrationV2,
  migrationV3,
  migrationV4,
  migrationV5,
  migrationV6,
];
