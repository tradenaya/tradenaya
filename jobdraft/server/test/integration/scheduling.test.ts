import { DateTime } from "luxon";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, execute, query } from "../../src/db/pool.js";
import { clock, MINUTE } from "../../src/lib/clock.js";
import { withJobLock } from "../../src/lib/job-locks.js";
import { runDueUsers } from "../../src/runs/runner.js";
import { istFmt, readyUser, resetDb, setIst } from "../helpers.js";

beforeEach(resetDb);
afterAll(closePool);

const scheduledRuns = (userId?: number) =>
  query<{ user_id: number; run_date: string; scheduled_for: Date; started_at: Date }>(
    `SELECT user_id, run_date, scheduled_for, started_at FROM runs WHERE \`trigger\` = 'scheduled' ${userId ? "AND user_id = ?" : ""} ORDER BY id`,
    userId ? [userId] : [],
  );

/** Simulates the per-minute cron between two IST times. */
async function tickEveryMinute(fromIst: string, toIst: string) {
  let t = DateTime.fromISO(fromIst, { zone: "Asia/Kolkata" }).toJSDate().getTime();
  const end = DateTime.fromISO(toIst, { zone: "Asia/Kolkata" }).toJSDate().getTime();
  for (; t <= end; t += MINUTE) {
    clock.set(t);
    await runDueUsers(new Date(t));
  }
}

