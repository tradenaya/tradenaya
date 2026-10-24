import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { closePool, execute, json, query, queryOne } from "../../src/db/pool.js";
import { setMockJobsForTests } from "../../src/jobs/fetch.js";
import { MINUTE } from "../../src/lib/clock.js";
import { withJobLock } from "../../src/lib/job-locks.js";
import { nextRunAt } from "../../src/lib/time.js";
import type { Funnel } from "../../src/runs/funnel.js";
import { claimDueRuns, runDueUsers } from "../../src/runs/runner.js";
import { istFmt, readyUser, resetDb, setIst } from "../helpers.js";

beforeEach(resetDb);
afterEach(() => setMockJobsForTests(null));
afterAll(closePool);

interface RunRow {
  id: number;
  user_id: number;
  trigger: string;
  status: string;
  error_message: string | null;
  scheduled_for: Date | null;
  funnel: unknown;
}
const runsOf = (userId: number) => query<RunRow>("SELECT * FROM runs WHERE user_id = ? ORDER BY id", [userId]);

async function tick(fromIst: string, minutes: number) {
  let t = setIst(fromIst).getTime();
  for (let i = 0; i <= minutes; i++, t += MINUTE) {
    setIst(new Date(t).toISOString());
    await runDueUsers(new Date(t));
  }
}

describe("scheduler: runs are never silently missing", () => {
  it("a due user with everything set up gets exactly one run per day, with a funnel", async () => {
    setIst("2026-11-01T20:00");
    const { user } = await readyUser();
    await tick("2026-11-02T08:58", 10);
    const runs = await runsOf(user.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ trigger: "scheduled" });
    expect(istFmt(runs[0]!.scheduled_for)).toBe("2026-11-02 09:00");
    const funnel = json<Funnel | null>(runs[0]!.funnel, null)!;
    expect(funnel.fetched).toBeGreaterThan(0);
    expect(funnel.sources[0]).toMatchObject({ source: "mock", configured: true });
  });

  it("when the source returns nothing, the run still appears — no_matches with the reason", async () => {
    setIst("2026-11-01T20:00");
    const { user, agent } = await readyUser();
    setMockJobsForTests(() => []);
    setIst("2026-11-02T09:00");
    expect((await runDueUsers()).claimed).toBe(1);
    const [run] = await runsOf(user.id);
    expect(run).toMatchObject({ status: "no_matches", error_message: "No jobs were fetched. Demo source returned 0 jobs." });
    const list = await agent.get("/api/runs").expect(200);
    expect(list.body.runs[0]).toMatchObject({ status: "no_matches", jobsConsidered: 0 });
    expect(list.body.runs[0].funnel).toMatchObject({ fetched: 0, note: "No jobs were fetched. Demo source returned 0 jobs." });
  });

  it("when the source fails, the run still appears with the source error", async () => {
    setIst("2026-11-01T20:00");
    const { user } = await readyUser();
    setMockJobsForTests(() => {
      throw new Error("connect ETIMEDOUT");
    });
    setIst("2026-11-02T09:00");
    await runDueUsers();
    const [run] = await runsOf(user.id);
    expect(run!.status).toBe("no_matches");
    expect(run!.error_message).toBe("No jobs were fetched. Demo source error: connect ETIMEDOUT.");
    const funnel = json<Funnel | null>(run!.funnel, null)!;
    // One error per search (the default test user has 2 roles × 1 city).
    expect(funnel.sources[0]!.errors).toEqual([{ message: "connect ETIMEDOUT" }, { message: "connect ETIMEDOUT" }]);
    expect(funnel.queries[0]).toMatchObject({ error: "connect ETIMEDOUT", fetched: 0 });
  });

  it("automation ON but Gmail access expired: a 'couldn't start' card once that day, never silence", async () => {
    setIst("2026-11-01T20:00");
    const { user, agent } = await readyUser();
    await execute("UPDATE gmail_connections SET status = 'error', last_error = 'Gmail access expired — please reconnect' WHERE user_id = ?", [user.id]);
    await tick("2026-11-02T08:59", 5);
    const runs = await runsOf(user.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ trigger: "scheduled", status: "failed" });
    expect(runs[0]!.error_message).toMatch(/^Today's run couldn't start: reconnect gmail \(access expired\)\. Automation is still on/);
    const list = await agent.get("/api/runs").expect(200);
    expect(list.body.runs).toHaveLength(1);
    // The next day it is reported again (once).
    await tick("2026-11-03T09:00", 3);
    expect(await runsOf(user.id)).toHaveLength(2);
  });

  it("users not due yet, or with automation OFF, get nothing", async () => {
    setIst("2026-11-01T20:00");
    const a = await readyUser({ prefs: { run_time: "18:00" } });
    const b = await readyUser({ automation: false });
    setIst("2026-11-02T09:00");
    expect(await claimDueRuns()).toEqual({ runs: [], skipped: 0, blocked: 0 });
    expect(await runsOf(a.user.id)).toHaveLength(0);
    expect(await runsOf(b.user.id)).toHaveLength(0);
  });

  it("runs stuck in 'running' are closed by the next pass", async () => {
    setIst("2026-11-01T20:00");
    const { user } = await readyUser();
    await execute("INSERT INTO runs (user_id, `trigger`, run_date, status, started_at) VALUES (?, 'manual', '2026-11-01', 'running', ?)", [
      user.id,
      setIst("2026-11-01T20:30"),
    ]);
    setIst("2026-11-02T08:00");
    await claimDueRuns();
    const [stuck] = await runsOf(user.id);
    expect(stuck).toMatchObject({ status: "failed" });
    expect(stuck!.error_message).toMatch(/Interrupted/);
  });
});

