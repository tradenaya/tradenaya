// DB-backed send queue for first emails and follow-ups. Processed every minute
// under a job lock, it survives restarts. Every send is claimed atomically
// (state scheduled → sending, only if exactly one row changed), so an email can
// never be sent twice, even with several workers.
import { execute, query, queryOne } from "../db/pool.js";
import { gmail, GmailNotFoundError, GmailRateLimitError } from "../gmail/index.js";
import { clock, HOUR, MINUTE } from "../lib/clock.js";
import { GmailAuthError } from "../lib/errors.js";
import { errInfo, log } from "../lib/logger.js";
import { findExcluded } from "../matching/exclusions.js";
import { followUpBlocker } from "./followups.js";
import { gmailUsable, listExcluded, loadProfile, refreshTokenOf, type RunnableProfile } from "./profile.js";
import { SEND_POLICY } from "./safety.js";
import { refreshRunStatus } from "./status.js";
import { stopPendingFollowUps, trackItem, type TrackedItem } from "./tracking.js";

/** A "sending" claim older than this is a crash leftover and gets recovered. */
const STUCK_AFTER_MS = 10 * MINUTE;

interface QueueItem extends TrackedItem {
  company: string;
  company_key: string;
  to_email: string;
  job_url: string | null;
  send_attempts: number;
  send_at: Date | null;
}

interface QueueFollowUp {
  id: number;
  run_item_id: number;
  user_id: number;
  sequence: number;
  gmail_draft_id: string;
  attempts: number;
}

const ITEM_COLS = `id, run_id, user_id, gmail_thread_id, gmail_draft_id, rfc_message_id, send_state, sent_at, reply_state, outcome,
  company, company_key, to_email, job_url, send_attempts, send_at`;

function randomGap(random: () => number): number {
  const { minGapMinutes: a, maxGapMinutes: b } = SEND_POLICY;
  return Math.round((a + random() * (b - a)) * MINUTE);
}

async function markGmailExpired(userId: number) {
  await execute("UPDATE gmail_connections SET status = 'error', last_error = ? WHERE user_id = ?", ["Gmail access expired — please reconnect", userId]);
}

/** Gmail said "slow down": no sending for 24 hours; everything waiting stays a draft. */
async function pauseUser(userId: number, now: Date) {
  const reason = "Gmail sending limit reached — kept as a draft";
  await execute("UPDATE gmail_connections SET send_paused_until = ? WHERE user_id = ?", [new Date(now.getTime() + SEND_POLICY.pauseHoursOnRateLimit * HOUR), userId]);
  await execute("UPDATE run_items SET send_state = 'skipped', skip_reason = ?, followup_mode = 'draft' WHERE user_id = ? AND send_state IN ('scheduled','sending')", [reason, userId]);
  await execute("UPDATE followups SET state = 'skipped', skip_reason = ? WHERE user_id = ? AND state IN ('scheduled','sending')", [reason, userId]);
  log.warn("sending_paused", { userId });
}

async function afterSend(userId: number, now: Date, random: () => number) {
  await execute("UPDATE gmail_connections SET next_send_after = ? WHERE user_id = ?", [new Date(now.getTime() + randomGap(random)), userId]);
}

async function skipItem(item: QueueItem, reason: string) {
  await execute("UPDATE run_items SET send_state = 'skipped', skip_reason = ?, followup_mode = 'draft' WHERE id = ? AND send_state = 'sending'", [reason.slice(0, 300), item.id]);
}

/** Failed attempt: retry after ≥15 minutes, at most 3 attempts in total, then "failed" for good. */
async function retryOrFail(table: "run_items" | "followups", id: number, attempts: number, now: Date) {
  if (table === "run_items") {
    if (attempts >= SEND_POLICY.maxSendAttempts) await execute("UPDATE run_items SET send_state = 'failed', skip_reason = 'Could not send after 3 attempts — kept as a draft', followup_mode = 'draft' WHERE id = ?", [id]);
    else await execute("UPDATE run_items SET send_state = 'scheduled', send_at = ? WHERE id = ? AND send_state = 'sending'", [new Date(now.getTime() + SEND_POLICY.retryGapMinutes * MINUTE), id]);
  } else {
    if (attempts >= SEND_POLICY.maxSendAttempts) await execute("UPDATE followups SET state = 'failed', skip_reason = 'Could not send after 3 attempts' WHERE id = ?", [id]);
    else await execute("UPDATE followups SET state = 'scheduled', send_at = ? WHERE id = ? AND state = 'sending'", [new Date(now.getTime() + SEND_POLICY.retryGapMinutes * MINUTE), id]);
  }
}

