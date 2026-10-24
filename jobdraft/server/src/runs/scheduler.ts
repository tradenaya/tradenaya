import cron, { type ScheduledTask } from "node-cron";
import { pruneJobCache } from "../jobs/fetch.js";
import { MINUTE } from "../lib/clock.js";
import { withJobLock } from "../lib/job-locks.js";
import { errInfo, log } from "../lib/logger.js";
import { IST_TZ } from "../lib/time.js";
import { processFollowUps } from "./followups.js";
import { claimDueRuns, closeStaleRuns, processClaimed } from "./runner.js";
import { processSendQueue } from "./send-queue.js";
import { trackAllUsers } from "./tracking.js";

const tasks: ScheduledTask[] = [];

/** Runs a job under its DB lock; overlapping firings (or other processes) simply skip. */
async function locked<T>(name: string, ttlMs: number, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    const res = await withJobLock(name, ttlMs, fn);
    if (!res.ran) {
      log.debug("job_skipped_locked", { name });
      return undefined;
    }
    return res.result;
  } catch (err) {
    log.error("job_crashed", { name, error: errInfo(err) });
    return undefined;
  }
}

export const jobs = {
  /**
   * Claiming is quick and happens under the lock; the runs themselves are
   * processed outside it, so a slow or stuck run never blocks the next
   * minute's pass (claims are unique per user per IST day anyway).
   */
  scheduler: async () => {
    const claims = await locked("scheduler", 5 * MINUTE, () => claimDueRuns());
    if (claims?.runs.length) await processClaimed(claims.runs).catch((err) => log.error("job_crashed", { name: "scheduler-runs", error: errInfo(err) }));
  },
  sendQueue: () => locked("send-queue", 5 * MINUTE, () => processSendQueue()),
  tracking: () => locked("tracking", 30 * MINUTE, () => trackAllUsers()),
  followups: () => locked("followups", 30 * MINUTE, () => processFollowUps()),
};

const SCHEDULE = [
  { name: "jobdraft-runs", cron: "* * * * *", run: () => jobs.scheduler() },
  { name: "jobdraft-send-queue", cron: "* * * * *", run: () => jobs.sendQueue() },
  { name: "jobdraft-tracking", cron: "15 */2 * * *", run: () => jobs.tracking() },
  { name: "jobdraft-followups", cron: "0 10 * * *", run: () => jobs.followups() },
  { name: "jobdraft-cache-prune", cron: "30 3 * * *", run: () => pruneJobCache().catch(() => undefined) },
];

/**
 * Every minute: due daily runs (each user at their own IST time) and the send
 * queue — separate locks, so a long run never blocks sending. Every 2 hours:
 * reply tracking. 10:00 IST daily: follow-ups. All times are Asia/Kolkata.
 */
export async function startScheduler(): Promise<void> {
  await closeStaleRuns().catch((err) => log.warn("stale_runs_close_failed", { error: errInfo(err) }));
  await pruneJobCache().catch(() => undefined);

  for (const job of SCHEDULE) tasks.push(cron.schedule(job.cron, () => void job.run(), { timezone: IST_TZ, name: job.name }));
  log.info("scheduler_started", { timezone: IST_TZ, jobs: SCHEDULE.map((j) => `${j.name} (${j.cron})`) });

  // Catch-up after downtime: missed daily runs (≤3 h old) are picked up by the
  // first per-minute pass; follow-up work is idempotent, so run it once now.
  void jobs.scheduler();
  void jobs.followups();
}

export function stopScheduler(): void {
  for (const t of tasks.splice(0)) void t.stop();
}
