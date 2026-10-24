// Read-only scheduler diagnosis for the server:  npm run diagnose
// Prints, for every user with automation ON, whether today's run is due and
// why not — plus locks, job-source usage and recent runs. IDs only: no emails,
// names, tokens or resume data are printed.
import { DateTime } from "luxon";
import { config, features, loadEnvFile } from "../config/env.js";

loadEnvFile();

const { closePool, query, queryOne } = await import("../db/pool.js");
const { clock } = await import("../lib/clock.js");
const { istDate, IST_TZ } = await import("../lib/time.js");
const { automationOnProfiles, hasAllScopes, hasScheduledRunAt } = await import("../runs/profile.js");
const { explainSchedule } = await import("../runs/runner.js");

const ist = (d: Date | string | null | undefined) =>
  d ? DateTime.fromJSDate(new Date(d), { zone: IST_TZ }).toFormat("yyyy-MM-dd HH:mm") + " IST" : "—";

async function main() {
  const now = clock.now();
  const cfg = config();
  const f = features();
  console.log(`JobDraft scheduler diagnosis — ${ist(now)} (process TZ=${process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone})`);
  console.log(`scheduler enabled: ${cfg.schedulerEnabled}   mock: ${f.mock}   sources: adzuna=${f.adzuna} jsearch=${f.jsearch}   AI: each user's own Gemini key`);
  const mig = await queryOne<{ v: number }>("SELECT MAX(version) AS v FROM schema_migrations");
  console.log(`database schema version: ${mig?.v ?? "?"}`);

  console.log("\nLocks:");
  for (const l of await query<{ name: string; locked_until: Date; owner: string }>("SELECT name, locked_until, owner FROM job_locks ORDER BY name")) {
    const held = new Date(l.locked_until).getTime() > now.getTime();
    console.log(`  ${l.name.padEnd(12)} ${held ? `HELD until ${ist(l.locked_until)} by ${l.owner}` : "free"}`);
  }

  console.log("\nJob-source calls today:");
  const usage = await query<{ source: string; calls: number; exhausted: number }>("SELECT source, calls, exhausted FROM api_usage WHERE day = ?", [istDate(now)]);
  for (const s of ["adzuna", "jsearch"]) {
    const u = usage.find((x) => x.source === s);
    const cap = s === "adzuna" ? cfg.adzunaDailyCap : cfg.jsearchDailyCap;
    console.log(`  ${s.padEnd(8)} ${u?.calls ?? 0}/${cap}${u?.exhausted ? "  (quota exhausted)" : ""}`);
  }

  const stuck = await query<{ id: number; user_id: number; started_at: Date }>("SELECT id, user_id, started_at FROM runs WHERE status = 'running' ORDER BY id");
  if (stuck.length) {
    console.log("\nRuns still marked running:");
    for (const r of stuck) console.log(`  run ${r.id} (user ${r.user_id}) since ${ist(r.started_at)}`);
  }

  const off = await queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM profiles WHERE automation_enabled = 0");
  const users = await automationOnProfiles();
  console.log(`\nUsers with automation ON: ${users.length}   (OFF: ${off?.n ?? 0})`);
  for (const p of users) {
    const ranToday = await hasScheduledRunAt(p.userId, istDate(now), p.runTime);
    const s = explainSchedule(p, ranToday, now);
    console.log(`\n  user ${p.userId}`);
    console.log(`    run time ${p.runTime} IST · ran today at this time: ${ranToday ? "yes" : "no"} · next run: ${ist(s.nextRunAt)} · due now: ${s.dueNow ? "YES" : "no"}`);
    console.log(`    gmail: ${p.gmailStatus ?? "not connected"} · all permissions: ${hasAllScopes(p) ? "yes" : "NO"} · refresh token: ${p.refreshTokenEnc ? "yes" : "NO"}`);
    console.log(`    roles: ${p.targetRoles.length} · locations: ${p.locations.length} · resume: ${p.resumePublicId ? "yes" : "NO"}`);
    console.log(`    settings last changed: run time ${ist(p.runTimeChangedAt)}, automation ${ist(p.automationChangedAt)}`);
    console.log(`    ${s.missing.length ? `BLOCKED: ${s.missing.join("; ")}` : "setup complete — nothing blocks scheduled runs"}`);
    const runs = await query<{ id: number; trigger: string; status: string; started_at: Date; error_message: string | null }>(
      "SELECT id, `trigger`, status, started_at, error_message FROM runs WHERE user_id = ? ORDER BY id DESC LIMIT 3",
      [p.userId],
    );
    if (!runs.length) console.log("    no runs at all");
    for (const r of runs) console.log(`    run ${r.id} ${r.trigger} ${r.status} ${ist(r.started_at)}${r.error_message ? ` — ${r.error_message.slice(0, 120)}` : ""}`);
  }
}

try {
  await main();
} catch (err) {
  console.error("diagnose failed:", (err as Error).message);
  process.exitCode = 1;
} finally {
  await closePool();
}
