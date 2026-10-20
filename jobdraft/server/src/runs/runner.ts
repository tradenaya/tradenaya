import { AiUnavailableError, checkJob } from "../ai/index.js";
import { config, features } from "../config/env.js";
import { execute, isDuplicateKey, query, queryOne } from "../db/pool.js";
import { gmail } from "../gmail/index.js";
import { buildMimeMessage, generateMessageId, toBase64Url } from "../gmail/mime.js";
import { fetchJobsForPairs, NoJobSourcesError, pairKey } from "../jobs/fetch.js";
import type { Job, SearchPair } from "../jobs/types.js";
import { clock, DAY, MINUTE } from "../lib/clock.js";
import { GmailAuthError, HttpError, sleep } from "../lib/errors.js";
import { errInfo, log } from "../lib/logger.js";
import { istDate, istDayStart, istInstant, isRunDue } from "../lib/time.js";
import { findExcluded, type ExcludedCompany } from "../matching/exclusions.js";
import { applyRuleFilter } from "../matching/filters.js";
import { companyKey } from "../matching/text.js";
import { storage } from "../storage/index.js";
import {
  automationProfiles,
  gmailUsable,
  hasScheduledRunOn,
  listExcluded,
  loadProfile,
  missingForAutomation,
  refreshTokenOf,
  settingsChangedAt,
  type RunnableProfile,
} from "./profile.js";
import { classifyAutoSend, decideDraft, SEND_POLICY } from "./safety.js";
import { cancelAllScheduled } from "./send-queue.js";
import { refreshRunStatus } from "./status.js";
import { trackUser } from "./tracking.js";

export const LIMITS = {
  maxAiCallsPerRun: 12,
  maxNewEmailsPerRun: SEND_POLICY.maxNewEmailsPerRun,
  maxLinkOnlyPerRun: SEND_POLICY.maxLinkOnlyPerRun,
  companyCooldownDays: 60,
  consecutiveAiFailuresToAbort: 3,
};

export type Trigger = "scheduled" | "manual";

const GMAIL_EXPIRED = "Gmail access expired — please reconnect";

class RunAbort extends Error {}
class AutomationOff extends Error {}

function friendlyError(err: unknown): string {
  if (err instanceof GmailAuthError) return GMAIL_EXPIRED;
  if (err instanceof NoJobSourcesError) return err.message;
  if (err instanceof AiUnavailableError || err instanceof RunAbort) return "The AI service was unavailable. JobDraft will try again at the next run.";
  if (err instanceof HttpError) return err.message;
  return "Something went wrong during this run. JobDraft will try again at the next scheduled time.";
}

export function pairsFor(profile: Pick<RunnableProfile, "targetRoles" | "locations">): SearchPair[] {
  return profile.targetRoles.flatMap((role) => profile.locations.map((location) => ({ role, location })));
}

/** Inserts the run row. For scheduled runs, returns null if this user already had one today (unique key). */
export async function claimRun(userId: number, trigger: Trigger, runDate: string, scheduledFor: Date | null = null, now = clock.now()): Promise<number | null> {
  try {
    const res = await execute("INSERT INTO runs (user_id, `trigger`, run_date, scheduled_for, status, started_at) VALUES (?, ?, ?, ?, 'running', ?)", [
      userId,
      trigger,
      runDate,
      scheduledFor,
      now,
    ]);
    return res.insertId;
  } catch (err) {
    if (isDuplicateKey(err)) return null;
    throw err;
  }
}

async function failRun(runId: number, message: string) {
  await execute("UPDATE runs SET status = 'failed', error_message = ?, finished_at = ? WHERE id = ?", [message.slice(0, 500), clock.now(), runId]);
}

async function markSeen(userId: number, jobKey: string, now: Date) {
  await execute("INSERT INTO seen_jobs (user_id, job_key, seen_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE seen_at = VALUES(seen_at)", [userId, jobKey.slice(0, 191), now]);
}