async function sendFirstEmail(item: QueueItem, profile: RunnableProfile, now: Date, random: () => number): Promise<boolean> {
  // Atomic claim — only one worker can win.
  const claim = await execute("UPDATE run_items SET send_state = 'sending', sending_started_at = ?, send_attempts = send_attempts + 1 WHERE id = ? AND send_state = 'scheduled'", [now, item.id]);
  if (claim.affectedRows !== 1) return false;
  const attempts = item.send_attempts + 1;
  const token = refreshTokenOf(profile);

  // Re-check everything right before sending.
  if (!profile.automationEnabled) return skipItem(item, "Automation is off — kept as a draft").then(() => false);
  if (!token || !gmailUsable(profile)) return skipItem(item, "Gmail is not connected — kept as a draft").then(() => false);
  if (findExcluded({ company: item.company, email: item.to_email, url: item.job_url }, await listExcluded(profile.userId))) {
    return skipItem(item, "Company is on your skip list").then(() => false);
  }
  const other = await queryOne(
    "SELECT id FROM run_items WHERE user_id = ? AND id <> ? AND send_state IN ('sent','sending') AND (company_key = ? OR to_email = ?) LIMIT 1",
    [profile.userId, item.id, item.company_key, item.to_email],
  );
  if (other) return skipItem(item, "Already contacted this company or address").then(() => false);

  try {
    if (!item.gmail_draft_id || !(await gmail().draftExists(token, item.gmail_draft_id))) {
      // Sent by hand, or deleted: let tracking decide which.
      await execute("UPDATE run_items SET send_state = 'scheduled' WHERE id = ? AND send_state = 'sending'", [item.id]);
      item.send_state = "scheduled";
      const reading = await trackItem(item, token, profile.gmailAddress!);
      if (!reading?.sent.length) await execute("UPDATE run_items SET send_state = 'removed' WHERE id = ? AND send_state <> 'sent'", [item.id]);
      return false;
    }
    const sent = await gmail().sendDraft(token, item.gmail_draft_id);
    await execute("UPDATE run_items SET send_state = 'sent', sent_at = ?, gmail_message_id = ?, gmail_thread_id = ? WHERE id = ?", [now, sent.messageId, sent.threadId, item.id]);
    await afterSend(profile.userId, now, random);
    log.info("email_sent", { userId: profile.userId, itemId: item.id });
    return true;
  } catch (err) {
    if (err instanceof GmailRateLimitError) await pauseUser(profile.userId, now);
    else if (err instanceof GmailAuthError) {
      await markGmailExpired(profile.userId);
      await skipItem(item, "Gmail access expired — kept as a draft");
    } else if (err instanceof GmailNotFoundError) {
      await execute("UPDATE run_items SET send_state = 'removed' WHERE id = ? AND send_state = 'sending'", [item.id]);
    } else {
      log.warn("send_failed", { userId: profile.userId, itemId: item.id, attempts, error: errInfo(err) });
      await retryOrFail("run_items", item.id, attempts, now);
    }
    return false;
  }
}

