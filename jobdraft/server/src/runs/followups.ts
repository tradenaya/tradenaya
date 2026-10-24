// Follow-ups: at most TWO per application, ever. Enforced by the database
// (UNIQUE(run_item_id, sequence) + CHECK(sequence IN (1,2))), by the checks
// below, and by inserting the row before anything else so parallel workers or
// duplicate cron firings can never create extras.
import { generateFollowUp } from "../ai/index.js";
import type { ResumeData } from "../ai/schemas.js";
import { execute, isDuplicateKey, query, queryOne } from "../db/pool.js";
import { gmail } from "../gmail/index.js";
import { buildMimeMessage, generateMessageId, replySubject, toBase64Url } from "../gmail/mime.js";
import { clock, DAY, MINUTE } from "../lib/clock.js";
import { GmailAuthError } from "../lib/errors.js";
import { errInfo, log } from "../lib/logger.js";
import { istDate, istDayStart, isWeekendIst, nextWeekdayWindow } from "../lib/time.js";
import { findExcluded } from "../matching/exclusions.js";
import { gmailUsable, listExcluded, loadProfile, refreshTokenOf, type RunnableProfile } from "./profile.js";
import { geminiKeyOf } from "../ai/user-key.js";
import { prepareFollowUpBody, SEND_MODES, templateFollowUp, type SendMode } from "./safety.js";
import { refreshRunStatus } from "./status.js";
import { stopPendingFollowUps, trackItem, type TrackedItem } from "./tracking.js";

export const FOLLOWUP_POLICY = {
  maxPerApplication: 2,
  maxPerUserPerDay: 5,
  daysBetween: 7,
  /** No follow-ups for applications sent longer ago than this. */
  maxAgeDays: 30,
  /** A draft-mode follow-up not sent within this long expires. */
  draftExpiryDays: 7,
  /** After follow-up 2, wait this long for a reply before "No response". */
  noResponseDays: 7,
};

interface Candidate extends TrackedItem {
  company: string;
  company_key: string;
  job_title: string;
  job_url: string | null;
  to_email: string;
  subject: string;
  followup_mode: "auto" | "draft";
  sent_by: "auto" | "user" | null;
  followups_stopped: number;
  followup_count: number;
  fu1_sent_at: Date | null;
  next_sequence: 1 | 2;
}

/**
 * Applications whose next follow-up is due. Follow-up 1: 7 days after the
 * original was sent. Follow-up 2: 7 days after follow-up 1 was SENT (a
 * cancelled/expired/skipped/failed follow-up 1 means no follow-up 2).
 */
export async function dueFollowUpCandidates(now = clock.now()): Promise<Candidate[]> {
  const maxAge = new Date(now.getTime() - FOLLOWUP_POLICY.maxAgeDays * DAY);
  const rows = await query<Candidate>(
    `SELECT i.id, i.run_id, i.user_id, i.gmail_thread_id, i.gmail_draft_id, i.rfc_message_id, i.send_state, i.sent_at, i.reply_state, i.outcome,
            i.company, i.company_key, i.job_title, i.job_url, i.to_email, i.subject, i.followup_mode, i.sent_by, i.followups_stopped, i.followup_count,
            f1.sent_at AS fu1_sent_at,
            IF(f1.id IS NULL, 1, 2) AS next_sequence
     FROM run_items i
     LEFT JOIN followups f1 ON f1.run_item_id = i.id AND f1.sequence = 1
     LEFT JOIN followups f2 ON f2.run_item_id = i.id AND f2.sequence = 2
     WHERE i.type <> 'link_only' AND i.send_state = 'sent' AND i.reply_state = 'none' AND i.outcome = 'open'
       AND i.followups_stopped = 0 AND i.followup_count < 2 AND i.gmail_thread_id IS NOT NULL
       AND i.sent_at >= ? AND f2.id IS NULL
       AND (f1.id IS NULL OR f1.state = 'sent')
     ORDER BY i.sent_at, i.id`,
    [maxAge],
  );
  const today = istDate(now);
  return rows.filter((c) => {
    const base = c.next_sequence === 1 ? c.sent_at : c.fu1_sent_at;
    // Due from its due DATE (the first weekday whose 10:00–11:30 window is ≥ 7 days after base);
    // the exact minute is picked at creation and is never earlier than the 7 days.
    return !!base && istDate(nextWeekdayWindow(new Date(new Date(base).getTime() + FOLLOWUP_POLICY.daysBetween * DAY), () => 0)) <= today;
  });
}

