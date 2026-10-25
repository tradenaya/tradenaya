import { AiKeyMissingError, AiKeyRejectedError, AiQuotaError, AiUnavailableError, checkJob, SCREEN_BATCH_SIZE, screenJobs } from "../ai/index.js";
import { geminiKeyOf, markGeminiKeyInvalid } from "../ai/user-key.js";
import type { ScreenResult } from "../ai/schemas.js";
import { config, features } from "../config/env.js";
import { execute, isDuplicateKey, query, queryOne } from "../db/pool.js";
import { gmail } from "../gmail/index.js";
import { buildMimeMessage, generateMessageId, toBase64Url } from "../gmail/mime.js";
import { collectJobs } from "../jobs/fetch.js";
import type { Job, SearchPair } from "../jobs/types.js";
import { clock, DAY, MINUTE } from "../lib/clock.js";
import { GmailAuthError, HttpError, sleep } from "../lib/errors.js";
import { errInfo, log } from "../lib/logger.js";
import { istDate, istDayStart, istInstant, isRunDue, nextRunAt } from "../lib/time.js";
import { applicationEmailsIn } from "../matching/emails.js";
import { findExcluded, type ExcludedCompany } from "../matching/exclusions.js";
import { applyRuleFilter } from "../matching/filters.js";
import { locationMatches } from "../matching/locations.js";
import { companyKey } from "../matching/text.js";
import { titleMatchesAny } from "../matching/titles.js";
import { storage } from "../storage/index.js";
import { emptyFunnel, stepOf, zeroFetchReason, type Funnel } from "./funnel.js";
import {
  automationOnProfiles,
  gmailUsable,
  hasScheduledRunAt,
  listExcluded,
  loadProfile,
  missingForAutomation,
  refreshTokenOf,
  settingsChangedAt,
  type RunnableProfile,
} from "./profile.js";
import { classifyAutoSend, decideDraft, DEFAULT_SEND_MODE, DRAFTS_ONLY_REASON, SEND_MODES, SEND_POLICY, type SendMode } from "./safety.js";
import { cancelAllScheduled } from "./send-queue.js";
import { refreshRunStatus } from "./status.js";
import { trackUser } from "./tracking.js";

export const LIMITS = {
  maxNewEmailsPerRun: SEND_POLICY.maxNewEmailsPerRun,
  maxLinkOnlyPerRun: SEND_POLICY.maxLinkOnlyPerRun,
  companyCooldownDays: 60,
  /** Failed AI calls in a row (screen batches or email writing) before the run stops. */
  consecutiveAiFailuresToAbort: 2,
  /** A run that takes longer stops with what it has. */
  runTimeoutMs: 20 * MINUTE,
  /** Runs still "running" after this long are closed as interrupted. */
  staleRunMinutes: 45,
  /** Runs processed at once by one server process. */
  concurrentRuns: 2,
};

export type Trigger = "scheduled" | "manual";

const GMAIL_EXPIRED = "Gmail access expired — please reconnect";

class RunAbort extends Error {}
class RunTimeout extends Error {}
class AutomationOff extends Error {}