describe("locks", () => {
  it("an expired lock (crashed holder) is reclaimed", async () => {
    await execute("INSERT INTO job_locks (name, locked_until, owner) VALUES ('scheduler', ?, 'dead-process')", [new Date(Date.now() - 60_000)]);
    expect(await withJobLock("scheduler", 60_000, async () => "ran")).toEqual({ ran: true, result: "ran" });
  });

  it("a live lock held by someone else is respected", async () => {
    await execute("INSERT INTO job_locks (name, locked_until, owner) VALUES ('scheduler', ?, 'other-process')", [new Date(Date.now() + 60_000)]);
    expect(await withJobLock("scheduler", 60_000, async () => "ran")).toEqual({ ran: false });
  });

  it("a hung holder stops renewing after maxHold, so the lock expires for others", async () => {
    let release!: () => void;
    const hung = withJobLock("hung-job", 1500, () => new Promise<void>((r) => (release = r)), 1000);
    await new Promise((r) => setTimeout(r, 3200)); // past maxHold (1 s) and the ttl (1.5 s) after the last renewal
    expect(await withJobLock("hung-job", 1500, async () => "second")).toEqual({ ran: true, result: "second" });
    release();
    await hung;
  });
});

describe("India time with the process in UTC", () => {
  it("schedules at the user's IST time whatever process.env.TZ is", async () => {
    const before = process.env.TZ;
    process.env.TZ = "UTC";
    try {
      expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(0); // really UTC now
      const now = setIst("2026-11-02T08:00");
      const next = nextRunAt({ now, runTime: "09:00", automationEnabled: true, slotRanToday: false, settingsChangedAt: null });
      expect(next!.toISOString()).toBe("2026-11-02T03:30:00.000Z");
      setIst("2026-11-01T20:00");
      const { user } = await readyUser({ prefs: { run_time: "09:15" } });
      await tick("2026-11-02T09:13", 4);
      const runs = await runsOf(user.id);
      expect(runs.map((r) => istFmt(r.scheduled_for))).toEqual(["2026-11-02 09:15"]);
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });
});

describe("history API", () => {
  it("returns the funnel with each run", async () => {
    setIst("2026-11-01T20:00");
    const { agent } = await readyUser();
    setIst("2026-11-02T09:00");
    await runDueUsers();
    const list = await agent.get("/api/runs").expect(200);
    const f = list.body.runs[0].funnel as Funnel;
    expect(f.v).toBe(1);
    const run = await queryOne<{ id: number }>("SELECT id FROM runs");
    const detail = await agent.get(`/api/runs/${run!.id}`).expect(200);
    expect(detail.body.run.funnel).toEqual(f);
  });
});