async function automationStillOn(userId: number): Promise<boolean> {
  const row = await queryOne<{ automation_enabled: number }>("SELECT automation_enabled FROM profiles WHERE user_id = ?", [userId]);
  return !!row?.automation_enabled;
}

async function autoSendsToday(userId: number, now: Date): Promise<number> {
  const start = istDayStart(now);
  const row = await queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM run_items WHERE user_id = ? AND type = 'auto_send' AND created_at >= ? AND created_at < ?", [
    userId,
    start,
    new Date(start.getTime() + DAY),
  ]);
  return Number(row?.n ?? 0);
}

async function loadHistory(userId: number, jobs: Job[], now: Date) {
  const seen = new Set<string>();
  const keys = jobs.map((j) => j.key.slice(0, 191));
  for (let i = 0; i < keys.length; i += 500) {
    const chunk = keys.slice(i, i + 500);
    if (!chunk.length) continue;
    for (const r of await query<{ job_key: string }>("SELECT job_key FROM seen_jobs WHERE user_id = ? AND job_key IN (?)", [userId, chunk])) seen.add(r.job_key);
  }
  const recent = await query<{ company_key: string }>("SELECT company_key FROM contacted_companies WHERE user_id = ? AND last_contacted_at > ?", [
    userId,
    new Date(now.getTime() - LIMITS.companyCooldownDays * DAY),
  ]);
  const emails = await query<{ email: string }>("SELECT email FROM contacted_emails WHERE user_id = ?", [userId]);
  return { seen, recent: new Set(recent.map((r) => r.company_key)), emails: new Set(emails.map((r) => r.email.toLowerCase())) };
}

/**
 * Steps 1–9 for one user. Never throws: failures are recorded on the run.
 * Drafts already created stay in Gmail whatever happens later.
 */
