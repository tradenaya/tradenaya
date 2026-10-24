import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import { config } from "../../src/config/env.js";
import { dropDatabase, ensureDatabase, runMigrations } from "../../src/db/migrate.js";
import { migrationV2 } from "../../src/db/migration-v2.js";
import { migrations } from "../../src/db/migrations.js";

const DB = "jobdraft_migration_test";
const v1 = migrations.filter((m) => m.version === 1);
const v2 = migrations.some((m) => m.version === 2) ? migrations : [...migrations, migrationV2];

async function conn() {
  const { db } = config();
  return mysql.createConnection({ host: db.host, port: db.port, user: db.user, password: db.password, database: DB });
}

afterAll(async () => {
  await dropDatabase(DB);
});

describe("v1 → v2 migration", () => {
  it("upgrades existing data in place", async () => {
    await dropDatabase(DB);
    await ensureDatabase(DB);
    expect(await runMigrations(DB, v1)).toEqual([1]);

    const c = await conn();
    try {
      await c.query("INSERT INTO users (id, name, email, password_hash) VALUES (1, 'A', 'a@example.org', 'x')");
      await c.query("INSERT INTO profiles (user_id, experience_years, automation_enabled) VALUES (1, 4.5, 1)");
      await c.query("INSERT INTO gmail_connections (user_id, gmail_address, refresh_token_enc, status) VALUES (1, 'a@gmail.com', 'enc', 'connected')");
      // v1 allowed morning + afternoon (+ manual) on the same day.
      await c.query("INSERT INTO runs (id, user_id, slot, run_date, status) VALUES (1, 1, 'morning', '2026-10-18', 'ready_to_send'), (2, 1, 'afternoon', '2026-10-18', 'no_matches'), (3, 1, 'manual', '2026-10-18', 'completed')");
      await c.query(
        "INSERT INTO run_items (run_id, user_id, type, company, job_title, source, to_email, draft_state) VALUES (1, 1, 'draft', 'Nimbus', 'Dev', 'adzuna', 'HR@Nimbus.in', 'in_drafts'), (1, 1, 'draft', 'Kestrel', 'Dev', 'adzuna', 'jobs@kestrel.io', 'sent_or_removed')",
      );
      await c.query("INSERT INTO contacted_companies (user_id, company_key, company_name) VALUES (1, 'nimbus', 'Nimbus')");
    } finally {
      await c.end();
    }

    expect(await runMigrations(DB, v2)).toEqual([2, 3, 4, 5, 6]);
    expect(await runMigrations(DB, v2)).toEqual([]); // idempotent: nothing left to apply

    const d = await conn();
    try {
      const [[p]] = (await d.query("SELECT total_experience_years, run_time, automation_enabled, automation_changed_at FROM profiles")) as unknown as [Record<string, unknown>[]];
      expect(Number(p!.total_experience_years)).toBe(4.5);
      expect(p!.run_time).toBe("09:00:00");
      expect(p!.automation_enabled).toBe(0); // needs the new Gmail permission first
      expect(p!.automation_changed_at).not.toBeNull();
      // v4: existing users get the default sending mode.
      const [[m]] = (await d.query("SELECT send_mode FROM profiles")) as unknown as [Record<string, unknown>[]];
      expect(m!.send_mode).toBe("smart");
      const [modes] = (await d.query("SELECT type, send_mode FROM run_items ORDER BY id")) as unknown as [Record<string, unknown>[]];
      expect(modes.filter((i) => i.type !== "link_only").every((i) => i.send_mode === "smart")).toBe(true);
      const [[g]] = (await d.query("SELECT status FROM gmail_connections")) as unknown as [Record<string, unknown>[]];
      expect(g!.status).toBe("needs_reconnect");
      const [runs] = (await d.query("SELECT id, `trigger`, scheduled_key FROM runs ORDER BY id")) as unknown as [Record<string, unknown>[]];
      expect(runs.map((r) => r.trigger)).toEqual(["scheduled", "manual", "manual"]);
      const [its] = (await d.query("SELECT send_state, outcome, followup_count FROM run_items ORDER BY id")) as unknown as [Record<string, unknown>[]];
      expect(its.map((i) => i.send_state)).toEqual(["none", "removed"]);
      expect(its.every((i) => i.outcome === "open" && i.followup_count === 0)).toBe(true);
      const [emails] = (await d.query("SELECT email FROM contacted_emails ORDER BY email")) as unknown as [Record<string, unknown>[]];
      expect(emails.map((e) => e.email)).toEqual(["hr@nimbus.in", "jobs@kestrel.io"]);
      const [[cc]] = (await d.query("SELECT last_contacted_at FROM contacted_companies")) as unknown as [Record<string, unknown>[]];
      expect(cc!.last_contacted_at).not.toBeNull();
      // A second scheduled run on the same date is impossible now.
      await expect(d.query("INSERT INTO runs (user_id, `trigger`, run_date, status) VALUES (1, 'scheduled', '2026-10-18', 'running')")).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
      // At most 2 follow-ups, enforced by the database.
      await d.query("INSERT INTO followups (run_item_id, user_id, sequence, mode, state, due_at) VALUES (1, 1, 1, 'auto', 'scheduled', NOW())");
      await expect(d.query("INSERT INTO followups (run_item_id, user_id, sequence, mode, state, due_at) VALUES (1, 1, 1, 'auto', 'scheduled', NOW())")).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
      await expect(d.query("INSERT INTO followups (run_item_id, user_id, sequence, mode, state, due_at) VALUES (1, 1, 3, 'auto', 'scheduled', NOW())")).rejects.toMatchObject({
        code: "ER_CHECK_CONSTRAINT_VIOLATED",
      });
    } finally {
      await d.end();
    }
  });
});