function friendlyError(err: unknown): string {
  if (err instanceof GmailAuthError) return GMAIL_EXPIRED;
  if (err instanceof AiKeyMissingError || err instanceof AiKeyRejectedError) return err.message;
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

const funnelJson = (f: Funnel | null) => (f ? JSON.stringify(f) : null);

async function failRun(runId: number, message: string, funnel: Funnel | null = null) {
  await execute("UPDATE runs SET status = 'failed', error_message = ?, finished_at = ?, funnel = CAST(? AS JSON) WHERE id = ?", [
    message.slice(0, 500),
    clock.now(),
    funnelJson(funnel),
    runId,
  ]);
}

async function markSeen(userId: number, jobKey: string, now: Date) {
  await execute("INSERT INTO seen_jobs (user_id, job_key, seen_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE seen_at = VALUES(seen_at)", [userId, jobKey.slice(0, 191), now]);
}

async function automationStillOn(userId: number): Promise<boolean> {
  const row = await queryOne<{ automation_enabled: number }>("SELECT automation_enabled FROM profiles WHERE user_id = ?", [userId]);
  return !!row?.automation_enabled;
}

/** The mode right now (it may change during a run; it applies to emails created after the change). */
export async function currentSendMode(userId: number): Promise<SendMode> {
  const row = await queryOne<{ send_mode: SendMode | null }>("SELECT send_mode FROM profiles WHERE user_id = ?", [userId]);
  return row?.send_mode ?? DEFAULT_SEND_MODE;
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

function bump<K extends string>(map: Partial<Record<K, number>>, key: K, by = 1) {
  map[key] = (map[key] ?? 0) + by;
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function insertLinkOnly(runId: number, userId: number, job: Job, note: string, confidence: number | null, now: Date) {
  await execute(
    `INSERT INTO run_items (run_id, user_id, type, company, company_key, job_title, location, job_url, source, query_variant, posted_at, note, confidence, created_at)
     VALUES (?, ?, 'link_only', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [runId, userId, job.company.slice(0, 255), companyKey(job.company), job.title.slice(0, 255), job.location.slice(0, 255), job.url.slice(0, 2048), job.source,
      job.variant ?? null, job.postedAt ? new Date(job.postedAt) : null, note.slice(0, 300), confidence, now],
  );
}

/**
 * Fetch → filter → AI screen (5 per call, up to 15 per run) → an email for
 * each suitable posting that states an application address, "apply via link"
 * for the rest. Never throws: failures are recorded on the run with the funnel
 * so far. Drafts already created stay in Gmail whatever happens later.
 */
export async function processRun(runId: number, userId: number): Promise<void> {
  const ctx = { runId, userId };
  const started = Date.now();
  const deadline = started + LIMITS.runTimeoutMs;
  const funnel = emptyFunnel();
  let newEmails = 0;
  const checkTime = () => {
    if (Date.now() > deadline) throw new RunTimeout();
  };
  try {
    const profile = await loadProfile(userId);
    if (!profile?.resume || !profile.resumePublicId || !profile.gmailAddress) throw new HttpError(400, "Finish setup first.");
    const token = refreshTokenOf(profile);
    if (!token || !gmailUsable(profile)) throw new GmailAuthError(profile.gmailStatus === "needs_reconnect" ? "Gmail needs to be reconnected with all permissions" : GMAIL_EXPIRED);
    const resume = profile.resume;
    const apiKey = geminiKeyOf(profile);
    if (!apiKey) throw new AiKeyMissingError();

    // 1. Fresh sent/reply states before writing anything new.
    await trackUser(userId).catch((err) => log.warn("run_tracking_failed", { ...ctx, error: errInfo(err) }));
    if (!(await automationStillOn(userId))) throw new AutomationOff();

    // 2. Jobs from every source (shared cache, daily caps).
    const quickMatch = (j: Job) => locationMatches(j, profile.locations) && titleMatchesAny(j.title, profile.targetRoles);
    const collected = await collectJobs(pairsFor(profile), { isRelevant: quickMatch });
    funnel.sources = collected.sources;
    funnel.queries = collected.queries;
    funnel.fetched = collected.jobs.length;
    for (const j of collected.jobs) if (j.variant) (funnel.variants[j.variant] ??= { fetched: 0, emailApply: 0 }).fetched++;
    if (!collected.jobs.length) funnel.note = zeroFetchReason(collected.sources);
    log.info("run_jobs_fetched", { ...ctx, fetched: funnel.fetched, sources: collected.sources.map((s) => ({ source: s.source, calls: s.calls, cached: s.cached, fetched: s.fetched, errors: s.errors.length })) });
    checkTime();

    // 3. Rule filter — excluded companies (past/current employers) first.
    const excluded: ExcludedCompany[] = await listExcluded(userId);
    const history = await loadHistory(userId, collected.jobs, clock.now());
    const notExcluded = collected.jobs.filter((j) => !findExcluded({ company: j.company, url: j.url }, excluded));
    if (collected.jobs.length > notExcluded.length) funnel.removed.excluded = collected.jobs.length - notExcluded.length;
    const { passed, rejected } = applyRuleFilter(notExcluded, {
      targetRoles: profile.targetRoles,
      locations: profile.locations,
      experienceYears: profile.experienceYears,
      expectedSalaryLpa: profile.expectedSalaryLpa ?? 0,
      seenJobKeys: history.seen,
      recentCompanyKeys: history.recent,
    });
    for (const r of rejected) bump(funnel.removed, stepOf(r.reason));
    funnel.afterFilters = passed.length;
    // Postings that state an email can become applications: screen those first (newest first within each group).
    // Most promising first, so a key that hits its limit early is spent on the best postings:
    // an application email (only those can become emails) > a close title match to a target role
    // > JSearch (full descriptions) > newest. Every target role counts equally (career moves too).
    const closeTitle = (j: Job) => profile.targetRoles.some((r) => j.title.toLowerCase().includes(r.toLowerCase()));
    const priority = (j: Job) => (applicationEmailsIn(j.description).length ? 8 : 0) + (closeTitle(j) ? 4 : 0) + (j.source === "jsearch" ? 2 : 0);
    passed.sort((a, b) => priority(b) - priority(a));
    // No fixed cap by default: screen until done, the key's limit, or the run's time limit.
    const cap = config().maxScreenPerRun;
    const toScreen = cap > 0 ? passed.slice(0, cap) : passed;
    funnel.notChecked = passed.length - toScreen.length;
    let quotaHit = false;
    log.info("run_filtered", { ...ctx, fetched: funnel.fetched, passed: passed.length, screening: toScreen.length });

    // 4. AI screen in batches, then an email or a link for each suitable posting.
    let aiFailuresInARow = 0;
    let attachment: Buffer | null = null;
    const draftedCompanies = new Set<string>();
    let dayAutoSends = await autoSendsToday(userId, clock.now());
    let linkOnly = 0;
    let firstAiCall = true;
    const delayMs = config().gemini.delayMs;
    const pace = async () => {
      if (!firstAiCall && delayMs > 0) await sleep(delayMs);
      firstAiCall = false;
    };

    const batches = chunks(toScreen, SCREEN_BATCH_SIZE);
    for (const [bi, batch] of batches.entries()) {
      if (quotaHit || Date.now() > deadline - 60_000) {
        // Out of AI quota or time: the rest are checked next run (they're not marked seen).
        funnel.notChecked += batches.slice(bi).reduce((n, b) => n + b.length, 0);
        break;
      }
      if (!(await automationStillOn(userId))) throw new AutomationOff();
      await pace();
      let results: (ScreenResult | null)[];
      try {
        results = await screenJobs({ apiKey, jobs: batch, resume, experienceYears: profile.experienceYears, targetRoles: profile.targetRoles });
        aiFailuresInARow = 0;
      } catch (err) {
        if (err instanceof AiKeyRejectedError) throw err; // retrying with the same key can't help
        if (err instanceof AiQuotaError) {
          quotaHit = true;
          funnel.notChecked += batch.length;
          continue; // stop screening calmly; keep what this run made
        }
        aiFailuresInARow++;
        log.warn("run_ai_screen_failed", { ...ctx, error: errInfo(err) });
        if (aiFailuresInARow >= LIMITS.consecutiveAiFailuresToAbort) throw new RunAbort("AI unavailable");
        funnel.notChecked += batch.length;
        continue; // not marked seen — screened again next run
      }

      for (const [i, job] of batch.entries()) {
        const res = results[i];
        if (!res) {
          funnel.notChecked++;
          continue; // the model skipped it — retried next run
        }
        funnel.aiChecked++;
        const now = clock.now();
        const cKey = companyKey(job.company);
        if (!res.suitable || res.scam_or_spam_signals || res.is_staffing_agency) {
          await markSeen(userId, job.key, now);
          continue;
        }
        if (findExcluded({ company: job.company, realEmployer: res.real_employer_name, url: job.url }, excluded)) {
          bump(funnel.removed, "excluded");
          await markSeen(userId, job.key, now);
          continue;
        }
        funnel.suitable++;
        const emails = applicationEmailsIn(job.description);
        if (emails.length) {
          funnel.emailsFound++;
          if (job.variant) (funnel.variants[job.variant] ??= { fetched: 0, emailApply: 0 }).emailApply++;
        }

        // An application email for this posting (one per company per run, within the caps).
        if (emails.length && !draftedCompanies.has(cKey) && newEmails < LIMITS.maxNewEmailsPerRun) {
          checkTime();
          if (!(await automationStillOn(userId))) throw new AutomationOff();
          await pace();
          let check;
          try {
            check = await checkJob({ apiKey, job, resume, experienceYears: profile.experienceYears, targetRoles: profile.targetRoles });
            aiFailuresInARow = 0;
          } catch (err) {
            if (err instanceof AiKeyRejectedError) throw err;
            if (err instanceof AiQuotaError) {
              quotaHit = true;
              break; // no more AI today: this posting and the rest are checked next run
            }
            aiFailuresInARow++;
            log.warn("run_ai_check_failed", { ...ctx, error: errInfo(err) });
            if (aiFailuresInARow >= LIMITS.consecutiveAiFailuresToAbort) throw new RunAbort("AI unavailable");
            continue; // not marked seen — written next run
          }
          const decision = decideDraft({ check, job, resume, expectedSalaryLpa: profile.expectedSalaryLpa ?? 0, experienceYears: profile.experienceYears, excluded });
          if (decision.kind === "skip") {
            await markSeen(userId, job.key, now);
            continue;
          }
          if (decision.kind === "draft") {
            if (history.emails.has(decision.to)) {
              await markSeen(userId, job.key, now); // this address was emailed before — never again
              continue;
            }
            const mode = await currentSendMode(userId);
            const type = classifyAutoSend({
              mode,
              confidence: decision.confidence,
              scam: check.scam_or_spam_signals,
              agency: check.is_staffing_agency,
              automationOn: true,
              gmailConnected: true,
              autoSendsThisRun: funnel.autoSent,
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
              `INSERT INTO run_items (run_id, user_id, type, send_mode, company, company_key, job_title, location, job_url, source, query_variant, posted_at, to_email, subject, body_preview,
                 confidence, gmail_draft_id, gmail_thread_id, gmail_message_id, rfc_message_id, send_state, followup_mode, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'none', ?, ?)`,
              [
                runId, userId, type, mode, job.company.slice(0, 255), cKey, job.title.slice(0, 255), job.location.slice(0, 255), job.url.slice(0, 2048), job.source,
                job.variant ?? null, job.postedAt ? new Date(job.postedAt) : null, decision.to, decision.subject.slice(0, 255), decision.body.slice(0, 600),
                decision.confidence, draft.draftId, draft.threadId, draft.messageId, messageId, type === "auto_send" ? "auto" : "draft", now,
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
              funnel.autoSent++;
              dayAutoSends++;
            } else funnel.drafted++;
            continue;
          }
          // decision.kind === "link_only": a safety check failed — fall through to the link list with its reason.
          if (linkOnly >= LIMITS.maxLinkOnlyPerRun) continue; // cap: not marked seen
          await insertLinkOnly(runId, userId, job, decision.reason, check.confidence, now);
          await markSeen(userId, job.key, now);
          linkOnly++;
          funnel.linkOnly++;
          continue;
        }

        // Suitable, but no email to write to (or the email caps are reached): apply via the link.
        if (draftedCompanies.has(cKey)) continue; // one company per run; considered again next run
        if (linkOnly >= LIMITS.maxLinkOnlyPerRun) continue; // cap: not marked seen
        const note = emails.length ? "Email limit for this run reached — apply via the link" : "No application email in the posting — apply on their site";
        await insertLinkOnly(runId, userId, job, note, res.confidence, now);
        await markSeen(userId, job.key, now);
        linkOnly++;
        funnel.linkOnly++;
      }
    }

    if (quotaHit) funnel.note = `Your Gemini key reached its usage limit. ${funnel.notChecked} postings will be checked in the next run.`;
    await finishRun(runId, userId, funnel, funnel.note ?? null);
    log.info("run_finished", { ...ctx, newEmails, autoSends: funnel.autoSent, linkOnly: funnel.linkOnly, screened: funnel.aiChecked, ms: Date.now() - started });
  } catch (err) {
    if (err instanceof AutomationOff) {
      // Turned off mid-run: keep what was created as drafts.
      await cancelAllScheduled(userId, "Automation was turned off — kept as a draft");
      await finishRun(runId, userId, funnel, "Automation was turned off during this run. Anything already prepared is in your Gmail drafts.");
      return;
    }
    if (err instanceof RunTimeout) {
      log.warn("run_timed_out", ctx);
      await finishRun(runId, userId, funnel, `Stopped after ${LIMITS.runTimeoutMs / MINUTE} minutes. Anything already prepared is kept; the rest is checked next run.`).catch(() => undefined);
      return;
    }
    const message = friendlyError(err);
    if (err instanceof AiKeyRejectedError) await markGeminiKeyInvalid(userId).catch(() => undefined);
    if (err instanceof GmailAuthError) {
      await execute("UPDATE gmail_connections SET status = IF(status = 'needs_reconnect', status, 'error'), last_error = ? WHERE user_id = ?", [err.message, userId]).catch(() => undefined);
    }
    log.error("run_failed", { ...ctx, newEmails, error: errInfo(err) });
    if (newEmails > 0) await finishRun(runId, userId, funnel, `Stopped early: ${message}`).catch(() => undefined);
    else await failRun(runId, err instanceof GmailAuthError ? err.message : message, funnel).catch(() => undefined);
  }
}

/**
 * Auto-send items are queued from the run's finish time: after the 30-minute
 * cancel window, or at once in "send all instantly" (the send queue still keeps
 * 2–4 minutes between sends). Then the run's status and counts are computed.
 */
async function finishRun(runId: number, userId: number, funnel: Funnel, note: string | null = null) {
  const now = clock.now();
  const automationOn = await automationStillOn(userId);
  if (automationOn && (await currentSendMode(userId)) === "drafts_only") {
    // Switched to drafts only during the run: nothing from it is sent.
    await execute(
      "UPDATE run_items SET send_state = 'cancelled', skip_reason = 'Mode changed to drafts only — kept as a draft', followup_mode = 'draft' WHERE run_id = ? AND type = 'auto_send' AND send_state = 'none'",
      [runId],
    );
  } else if (automationOn) {
    const windowed = new Date(now.getTime() + SEND_MODES.smart.cancelWindowMinutes * MINUTE);
    await execute(
      "UPDATE run_items SET send_state = 'scheduled', send_at = IF(send_mode = 'send_all_instant', ?, ?) WHERE run_id = ? AND type = 'auto_send' AND send_state = 'none'",
      [now, windowed, runId],
    );
  } else {
    await execute("UPDATE run_items SET send_state = 'cancelled', skip_reason = 'Automation is off — kept as a draft', followup_mode = 'draft' WHERE run_id = ? AND type = 'auto_send' AND send_state = 'none'", [runId]);
  }
  await execute("UPDATE runs SET status = 'ready_to_send', finished_at = ?, jobs_considered = ?, error_message = ?, funnel = CAST(? AS JSON) WHERE id = ?", [
    now,
    funnel.fetched,
    note ? note.slice(0, 500) : null,
    funnelJson(funnel),
    runId,
  ]);
  await refreshRunStatus(runId);
}

// ── scheduler ──────────────────────────────────────────────────────────────

/** Why an automation-ON user's due run can't start (shown on the run card). */
export function blockedMessage(missing: string[]): string {
  return `Today's run couldn't start: ${missing.join(", ").toLowerCase()}. Automation is still on — fix this, then press Run now or wait for tomorrow's run.`;
}

export interface SchedulerEvaluation {
  /** Automation ON, run due now, nothing missing. */
  due: RunnableProfile[];
  /** Automation ON and due now, but setup or Gmail blocks the run. */
  blocked: { profile: RunnableProfile; missing: string[] }[];
  /** Automation ON but not due now, by reason. */
  waiting: Record<string, number>;
  automationOn: number;
}

/** Every automation-ON user, sorted into due / blocked / waiting — the same rule as the "Next run" hint. */
export async function evaluateUsers(now = clock.now()): Promise<SchedulerEvaluation> {
  const today = istDate(now);
  const out: SchedulerEvaluation = { due: [], blocked: [], waiting: {}, automationOn: 0 };
  for (const p of await automationOnProfiles()) {
    out.automationOn++;
    try {
      const slotRanToday = await hasScheduledRunAt(p.userId, today, p.runTime);
      const input = { now, runTime: p.runTime, automationEnabled: p.automationEnabled, slotRanToday, settingsChangedAt: settingsChangedAt(p) };
      if (!isRunDue(input)) {
        bump(out.waiting, slotRanToday ? "ran today" : "not yet due");
        continue;
      }
      const missing = missingForAutomation(p);
      if (missing.length) out.blocked.push({ profile: p, missing });
      else out.due.push(p);
    } catch (err) {
      bump(out.waiting, "error");
      log.error("scheduler_user_failed", { userId: p.userId, error: errInfo(err) });
    }
  }
  return out;
}

/** Explains one user's schedule (used by the diagnose command). */
export function explainSchedule(p: RunnableProfile, slotRanToday: boolean, now: Date) {
  const input = { now, runTime: p.runTime, automationEnabled: p.automationEnabled, slotRanToday, settingsChangedAt: settingsChangedAt(p) };
  return { nextRunAt: nextRunAt(input), dueNow: isRunDue(input), missing: missingForAutomation(p) };
}

export interface Claims {
  runs: { runId: number; userId: number }[];
  skipped: number;
  blocked: number;
}

/**
 * The quick part of a scheduler pass (done under the scheduler lock): close
 * stale runs, claim one scheduled run per due user per IST day, and record a
 * failed "couldn't start" run for due users whose setup or Gmail blocks it —
 * so a missed day is always visible in History, never silent.
 */
export async function claimDueRuns(now = clock.now()): Promise<Claims> {
  await closeStaleRuns(LIMITS.staleRunMinutes, now).catch((err) => log.warn("stale_runs_close_failed", { error: errInfo(err) }));
  const ev = await evaluateUsers(now);
  const today = istDate(now);
  const claims: Claims = { runs: [], skipped: 0, blocked: 0 };
  for (const p of ev.due) {
    const runId = await claimRun(p.userId, "scheduled", today, istInstant(today, p.runTime), now);
    if (runId) claims.runs.push({ runId, userId: p.userId });
    else claims.skipped++;
  }
  for (const { profile, missing } of ev.blocked) {
    const runId = await claimRun(profile.userId, "scheduled", today, istInstant(today, profile.runTime), now);
    if (!runId) {
      claims.skipped++;
      continue;
    }
    claims.blocked++;
    await failRun(runId, blockedMessage(missing));
    log.warn("scheduled_run_blocked", { userId: profile.userId, runId, missing: missing.length });
  }
  log.debug("scheduler_tick", { automationOn: ev.automationOn, due: ev.due.length, blocked: ev.blocked.length, waiting: ev.waiting });
  if (claims.runs.length || claims.blocked) log.info("scheduler_pass", { claimed: claims.runs.length, blocked: claims.blocked, skipped: claims.skipped });
  return claims;
}

// At most LIMITS.concurrentRuns runs at once in this process, across scheduler passes.
let active = 0;
const waiters: (() => void)[] = [];
async function withRunSlot<T>(fn: () => Promise<T>): Promise<T> {
  while (active >= LIMITS.concurrentRuns) await new Promise<void>((r) => waiters.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiters.shift()?.();
  }
}

/** The slow part, outside the scheduler lock: process claimed runs (each never throws). */
export async function processClaimed(runs: Claims["runs"]): Promise<void> {
  await Promise.all(runs.map(({ runId, userId }) => withRunSlot(() => processRun(runId, userId))));
}

/** One full scheduler pass: claim, then process (awaited). */
export async function runDueUsers(now = clock.now()): Promise<{ claimed: number; skipped: number; blocked: number }> {
  const claims = await claimDueRuns(now);
  await processClaimed(claims.runs);
  return { claimed: claims.runs.length, skipped: claims.skipped, blocked: claims.blocked };
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
    const done = withRunSlot(() => processRun(runId, userId)).catch((err) => log.error("manual_run_failed", { runId, userId, error: errInfo(err) }));
    return { runId, done };
  } finally {
    startingManual.delete(userId);
  }
}

/** Runs left "running" by a crash, restart or hang are closed so they don't block the user. */
export async function closeStaleRuns(olderThanMinutes: number = LIMITS.staleRunMinutes, now = clock.now()): Promise<number> {
  const res = await execute(
    `UPDATE runs SET status = 'failed', error_message = 'Interrupted (server restart or timeout). It will run again at the next scheduled time.', finished_at = ?
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

/**
 * Sending mode (only while automation is ON). Applies to emails created after
 * the change. Drafts only cancels every scheduled send and follow-up at once
 * (they stay Gmail drafts); a send mode never sends existing drafts.
 */
export async function setSendMode(userId: number, mode: SendMode): Promise<void> {
  const profile = await loadProfile(userId);
  if (!profile?.automationEnabled) throw new HttpError(400, "Turn on automation to use sending modes.", "automation_off");
  if (profile.sendMode === mode) return;
  await execute("UPDATE profiles SET send_mode = ?, send_mode_changed_at = ? WHERE user_id = ?", [mode, clock.now(), userId]);
  if (mode === "drafts_only") await cancelAllScheduled(userId, `${DRAFTS_ONLY_REASON[0]!.toUpperCase()}${DRAFTS_ONLY_REASON.slice(1)} — kept as a draft`);
  log.info("send_mode_changed", { userId, mode });
}