export async function processRun(runId: number, userId: number): Promise<void> {
  const ctx = { runId, userId };
  const started = Date.now();
  let newEmails = 0;
  let autoThisRun = 0;
  let linkOnly = 0;
  let considered = 0;
  try {
    const profile = await loadProfile(userId);
    if (!profile?.resume || !profile.resumePublicId || !profile.gmailAddress) throw new HttpError(400, "Finish setup first.");
    const token = refreshTokenOf(profile);
    if (!token || !gmailUsable(profile)) throw new GmailAuthError(profile.gmailStatus === "needs_reconnect" ? "Gmail needs to be reconnected with all permissions" : GMAIL_EXPIRED);
    const resume = profile.resume;

    // 1. Fresh sent/reply states before writing anything new.
    await trackUser(userId).catch((err) => log.warn("run_tracking_failed", { ...ctx, error: errInfo(err) }));
    if (!(await automationStillOn(userId))) throw new AutomationOff();

    // 2. Jobs (shared 6-hour cache).
    const { jobs: byPair, stats } = await fetchJobsForPairs(pairsFor(profile));
    log.info("run_jobs_fetched", { ...ctx, ...stats });
    const all = new Map<string, Job>();
    for (const pair of pairsFor(profile)) for (const job of byPair.get(pairKey(pair)) ?? []) all.set(job.key, job);

    // 3. Rule filter — excluded companies (past/current employers) first.
    const excluded: ExcludedCompany[] = await listExcluded(userId);
    const now0 = clock.now();
    const history = await loadHistory(userId, [...all.values()], now0);
    const notExcluded = [...all.values()].filter((j) => !findExcluded({ company: j.company, url: j.url }, excluded));
    const { passed, rejected } = applyRuleFilter(notExcluded, {
      targetRoles: profile.targetRoles,
      locations: profile.locations,
      experienceYears: profile.experienceYears,
      expectedSalaryLpa: profile.expectedSalaryLpa ?? 0,
      seenJobKeys: history.seen,
      recentCompanyKeys: history.recent,
    });
    considered = all.size;
    log.info("run_filtered", { ...ctx, fetched: all.size, excluded: all.size - notExcluded.length, passed: passed.length, rejected: rejected.length });

    let aiCalls = 0;
    let aiFailuresInARow = 0;
    let attachment: Buffer | null = null;
    const draftedCompanies = new Set<string>();
    let dayAutoSends = await autoSendsToday(userId, clock.now());
    const delayMs = config().gemini.delayMs;

    for (const job of passed) {
      // Caps reached: stop without marking the remaining jobs as seen.
      if (newEmails >= LIMITS.maxNewEmailsPerRun || aiCalls >= LIMITS.maxAiCallsPerRun) break;
      const cKey = companyKey(job.company);
      if (draftedCompanies.has(cKey)) continue;
      if (!(await automationStillOn(userId))) throw new AutomationOff();

      if (aiCalls > 0 && delayMs > 0) await sleep(delayMs);
      aiCalls++;
      let check;
      try {
        check = await checkJob({ job, resume, experienceYears: profile.experienceYears, targetRoles: profile.targetRoles });
        aiFailuresInARow = 0;
      } catch (err) {
        aiFailuresInARow++;
        log.warn("run_ai_check_failed", { ...ctx, error: errInfo(err) });
        if (aiFailuresInARow >= LIMITS.consecutiveAiFailuresToAbort) throw new RunAbort("AI unavailable");
        continue; // not marked seen — retried next run
      }

      const now = clock.now();
      const decision = decideDraft({ check, job, resume, expectedSalaryLpa: profile.expectedSalaryLpa ?? 0, experienceYears: profile.experienceYears, excluded });
      if (decision.kind === "draft") {
        if (history.emails.has(decision.to)) {
          await markSeen(userId, job.key, now); // this address was emailed before — never again
          continue;
        }
        const type = classifyAutoSend({
          confidence: decision.confidence,
          scam: check.scam_or_spam_signals,
          agency: check.is_staffing_agency,
          automationOn: true,
          gmailConnected: true,
          autoSendsThisRun: autoThisRun,
          autoSendsToday: dayAutoSends,
        });
        attachment ??= await storage().download(profile.resumePublicId);
        const messageId = generateMessageId(profile.gmailAddress);
        const raw = buildMimeMessage({
          from: profile.gmailAddress,
          to: decision.to,
          replyTo: profile.gmailAddress,
          subject: decision.subject,
          body: decision.body,
          messageId,
          attachment: { filename: profile.resumeFileName, contentType: "application/pdf", content: attachment },
        });
        const draft = await gmail().createDraft(token, toBase64Url(raw));
        await execute(
          `INSERT INTO run_items (run_id, user_id, type, company, company_key, job_title, location, job_url, source, posted_at, to_email, subject, body_preview,
             confidence, gmail_draft_id, gmail_thread_id, gmail_message_id, rfc_message_id, send_state, followup_mode, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'none', ?, ?)`,
          [
            runId, userId, type, job.company.slice(0, 255), cKey, job.title.slice(0, 255), job.location.slice(0, 255), job.url.slice(0, 2048), job.source,
            job.postedAt ? new Date(job.postedAt) : null, decision.to, decision.subject.slice(0, 255), decision.body.slice(0, 600), decision.confidence,
            draft.draftId, draft.threadId, draft.messageId, messageId, type === "auto_send" ? "auto" : "draft", now,
          ],
        );
        // Recorded at draft time: the company/address is never emailed twice, even if the user sends by hand later.
        await execute(
          `INSERT INTO contacted_companies (user_id, company_key, company_name, last_contacted_at) VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE company_name = VALUES(company_name), last_contacted_at = VALUES(last_contacted_at)`,
          [userId, cKey, job.company.slice(0, 255), now],
        );
        await execute("INSERT IGNORE INTO contacted_emails (user_id, email, first_contacted_at) VALUES (?, ?, ?)", [userId, decision.to, now]);
        history.emails.add(decision.to);
        await markSeen(userId, job.key, now);
        draftedCompanies.add(cKey);
        newEmails++;
        if (type === "auto_send") {
          autoThisRun++;
          dayAutoSends++;
        }
      } else if (decision.kind === "link_only") {
        if (linkOnly >= LIMITS.maxLinkOnlyPerRun) continue; // cap: not marked seen
        await execute(
          `INSERT INTO run_items (run_id, user_id, type, company, company_key, job_title, location, job_url, source, posted_at, note, confidence, created_at)
           VALUES (?, ?, 'link_only', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [runId, userId, job.company.slice(0, 255), cKey, job.title.slice(0, 255), job.location.slice(0, 255), job.url.slice(0, 2048), job.source,
            job.postedAt ? new Date(job.postedAt) : null, decision.reason.slice(0, 300), check.confidence, now],
        );
        await markSeen(userId, job.key, now);
        linkOnly++;
      } else {
        await markSeen(userId, job.key, now);
      }
    }

    await finishRun(runId, userId, considered);
    log.info("run_finished", { ...ctx, newEmails, autoSends: autoThisRun, linkOnly, aiCalls, ms: Date.now() - started });
  } catch (err) {
    if (err instanceof AutomationOff) {
      // Turned off mid-run: keep what was created as drafts.
      await cancelAllScheduled(userId, "Automation was turned off — kept as a draft");
      await finishRun(runId, userId, considered, "Automation was turned off during this run. Anything already prepared is in your Gmail drafts.");
      return;
    }
    const message = friendlyError(err);
    if (err instanceof GmailAuthError) {
      await execute("UPDATE gmail_connections SET status = IF(status = 'needs_reconnect', status, 'error'), last_error = ? WHERE user_id = ?", [err.message, userId]).catch(() => undefined);
    }
    log.error("run_failed", { ...ctx, newEmails, error: errInfo(err) });
    if (newEmails > 0) await finishRun(runId, userId, considered, `Stopped early: ${message}`).catch(() => undefined);
    else await failRun(runId, err instanceof GmailAuthError ? err.message : message).catch(() => undefined);
  }
}

/**
 * Auto-send items get a 30-minute cancel window from the run's finish time,
 * then the run's status and counts are computed.
 */
async function finishRun(runId: number, userId: number, considered: number, error: string | null = null) {
  const now = clock.now();
  if (await automationStillOn(userId)) {
    await execute("UPDATE run_items SET send_state = 'scheduled', send_at = ? WHERE run_id = ? AND type = 'auto_send' AND send_state = 'none'", [
      new Date(now.getTime() + SEND_POLICY.cancelWindowMinutes * MINUTE),
      runId,
    ]);
  } else {
    await execute("UPDATE run_items SET send_state = 'cancelled', skip_reason = 'Automation is off — kept as a draft', followup_mode = 'draft' WHERE run_id = ? AND type = 'auto_send' AND send_state = 'none'", [runId]);
  }
  await execute("UPDATE runs SET status = 'ready_to_send', finished_at = ?, jobs_considered = ?, error_message = ? WHERE id = ?", [now, considered, error, runId]);
  await refreshRunStatus(runId);
}

/** Users whose daily run is due now (same rule as the "Next run" hint). */
export async function dueUsers(now = clock.now()): Promise<RunnableProfile[]> {
  const today = istDate(now);
  const due: RunnableProfile[] = [];
  for (const p of await automationProfiles()) {
    if (missingForAutomation(p).length) continue;
    const ranToday = await hasScheduledRunOn(p.userId, today);
    if (isRunDue({ now, runTime: p.runTime, automationEnabled: p.automationEnabled, ranToday, settingsChangedAt: settingsChangedAt(p) })) due.push(p);
  }
  return due;
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]!);
    }),
  );
}

/**
 * The per-minute scheduler pass: claim and run every due user. Claims are
 * unique per user per IST date, so overlapping passes or processes are safe;
 * nobody is skipped under load (a user stays due for 3 hours).
 */
export async function runDueUsers(now = clock.now()): Promise<{ claimed: number; skipped: number }> {
  const users = await dueUsers(now);
  const today = istDate(now);
  let claimed = 0;
  let skipped = 0;
  await mapLimit(users, 2, async (p) => {
    const runId = await claimRun(p.userId, "scheduled", today, istInstant(today, p.runTime), now);
    if (!runId) {
      skipped++;
      return;
    }
    claimed++;
    await processRun(runId, p.userId);
  });
  if (users.length) log.info("scheduler_pass", { due: users.length, claimed, skipped });
  return { claimed, skipped };
}

const startingManual = new Set<number>();

/** "Run now" (automation must be ON). Doesn't count as, or replace, the day's scheduled run. */
export async function startManualRun(userId: number): Promise<{ runId: number; done: Promise<void> }> {
  if (startingManual.has(userId)) throw new HttpError(409, "A run is already in progress.");
  startingManual.add(userId);
  try {
    const profile = await loadProfile(userId);
    if (!profile?.automationEnabled) throw new HttpError(400, "Turn automation on to run.");
    const missing = missingForAutomation(profile);
    if (missing.length) throw new HttpError(400, `Finish setup first: ${missing.join(", ").toLowerCase()}.`);
    const f = features();
    if (!f.gemini) throw new HttpError(503, "AI (Gemini) is not configured on the server yet.");
    if (!f.mock && !f.adzuna && !f.jsearch) throw new HttpError(503, "No job sources are configured on the server yet.");
    if (await queryOne("SELECT id FROM runs WHERE user_id = ? AND status = 'running' LIMIT 1", [userId])) throw new HttpError(409, "A run is already in progress.");
    const now = clock.now();
    const last = await queryOne<{ started_at: Date }>("SELECT started_at FROM runs WHERE user_id = ? AND `trigger` = 'manual' ORDER BY started_at DESC LIMIT 1", [userId]);
    if (last) {
      const nextAllowed = new Date(last.started_at).getTime() + config().manualRunCooldownMin * MINUTE;
      if (nextAllowed > now.getTime()) {
        const mins = Math.ceil((nextAllowed - now.getTime()) / MINUTE);
        throw new HttpError(429, `You can run again in ${mins} minute${mins === 1 ? "" : "s"}.`, "cooldown");
      }
    }
    const runId = (await claimRun(userId, "manual", istDate(now), null, now))!;
    const done = processRun(runId, userId).catch((err) => log.error("manual_run_failed", { runId, userId, error: errInfo(err) }));
    return { runId, done };
  } finally {
    startingManual.delete(userId);
  }
}

/** Runs left "running" by a crash or restart are closed so they don't block the user. */
export async function closeStaleRuns(olderThanMinutes = 45, now = clock.now()): Promise<number> {
  const res = await execute(
    `UPDATE runs SET status = 'failed', error_message = 'Interrupted by a server restart. It will run again at the next scheduled time.', finished_at = ?
     WHERE status = 'running' AND started_at < ?`,
    [now, new Date(now.getTime() - olderThanMinutes * MINUTE)],
  );
  return res.affectedRows;
}

// ── automation switch ──────────────────────────────────────────────────────

/** The master switch. ON needs a complete profile and Gmail with all permissions; OFF cancels scheduled sends. */
export async function setAutomation(userId: number, enabled: boolean): Promise<void> {
  const now = clock.now();
  if (enabled) {
    const missing = missingForAutomation(await loadProfile(userId));
    if (missing.length) throw new HttpError(400, `Before turning automation on: ${missing.join(", ").toLowerCase()}.`, "incomplete");
  }
  const res = await execute("UPDATE profiles SET automation_enabled = ?, automation_changed_at = ? WHERE user_id = ? AND automation_enabled <> ?", [
    enabled ? 1 : 0,
    now,
    userId,
    enabled ? 1 : 0,
  ]);
  if (!enabled && res.affectedRows) await cancelAllScheduled(userId, "Automation was turned off — kept as a draft");
  if (res.affectedRows) log.info("automation_changed", { userId, enabled });
}
