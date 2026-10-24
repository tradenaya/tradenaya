import type { Migration } from "./migrations.js";

const TABLE_OPTS = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

/**
 * v3: run diagnostics and smarter job search.
 * - runs.funnel: what each run fetched, filtered, checked and created (shown in History)
 * - run_items.query_variant: which search produced the posting
 * - api_usage: daily call counts per job source (Adzuna / JSearch free-tier caps)
 * - search_rotation: when each JSearch (role, city, variant) was last searched
 */
export const migrationV3: Migration = {
  version: 3,
  name: "run_funnel_search_usage",
  statements: [
    `ALTER TABLE runs ADD COLUMN funnel JSON NULL AFTER error_message`,
    `ALTER TABLE run_items ADD COLUMN query_variant VARCHAR(32) NULL AFTER source`,
    `CREATE TABLE IF NOT EXISTS api_usage (
       source VARCHAR(16) NOT NULL,
       day DATE NOT NULL,
       calls INT UNSIGNED NOT NULL DEFAULT 0,
       exhausted TINYINT(1) NOT NULL DEFAULT 0,
       PRIMARY KEY (source, day)
     ) ${TABLE_OPTS}`,
    `CREATE TABLE IF NOT EXISTS search_rotation (
       source VARCHAR(16) NOT NULL,
       combo_key VARCHAR(191) NOT NULL,
       last_queried_at DATETIME(3) NOT NULL,
       PRIMARY KEY (source, combo_key)
     ) ${TABLE_OPTS}`,
  ],
};