/** A follow-up is sent automatically only if its original was, and never in drafts-only mode. */
export function followUpMode(c: { followup_mode: "auto" | "draft"; sent_by: "auto" | "user" | null }, sendMode: SendMode): "auto" | "draft" {
  if (sendMode === "drafts_only") return "draft";
  return c.followup_mode === "auto" && c.sent_by === "auto" ? "auto" : "draft";
}

/** Re-checked at creation and again right before sending. */
export function followUpBlocker(c: { send_state: string; reply_state: string; outcome: string; followups_stopped: number; sent_at: Date | null }, p: RunnableProfile, now: Date): string | null {
  if (c.send_state !== "sent") return "original not sent";
  if (c.reply_state !== "none" || c.outcome !== "open") return "application closed";
  if (c.followups_stopped) return "follow-ups stopped";
  if (!p.automationEnabled) return "automation is off";
  if (!gmailUsable(p)) return "Gmail not connected";
  if (!c.sent_at || now.getTime() - new Date(c.sent_at).getTime() > FOLLOWUP_POLICY.maxAgeDays * DAY) return "original sent more than 30 days ago";
  return null;
}

async function followUpsCreatedOn(userId: number, now: Date): Promise<number> {
  const start = istDayStart(now);
  const row = await queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM followups WHERE user_id = ? AND due_at >= ? AND due_at < ?", [userId, start, new Date(start.getTime() + DAY)]);
  return Number(row?.n ?? 0);
}

async function writeBody(c: Candidate, sequence: 1 | 2, resume: ResumeData, experienceYears: number, apiKey: string | null): Promise<string> {
  try {
    const draft = await generateFollowUp({ apiKey, sequence, company: c.company, jobTitle: c.job_title, resume, experienceYears });
    const checked = prepareFollowUpBody({ body: draft, sequence, company: c.company, jobTitle: c.job_title, resume });
    if (checked.ok) return checked.body;
    log.warn("followup_text_rejected", { itemId: c.id, sequence, reason: checked.reason });
  } catch (err) {
    log.warn("followup_ai_failed", { itemId: c.id, sequence, error: errInfo(err) });
  }
  return templateFollowUp({ sequence, company: c.company, jobTitle: c.job_title, resume });
}