async function sendFollowUp(fu: QueueFollowUp, profile: RunnableProfile, now: Date, random: () => number): Promise<boolean> {
  const claim = await execute("UPDATE followups SET state = 'sending', sending_started_at = ?, attempts = attempts + 1 WHERE id = ? AND state = 'scheduled'", [now, fu.id]);
  if (claim.affectedRows !== 1) return false;
  const attempts = fu.attempts + 1;
  const skip = (reason: string) => execute("UPDATE followups SET state = 'skipped', skip_reason = ? WHERE id = ? AND state = 'sending'", [reason.slice(0, 300), fu.id]).then(() => false);
  const item = await queryOne<QueueItem & { followups_stopped: number }>(`SELECT ${ITEM_COLS}, followups_stopped FROM run_items WHERE id = ?`, [fu.run_item_id]);
  const token = refreshTokenOf(profile);
  if (!item || !token || !profile.gmailAddress) return skip("Application not found");

  const blocker = followUpBlocker(item, profile, now);
  if (blocker) return skip(blocker);
  if (findExcluded({ company: item.company, email: item.to_email, url: item.job_url }, await listExcluded(profile.userId))) return skip("Company is on your skip list");

  try {
    // Re-check the thread for a reply right before sending.
    await execute("UPDATE followups SET state = 'scheduled' WHERE id = ? AND state = 'sending'", [fu.id]);
    await trackItem(item, token, profile.gmailAddress);
    if (item.outcome !== "open") {
      await stopPendingFollowUps(item.id, token, "not_needed", item.outcome);
      return false;
    }
    const reclaim = await execute("UPDATE followups SET state = 'sending' WHERE id = ? AND state = 'scheduled'", [fu.id]);
    if (reclaim.affectedRows !== 1) return false;
    if (!(await gmail().draftExists(token, fu.gmail_draft_id))) {
      // Sent by hand (tracking already counted it) or deleted.
      await execute("UPDATE followups SET state = 'cancelled', skip_reason = 'Draft was removed in Gmail' WHERE id = ? AND state = 'sending'", [fu.id]);
      return false;
    }
    const sent = await gmail().sendDraft(token, fu.gmail_draft_id);
    await execute("UPDATE followups SET state = 'sent', sent_at = ?, gmail_message_id = ? WHERE id = ?", [now, sent.messageId, fu.id]);
    await afterSend(profile.userId, now, random);
    log.info("followup_sent", { userId: profile.userId, itemId: item.id, sequence: fu.sequence });
    return true;
  } catch (err) {
    if (err instanceof GmailRateLimitError) await pauseUser(profile.userId, now);
    else if (err instanceof GmailAuthError) {
      await markGmailExpired(profile.userId);
      await skip("Gmail access expired");
    } else if (err instanceof GmailNotFoundError) {
      await execute("UPDATE followups SET state = 'cancelled', skip_reason = 'Draft was removed in Gmail' WHERE id = ? AND state = 'sending'", [fu.id]);
    } else {
      log.warn("followup_send_failed", { userId: profile.userId, followupId: fu.id, attempts, error: errInfo(err) });
      await retryOrFail("followups", fu.id, attempts, now);
    }
    return false;
  }
}

/** Claims left in "sending" by a crash: decide from Gmail whether they went out. */
export async function recoverStuckSends(now = clock.now()): Promise<void> {
  const cutoff = new Date(now.getTime() - STUCK_AFTER_MS);
  const items = await query<QueueItem>(`SELECT ${ITEM_COLS} FROM run_items WHERE send_state = 'sending' AND sending_started_at < ?`, [cutoff]);
  for (const item of items) {
    const profile = await loadProfile(item.user_id);
    const token = profile ? refreshTokenOf(profile) : null;
    if (!profile || !token || !profile.gmailAddress) {
      await execute("UPDATE run_items SET send_state = 'skipped', skip_reason = 'Interrupted — kept as a draft' WHERE id = ? AND send_state = 'sending'", [item.id]);
      continue;
    }
    const exists = item.gmail_draft_id ? await gmail().draftExists(token, item.gmail_draft_id).catch(() => true) : false;
    if (exists) await retryOrFail("run_items", item.id, item.send_attempts, now);
    else {
      item.send_state = "scheduled";
      await execute("UPDATE run_items SET send_state = 'scheduled' WHERE id = ? AND send_state = 'sending'", [item.id]);
      const reading = await trackItem(item, token, profile.gmailAddress).catch(() => null);
      if (!reading?.sent.length) await execute("UPDATE run_items SET send_state = 'removed' WHERE id = ? AND send_state <> 'sent'", [item.id]);
    }
    await refreshRunStatus(Number(item.run_id));
  }
  const fus = await query<QueueFollowUp>("SELECT id, run_item_id, user_id, sequence, gmail_draft_id, attempts FROM followups WHERE state = 'sending' AND sending_started_at < ?", [cutoff]);
  for (const fu of fus) {
    const profile = await loadProfile(fu.user_id);
    const token = profile ? refreshTokenOf(profile) : null;
    const exists = token && fu.gmail_draft_id ? await gmail().draftExists(token, fu.gmail_draft_id).catch(() => true) : false;
    if (exists) await retryOrFail("followups", fu.id, fu.attempts, now);
    else await execute("UPDATE followups SET state = 'sent', sent_at = COALESCE(sent_at, ?) WHERE id = ? AND state = 'sending'", [now, fu.id]);
  }
}

/**
 * One queue pass: at most one send per user, only when that user's 2–4 minute
 * gap has passed and sending isn't paused. Oldest due item first.
 */
