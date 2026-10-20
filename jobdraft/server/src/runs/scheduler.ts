import cron, { type ScheduledTask } from "node-cron";
import { pruneJobCache } from "../jobs/fetch.js";
import { MINUTE } from "../lib/clock.js";
import { withJobLock } from "../lib/job-locks.js";
import { errInfo, log } from "../lib/logger.js";
import { IST_TZ } from "../lib/time.js";
import { processFollowUps } from "./followups.js";
import { closeStaleRuns, runDueUsers } from "./runner.js";
import { processSendQueue } from "./send-queue.js";
import { trackAllUsers } from "./tracking.js";

const tasks: ScheduledTask[] = [];

/** Runs a job under its DB lock; overlapping firings (or other processes) simply skip. */
async function locked(name: string, ttlMs: number, fn: () => Promise<unknown>) {
  try {
    const res = await withJobLock(name, ttlMs, fn);
    if (!res.ran) log.debug("job_skipped_locked", { name });
  } catch (err) {
    log.error("job_crashed", { name, error: errInfo(err) });
  }
}

export const jobs = {
  scheduler: () => locked("scheduler", 15 * MINUTE, () => runDueUsers()),
  sendQueue: () => locked("send-queue", 5 * MINUTE, () => processSendQueue()),
  tracking: () => locked("tracking", 30 * MINUTE, () => trackAllUsers()),
  followups: () => locked("followups", 30 * MINUTE, () => processFollowUps()),
};

/**
 * Every minute: due daily runs (each user at their own IST time) and the send
 * queue — separate locks, so a long run never blocks sending. Every 2 hours:
 * reply tracking. 10:00 IST daily: follow-ups. All times are Asia/Kolkata.
 */
export async function startScheduler(): Promise<void> {
  await closeStaleRuns().catch((err) => log.warn("stale_runs_close_failed", { error: errInfo(err) }));
  await pruneJobCache().catch(() => undefined);

  tasks.push(
    cron.schedule("* * * * *", () => void jobs.scheduler(), { timezone: IST_TZ, name: "jobdraft-runs" }),
    cron.schedule("* * * * *", () => void jobs.sendQueue(), { timezone: IST_TZ, name: "jobdraft-send-queue" }),
    cron.schedule("15 */2 * * *", () => void jobs.tracking(), { timezone: IST_TZ, name: "jobdraft-tracking" }),
    cron.schedule("0 10 * * *", () => void jobs.followups(), { timezone: IST_TZ, name: "jobdraft-followups" }),
    cron.schedule("30 3 * * *", () => void pruneJobCache().catch(() => undefined), { timezone: IST_TZ, name: "jobdraft-cache-prune" }),
  );
  log.info("scheduler_started", { timezone: IST_TZ });

  // Catch-up after downtime: missed daily runs (≤3 h old) are picked up by the
  // first per-minute pass; follow-up work is idempotent, so run it once now.
  void jobs.scheduler();
  void jobs.followups();
}

export function stopScheduler(): void {
  for (const t of tasks.splice(0)) void t.stop();
}