/** Creates follow-up N for one application. Returns what happened. */
export async function createFollowUp(c: Candidate, profile: RunnableProfile, now: Date, random: () => number = Math.random): Promise<string> {
  const sequence = c.next_sequence;
  // Layer 2 (code): N ≤ 2, N−1 sent, not stopped.
  if (sequence > FOLLOWUP_POLICY.maxPerApplication || c.followup_count >= FOLLOWUP_POLICY.maxPerApplication) return "limit reached";
  if (sequence === 2 && !c.fu1_sent_at) return "follow-up 1 not sent";
  const token = refreshTokenOf(profile);
  if (!token || !profile.gmailAddress || !profile.resume) return "not ready";

  const block = followUpBlocker(c, profile, now);
  if (block) return block;
  const excluded = findExcluded({ company: c.company, email: c.to_email, url: c.job_url }, await listExcluded(profile.userId));
  if (excluded) return "excluded company";

  // Fresh reply check right before creating anything.
  const reading = await trackItem(c, token, profile.gmailAddress);
  if (!reading || c.outcome !== "open") return "replied or closed";

  // A random minute in today's 10:00–11:30 window, never before now or before base + 7 days.
  const earliest = new Date(new Date(sequence === 1 ? c.sent_at! : c.fu1_sent_at!).getTime() + FOLLOWUP_POLICY.daysBetween * DAY);
  const dueAt = nextWeekdayWindow(new Date(Math.max(now.getTime(), earliest.getTime())), random);
  // Auto only if the original was sent automatically, and never in drafts-only mode.
  const mode = followUpMode(c, profile.sendMode);
  const cancelWindow = SEND_MODES[profile.sendMode].cancelWindowMinutes; // none in "send all instantly"
  const sendAt = mode === "auto" ? new Date(Math.max(dueAt.getTime(), now.getTime() + cancelWindow * MINUTE)) : null;

  // Layer 3: claim the sequence number first. A duplicate worker loses here.
  let followupId: number;
  try {
    const res = await execute(
      `INSERT INTO followups (run_item_id, user_id, sequence, mode, state, due_at, send_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [c.id, profile.userId, sequence, mode, mode === "auto" ? "scheduled" : "draft_created", dueAt, sendAt, now],
    );
    followupId = res.insertId;
  } catch (err) {
    if (isDuplicateKey(err)) return "already exists";
    throw err;
  }
  await execute("UPDATE run_items SET followup_count = LEAST(followup_count + 1, 2) WHERE id = ?", [c.id]);

  try {
    // Reply in the same thread: In-Reply-To = latest message, References = the chain.
    const latest = [...reading.sent].sort((a, b) => b.internalDate - a.internalDate)[0];
    const refs = [c.rfc_message_id, ...reading.sent.map((m) => m.headers["message-id"])].filter((r): r is string => !!r);
    const references = [...new Set(refs)];
    const inReplyTo = latest?.headers["message-id"] || c.rfc_message_id || undefined;
    const messageId = generateMessageId(profile.gmailAddress);
    // Without a usable key the plain template is used (the follow-up still goes out as planned).
    const body = await writeBody(c, sequence, profile.resume, profile.experienceYears, geminiKeyOf(profile));
    const subject = replySubject(c.subject);
    const raw = buildMimeMessage({ from: profile.gmailAddress, to: c.to_email, replyTo: profile.gmailAddress, subject, body, messageId, inReplyTo, references });
    const draft = await gmail().createDraft(token, toBase64Url(raw), c.gmail_thread_id);
    await execute("UPDATE followups SET gmail_draft_id = ?, rfc_message_id = ?, subject = ?, body_preview = ? WHERE id = ?", [
      draft.draftId,
      messageId,
      subject.slice(0, 255),
      body.slice(0, 600),
      followupId,
    ]);
    log.info("followup_created", { userId: profile.userId, itemId: c.id, sequence, mode });
    return mode === "auto" ? "scheduled" : "draft_created";
  } catch (err) {
    await execute("UPDATE followups SET state = 'failed', skip_reason = ? WHERE id = ?", ["Could not create the follow-up draft", followupId]);
    if (err instanceof GmailAuthError) throw err;
    log.warn("followup_create_failed", { itemId: c.id, sequence, error: errInfo(err) });
    return "failed";
  }
}

/** Draft-mode follow-ups not sent within 7 days expire; the application closes as "No response". */
async function expireDraftFollowUps(now: Date): Promise<void> {
  const stale = await query<{ id: number; run_item_id: number; user_id: number; gmail_draft_id: string | null }>(
    "SELECT id, run_item_id, user_id, gmail_draft_id FROM followups WHERE state = 'draft_created' AND created_at <= ?",
    [new Date(now.getTime() - FOLLOWUP_POLICY.draftExpiryDays * DAY)],
  );
  for (const f of stale) {
    const profile = await loadProfile(f.user_id);
    const token = profile?.gmailAddress ? refreshTokenOf(profile) : null;
    // Maybe the user sent it after all.
    if (token && profile?.gmailStatus === "connected") {
      const item = await queryOne<TrackedItem>(
        "SELECT id, run_id, user_id, gmail_thread_id, gmail_draft_id, rfc_message_id, send_state, sent_at, reply_state, outcome FROM run_items WHERE id = ?",
        [f.run_item_id],
      );
      if (item?.gmail_thread_id) await trackItem(item, token, profile.gmailAddress!).catch(() => null);
    }
    const res = await execute("UPDATE followups SET state = 'expired', skip_reason = 'Not sent within 7 days' WHERE id = ? AND state = 'draft_created'", [f.id]);
    if (res.affectedRows !== 1) continue;
    if (token && f.gmail_draft_id) await gmail().deleteDraft(token, f.gmail_draft_id).catch(() => undefined);
    await execute("UPDATE run_items SET outcome = 'no_response' WHERE id = ? AND outcome = 'open'", [f.run_item_id]);
  }
}

/** Closing rules: 7 days after follow-up 2 with no reply, or past the tracking window. */
async function closeFinishedApplications(now: Date): Promise<void> {
  await execute(
    `UPDATE run_items i JOIN followups f ON f.run_item_id = i.id AND f.sequence = 2 AND f.state = 'sent'
     SET i.outcome = 'no_response'
     WHERE i.outcome = 'open' AND f.sent_at <= ?`,
    [new Date(now.getTime() - FOLLOWUP_POLICY.noResponseDays * DAY)],
  );
  await execute(
    `UPDATE run_items SET outcome = 'no_response'
     WHERE outcome = 'open' AND send_state = 'sent' AND sent_at <= ?
       AND NOT EXISTS (SELECT 1 FROM followups f WHERE f.run_item_id = run_items.id AND f.state IN ('scheduled','sending','draft_created'))`,
    [new Date(now.getTime() - 45 * DAY)],
  );
}

/**
 * The daily follow-up job (10:00 IST, under a lock). Safe to run any number of
 * times: every step is idempotent and the DB refuses a third follow-up.
 */
export async function processFollowUps(now = clock.now(), random: () => number = Math.random): Promise<{ created: number }> {
  await expireDraftFollowUps(now);
  await closeFinishedApplications(now);
  let created = 0;
  // Business days only — follow-ups are never created (or sent) on weekends.
  if (!isWeekendIst(now)) {
    const candidates = await dueFollowUpCandidates(now);
    const perUser = new Map<number, number>();
    for (const c of candidates) {
      try {
        const profile = await loadProfile(c.user_id);
        if (!profile) continue;
        const already = perUser.get(c.user_id) ?? (await followUpsCreatedOn(c.user_id, now));
        // Daily cap: the rest stay due and are picked up on the next weekday.
        if (already >= FOLLOWUP_POLICY.maxPerUserPerDay) continue;
        const result = await createFollowUp(c, profile, now, random);
        if (result === "scheduled" || result === "draft_created") {
          created++;
          perUser.set(c.user_id, already + 1);
        }
        await refreshRunStatus(Number(c.run_id));
      } catch (err) {
        if (err instanceof GmailAuthError) {
          await execute("UPDATE gmail_connections SET status = 'error', last_error = ? WHERE user_id = ?", ["Gmail access expired — please reconnect", c.user_id]);
        } else log.warn("followup_failed", { userId: c.user_id, itemId: c.id, error: errInfo(err) });
      }
    }
  }
  log.info("followups_processed", { created, date: istDate(now) });
  return { created };
}

/** "Stop follow-ups" on one application: nothing more is ever created or sent for it. */
export async function stopFollowUps(userId: number, itemId: number): Promise<boolean> {
  const item = await queryOne<{ id: number; run_id: number }>("SELECT id, run_id FROM run_items WHERE id = ? AND user_id = ? AND type <> 'link_only'", [itemId, userId]);
  if (!item) return false;
  await execute("UPDATE run_items SET followups_stopped = 1, outcome = IF(outcome = 'open', 'stopped', outcome) WHERE id = ?", [itemId]);
  const profile = await loadProfile(userId);
  const token = profile ? refreshTokenOf(profile) : null;
  await stopPendingFollowUps(itemId, token, "cancelled", "Stopped by you");
  await refreshRunStatus(Number(item.run_id));
  return true;
}