export async function processSendQueue(now = clock.now(), random: () => number = Math.random): Promise<{ sent: number }> {
  await recoverStuckSends(now);
  const users = await query<{ user_id: number }>(
    `SELECT DISTINCT user_id FROM (
       SELECT user_id FROM run_items WHERE send_state = 'scheduled' AND send_at <= ?
       UNION SELECT user_id FROM followups WHERE state = 'scheduled' AND send_at <= ? AND gmail_draft_id IS NOT NULL
     ) due`,
    [now, now],
  );
  let sent = 0;
  for (const { user_id: userId } of users) {
    try {
      const profile = await loadProfile(userId);
      if (!profile) continue;
      const conn = await queryOne<{ send_paused_until: Date | null; next_send_after: Date | null }>("SELECT send_paused_until, next_send_after FROM gmail_connections WHERE user_id = ?", [userId]);
      if (conn?.send_paused_until && new Date(conn.send_paused_until) > now) continue;
      if (conn?.next_send_after && new Date(conn.next_send_after) > now) continue;

      const item = await queryOne<QueueItem>(`SELECT ${ITEM_COLS} FROM run_items WHERE user_id = ? AND send_state = 'scheduled' AND send_at <= ? ORDER BY send_at, id LIMIT 1`, [userId, now]);
      const fu = await queryOne<QueueFollowUp & { send_at: Date }>(
        "SELECT id, run_item_id, user_id, sequence, gmail_draft_id, attempts, send_at FROM followups WHERE user_id = ? AND state = 'scheduled' AND send_at <= ? AND gmail_draft_id IS NOT NULL ORDER BY send_at, id LIMIT 1",
        [userId, now],
      );
      let ok = false;
      if (item && (!fu || new Date(item.send_at ?? 0) <= new Date(fu.send_at))) {
        ok = await sendFirstEmail(item, profile, now, random);
        await refreshRunStatus(Number(item.run_id));
      } else if (fu) {
        ok = await sendFollowUp(fu, profile, now, random);
        const runId = (await queryOne<{ run_id: number }>("SELECT run_id FROM run_items WHERE id = ?", [fu.run_item_id]))?.run_id;
        if (runId) await refreshRunStatus(Number(runId));
      }
      if (ok) sent++;
    } catch (err) {
      log.error("send_queue_user_failed", { userId, error: errInfo(err) });
    }
  }
  return { sent };
}

// ── user actions ───────────────────────────────────────────────────────────

/** Cancel one first email during its window: it stays a normal draft. */
export async function cancelItemSend(userId: number, itemId: number): Promise<boolean> {
  const res = await execute(
    "UPDATE run_items SET send_state = 'cancelled', skip_reason = 'Cancelled by you — kept as a draft', followup_mode = 'draft' WHERE id = ? AND user_id = ? AND send_state = 'scheduled'",
    [itemId, userId],
  );
  const run = await queryOne<{ run_id: number }>("SELECT run_id FROM run_items WHERE id = ?", [itemId]);
  if (run) await refreshRunStatus(Number(run.run_id));
  return res.affectedRows === 1;
}

/** Cancel every scheduled first email of a run. */
export async function cancelRunSends(userId: number, runId: number): Promise<number> {
  const res = await execute(
    "UPDATE run_items SET send_state = 'cancelled', skip_reason = 'Cancelled by you — kept as a draft', followup_mode = 'draft' WHERE run_id = ? AND user_id = ? AND send_state = 'scheduled'",
    [runId, userId],
  );
  await refreshRunStatus(runId);
  return res.affectedRows;
}

/** Cancel one follow-up during its window. A cancelled follow-up 1 means follow-up 2 is never created. */
export async function cancelFollowUp(userId: number, followupId: number): Promise<boolean> {
  const res = await execute("UPDATE followups SET state = 'cancelled', skip_reason = 'Cancelled by you' WHERE id = ? AND user_id = ? AND state = 'scheduled'", [followupId, userId]);
  return res.affectedRows === 1;
}

/** Automation OFF / Gmail disconnected: every scheduled send and follow-up is cancelled and stays a draft. */
export async function cancelAllScheduled(userId: number, reason: string): Promise<void> {
  await execute("UPDATE run_items SET send_state = 'cancelled', skip_reason = ?, followup_mode = 'draft' WHERE user_id = ? AND send_state = 'scheduled'", [reason, userId]);
  await execute("UPDATE followups SET state = 'cancelled', skip_reason = ? WHERE user_id = ? AND state = 'scheduled'", [reason, userId]);
  const runs = await query<{ id: number }>("SELECT DISTINCT run_id AS id FROM run_items WHERE user_id = ? AND send_state = 'cancelled'", [userId]);
  for (const r of runs) await refreshRunStatus(Number(r.id));
}
