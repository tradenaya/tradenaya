import crypto from "node:crypto";
import { execute, queryOne } from "../db/pool.js";
import { clock } from "./clock.js";
import { errInfo, log } from "./logger.js";

/**
 * DB-backed lock so two overlapping cron executions (or two server processes)
 * never run the same job at once. A crashed holder's lock expires by itself.
 */
export async function tryAcquireLock(name: string, ttlMs: number, owner: string): Promise<boolean> {
  const now = clock.now();
  const until = new Date(now.getTime() + ttlMs);
  // MySQL applies these left to right: take the lock only if free/expired (or already ours).
  await execute(
    `INSERT INTO job_locks (name, locked_until, owner) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       owner = IF(locked_until <= ? OR owner = VALUES(owner), VALUES(owner), owner),
       locked_until = IF(owner = VALUES(owner), VALUES(locked_until), locked_until)`,
    [name, until, owner, now],
  );
  const row = await queryOne<{ owner: string }>("SELECT owner FROM job_locks WHERE name = ?", [name]);
  return row?.owner === owner;
}

export async function releaseLock(name: string, owner: string): Promise<void> {
  await execute("UPDATE job_locks SET locked_until = '1970-01-01 00:00:01' WHERE name = ? AND owner = ?", [name, owner]);
}

/** Runs `fn` only if the lock is free. Keeps the lock alive while `fn` runs. */
export async function withJobLock<T>(name: string, ttlMs: number, fn: () => Promise<T>): Promise<{ ran: true; result: T } | { ran: false }> {
  const owner = `${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  if (!(await tryAcquireLock(name, ttlMs, owner))) return { ran: false };
  const heartbeat = setInterval(() => {
    tryAcquireLock(name, ttlMs, owner).catch((err) => log.warn("lock_renew_failed", { name, error: errInfo(err) }));
  }, Math.max(1000, Math.floor(ttlMs / 3)));
  heartbeat.unref();
  try {
    return { ran: true, result: await fn() };
  } finally {
    clearInterval(heartbeat);
    await releaseLock(name, owner).catch(() => undefined);
  }
}
