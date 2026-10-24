import type { Migration } from "./migrations.js";

/**
 * v6: one scheduled run per user per IST day **per run time** (was: per day).
 * After today's 9:00 run, moving the run time to a later time today (e.g. 3 PM)
 * runs today at the new time; the same time slot still never runs twice.
 * Rows without scheduled_for (very old) keep the old per-day key.
 */
export const migrationV6: Migration = {
  version: 6,
  name: "scheduled_run_per_slot",
  statements: [
    "ALTER TABLE runs DROP INDEX uq_runs_user_scheduled",
    "ALTER TABLE runs DROP COLUMN scheduled_key",
    `ALTER TABLE runs
       ADD COLUMN scheduled_key VARCHAR(20) GENERATED ALWAYS AS (
         CASE WHEN \`trigger\` = 'scheduled' THEN CONCAT(run_date, ' ', IFNULL(LEFT(CAST(TIME(scheduled_for) AS CHAR), 5), '--:--')) ELSE NULL END
       ) STORED AFTER scheduled_for,
       ADD UNIQUE KEY uq_runs_user_scheduled (user_id, scheduled_key)`,
  ],
};