describe("daily scheduling (Asia/Kolkata)", () => {
  it("runs users with different run times once each, at their own time; no saved time = 9:00 AM", async () => {
    setIst("2026-11-01T20:00");
    const a = await readyUser({ prefs: { run_time: "09:00" } });
    const b = await readyUser({ prefs: { run_time: "14:30", target_roles: ["Backend Developer"] } });
    const c = await readyUser({ prefs: { run_time: undefined, target_roles: ["Software Engineer"] } }); // default
    await tickEveryMinute("2026-11-02T08:55", "2026-11-02T09:05");
    await tickEveryMinute("2026-11-02T14:25", "2026-11-02T14:35");
    const runs = (await scheduledRuns()).sort((x, y) => x.user_id - y.user_id);
    expect(runs.map((r) => [r.user_id, istFmt(r.scheduled_for), istFmt(r.started_at)])).toEqual([
      [a.user.id, "2026-11-02 09:00", "2026-11-02 09:00"],
      [b.user.id, "2026-11-02 14:30", "2026-11-02 14:30"],
      [c.user.id, "2026-11-02 09:00", "2026-11-02 09:00"],
    ]);
  });

  it("exactly one scheduled run per user per IST day — repeated ticks, two parallel workers, restarts", async () => {
    setIst("2026-11-01T20:00");
    const { user } = await readyUser();
    const at9 = setIst("2026-11-02T09:00");
    const [w1, w2] = await Promise.all([runDueUsers(at9), runDueUsers(at9)]);
    expect(w1.claimed + w2.claimed).toBe(1);
    // "Restart" (no in-memory state) and keep ticking for the rest of the day.
    await tickEveryMinute("2026-11-02T09:01", "2026-11-02T09:20");
    setIst("2026-11-02T11:59");
    await runDueUsers();
    expect(await scheduledRuns(user.id)).toHaveLength(1);
    // Next day runs again.
    setIst("2026-11-03T09:00");
    await runDueUsers();
    expect((await scheduledRuns(user.id)).map((r) => r.run_date)).toEqual(["2026-11-02", "2026-11-03"]);
  });

  it("a missed run within 3 hours runs once on startup; beyond 3 hours it is skipped until tomorrow", async () => {
    setIst("2026-11-01T20:00");
    const late = await readyUser({ prefs: { run_time: "09:00" } });
    const tooLate = await readyUser({ prefs: { run_time: "07:00" } });
    // Server was down from 06:00 and comes back at 11:30.
    setIst("2026-11-02T11:30");
    await runDueUsers();
    await tickEveryMinute("2026-11-02T11:31", "2026-11-02T11:35");
    expect(await scheduledRuns(late.user.id)).toHaveLength(1);
    expect(await scheduledRuns(tooLate.user.id)).toHaveLength(0);
    setIst("2026-11-03T07:00");
    await runDueUsers();
    expect((await scheduledRuns(tooLate.user.id)).map((r) => r.run_date)).toEqual(["2026-11-03"]);
  });

  it("after today's 9:00 run, moving the time to a later time today runs today at the new time; a time already past waits for tomorrow", async () => {
    setIst("2026-11-01T20:00");
    const { user, agent } = await readyUser();
    setIst("2026-11-02T09:00");
    await runDueUsers();
    const prefs = (run_time: string) =>
      agent.put("/api/profile/preferences").send({ target_roles: ["Software Engineer", "Backend Developer"], locations: ["Bengaluru, Karnataka"], expected_salary_lpa: 12, run_time }).expect(200);
    setIst("2026-11-02T10:00");
    // The "Next run" preview and the saved result agree: today at 3 PM.
    expect(istFmt((await agent.get("/api/profile/next-run?run_time=15:00").expect(200)).body.at)).toBe("2026-11-02 15:00");
    expect(istFmt((await prefs("15:00")).body.nextRunAt)).toBe("2026-11-02 15:00");
    await tickEveryMinute("2026-11-02T14:58", "2026-11-02T15:03");
    expect((await scheduledRuns(user.id)).map((r) => istFmt(r.scheduled_for))).toEqual(["2026-11-02 09:00", "2026-11-02 15:00"]);
    // The same time slot never runs twice: back to 9:00 (already ran today) → tomorrow.
    setIst("2026-11-02T15:30");
    expect(istFmt((await prefs("09:00")).body.nextRunAt)).toBe("2026-11-03 09:00");
    // A later slot today that hasn't come yet still works…
    expect(istFmt((await prefs("18:00")).body.nextRunAt)).toBe("2026-11-02 18:00");
    // …but a time that has already passed today waits for tomorrow (never an immediate run).
    setIst("2026-11-02T18:30");
    expect(istFmt((await prefs("17:00")).body.nextRunAt)).toBe("2026-11-03 17:00");
    await tickEveryMinute("2026-11-02T18:30", "2026-11-02T18:35");
    expect(await scheduledRuns(user.id)).toHaveLength(2);
  });

  it("time moved later today (before today's run) → runs today at the new time; earlier than now → tomorrow", async () => {
    setIst("2026-11-01T20:00");
    const a = await readyUser();
    const b = await readyUser();
    setIst("2026-11-02T08:00");
    const prefs = { target_roles: ["Software Engineer"], locations: ["Bengaluru, Karnataka"], expected_salary_lpa: 12 };
    const later = await a.agent.put("/api/profile/preferences").send({ ...prefs, run_time: "13:00" }).expect(200);
    expect(istFmt(later.body.nextRunAt)).toBe("2026-11-02 13:00");
    const earlier = await b.agent.put("/api/profile/preferences").send({ ...prefs, run_time: "07:30" }).expect(200);
    expect(istFmt(earlier.body.nextRunAt)).toBe("2026-11-03 07:30");
    // The live "Next run" hint uses the same function.
    const hint = await a.agent.get("/api/profile/next-run?run_time=07:45").expect(200);
    expect(istFmt(hint.body.at)).toBe("2026-11-03 07:45");
    await tickEveryMinute("2026-11-02T08:01", "2026-11-02T08:03"); // saving never triggers an immediate run
    expect(await scheduledRuns()).toHaveLength(0);
    setIst("2026-11-02T13:00");
    await runDueUsers();
    expect((await scheduledRuns()).map((r) => r.user_id)).toEqual([a.user.id]);
  });

  it("reuses the job cache across users within 6 hours", async () => {
    setIst("2026-11-01T20:00");
    await readyUser({ prefs: { run_time: "09:00", target_roles: ["Software Engineer"] } });
    await readyUser({ prefs: { run_time: "11:00", target_roles: ["Software Engineer"] } });
    setIst("2026-11-02T09:00");
    await runDueUsers();
    const first = await query<{ fetched_at: Date }>("SELECT fetched_at FROM job_cache");
    expect(first).toHaveLength(1);
    setIst("2026-11-02T11:00");
    await runDueUsers();
    const second = await query<{ fetched_at: Date }>("SELECT fetched_at FROM job_cache");
    expect(second).toHaveLength(1);
    expect(new Date(second[0]!.fetched_at).getTime()).toBe(new Date(first[0]!.fetched_at).getTime()); // not refetched
  });

  it("job locks stop two cron executions from running the same job at once", async () => {
    await execute("DELETE FROM job_locks");
    let release!: () => void;
    const slow = withJobLock("test-job", 60_000, () => new Promise<void>((r) => (release = r)));
    await new Promise((r) => setTimeout(r, 50));
    expect(await withJobLock("test-job", 60_000, async () => "second")).toEqual({ ran: false });
    release();
    await slow;
    expect(await withJobLock("test-job", 60_000, async () => "third")).toEqual({ ran: true, result: "third" });
  });
});
