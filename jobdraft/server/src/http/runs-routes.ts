import { Router } from "express";
import { z } from "zod";
import { config, features, missingFeatureMessages } from "../config/env.js";
import { json, query, queryOne } from "../db/pool.js";
import { clock, DAY, MINUTE } from "../lib/clock.js";
import { HttpError } from "../lib/errors.js";
import type { Funnel } from "../runs/funnel.js";
import { stopFollowUps } from "../runs/followups.js";
import { startManualRun } from "../runs/runner.js";
import { cancelFollowUp, cancelItemSend, cancelRunSends } from "../runs/send-queue.js";
import { trackUser } from "../runs/tracking.js";
import { h, idParam, parse, requireAuth, userOf } from "./common.js";
import { profilePayload } from "./profile-routes.js";

interface RunRow {
  id: number;
  trigger: string;
  run_date: string;
  scheduled_for: Date | null;
  status: string;
  started_at: Date;
  finished_at: Date | null;
  drafts_count: number;
  auto_send_count: number;
  sent_count: number;
  link_only_count: number;
  jobs_considered: number;
  error_message: string | null;
  funnel: unknown;
}

const RUN_COLUMNS =
  "id, `trigger`, run_date, scheduled_for, status, started_at, finished_at, drafts_count, auto_send_count, sent_count, link_only_count, jobs_considered, error_message, funnel";

function runDto(r: RunRow) {
  return {
    id: Number(r.id),
    trigger: r.trigger,
    runDate: r.run_date,
    scheduledFor: r.scheduled_for,
    status: r.status,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    draftsCount: r.drafts_count,
    autoSendCount: r.auto_send_count,
    sentCount: r.sent_count,
    linkOnlyCount: r.link_only_count,
    jobsConsidered: r.jobs_considered,
    errorMessage: r.error_message,
    funnel: json<Funnel | null>(r.funnel, null),
  };
}

interface ItemRow {
  id: number;
  run_id: number;
  type: "draft" | "auto_send" | "link_only";
  send_mode: string | null;
  sent_by: "auto" | "user" | null;
  company: string;
  job_title: string;
  location: string | null;
  job_url: string | null;
  source: string;
  to_email: string | null;
  subject: string | null;
  confidence: number | null;
  send_state: string;
  send_at: Date | null;
  sent_at: Date | null;
  skip_reason: string | null;
  reply_state: string;
  replied_at: Date | null;
  followup_mode: string;
  followups_stopped: number;
  outcome: string;
  note: string | null;
  created_at: Date;
}

interface FollowUpDto {
  id: number;
  runItemId: number;
  sequence: number;
  mode: string;
  state: string;
  dueAt: Date;
  sendAt: Date | null;
  sentAt: Date | null;
  skipReason: string | null;
  createdAt: Date;
}

/** How an application was handled: sent automatically, sent by the user, or still a draft. */
export function handlingOf(i: Pick<ItemRow, "send_state" | "sent_by">): { key: "auto" | "user" | "scheduled" | "draft" | "removed"; label: string } {
  if (i.send_state === "sent") return i.sent_by === "auto" ? { key: "auto", label: "Sent automatically" } : { key: "user", label: "Sent by you" };
  if (i.send_state === "scheduled" || i.send_state === "sending") return { key: "scheduled", label: "Will be sent automatically" };
  if (i.send_state === "removed") return { key: "removed", label: "Removed from your drafts" };
  return { key: "draft", label: "Draft – waiting for you" };
}

/** The single status chip shown for an application. */
export function statusChip(i: ItemRow, fus: FollowUpDto[]): { key: string; label: string; at?: Date | null } {
  const fu = (n: number) => fus.find((f) => f.sequence === n);
  if (i.outcome === "replied") return { key: "replied", label: "Replied", at: i.replied_at };
  if (i.outcome === "bounced") return { key: "bounced", label: "Bounced", at: i.replied_at };
  if (i.outcome === "no_response") return { key: "no_response", label: "No response" };
  if (i.outcome === "stopped") return { key: "stopped", label: "Stopped" };
  if (i.send_state === "removed") return { key: "removed", label: "Removed" };
  if (i.send_state === "skipped") return { key: "skipped", label: `Skipped: ${i.skip_reason ?? "not sent"}` };
  if (i.send_state === "failed") return { key: "failed", label: "Couldn't send — kept as a draft" };
  if (i.send_state === "cancelled") return { key: "cancelled", label: "Cancelled — kept as a draft" };
  if (i.send_state === "scheduled" || i.send_state === "sending") return { key: "scheduled", label: "Scheduled", at: i.send_at };
  if (i.send_state === "none") return { key: "draft", label: "Draft – waiting for you" };
  for (const n of [2, 1]) {
    const f = fu(n);
    if (!f) continue;
    if (f.state === "sent") return { key: `followup${n}_sent`, label: `Follow-up ${n} sent`, at: f.sentAt };
    if (f.state === "scheduled" || f.state === "sending") return { key: `followup${n}_scheduled`, label: `Follow-up ${n} scheduled`, at: f.sendAt };
    if (f.state === "draft_created") return { key: "followup_draft", label: "Follow-up draft ready" };
  }
  return { key: "sent", label: "Sent", at: i.sent_at };
}

function itemDto(i: ItemRow, fus: FollowUpDto[]) {
  const mine = fus.filter((f) => f.runItemId === Number(i.id));
  const sentFollowUps = mine.filter((f) => f.state === "sent").length;
  return {
    id: Number(i.id),
    type: i.type,
    company: i.company,
    jobTitle: i.job_title,
    location: i.location,
    jobUrl: i.job_url,
    source: i.source,
    toEmail: i.to_email,
    subject: i.subject,
    confidence: i.confidence,
    sendState: i.send_state,
    sendAt: i.send_at,
    sentAt: i.sent_at,
    replyState: i.reply_state,
    repliedAt: i.replied_at,
    outcome: i.outcome,
    followupMode: i.followup_mode,
    followupsStopped: !!i.followups_stopped,
    note: i.note,
    skipReason: i.skip_reason,
    createdAt: i.created_at,
    sendMode: i.send_mode,
    handling: handlingOf(i),
    status: statusChip(i, mine),
    followups: mine,
    canCancel: i.send_state === "scheduled",
    canStopFollowUps: i.type !== "link_only" && i.outcome === "open" && !i.followups_stopped && i.send_state === "sent" && sentFollowUps < 2,
  };
}

async function followUpsFor(itemIds: number[]): Promise<FollowUpDto[]> {
  if (!itemIds.length) return [];
  const rows = await query<{
    id: number;
    run_item_id: number;
    sequence: number;
    mode: string;
    state: string;
    due_at: Date;
    send_at: Date | null;
    sent_at: Date | null;
    skip_reason: string | null;
    created_at: Date;
  }>("SELECT id, run_item_id, sequence, mode, state, due_at, send_at, sent_at, skip_reason, created_at FROM followups WHERE run_item_id IN (?) ORDER BY sequence", [itemIds]);
  return rows.map((f) => ({
    id: Number(f.id),
    runItemId: Number(f.run_item_id),
    sequence: f.sequence,
    mode: f.mode,
    state: f.state,
    dueAt: f.due_at,
    sendAt: f.send_at,
    sentAt: f.sent_at,
    skipReason: f.skip_reason,
    createdAt: f.created_at,
  }));
}

const ITEM_COLUMNS = `id, run_id, type, send_mode, sent_by, company, job_title, location, job_url, source, to_email, subject, confidence, send_state, send_at, sent_at, skip_reason,
  reply_state, replied_at, followup_mode, followups_stopped, outcome, note, created_at`;

const listQuery = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(30).default(10),
});

const lastTracked = new Map<number, number>();

export function runsRouter() {
  const r = Router();
  r.use(requireAuth);

  r.get(
    "/dashboard",
    h(async (req, res) => {
      const userId = userOf(req).id;
      const now = clock.now();
      const since = new Date(now.getTime() - 30 * DAY);
      const [profile, last, lastManual, upcomingItems, upcomingFus, fuDrafts, stats] = await Promise.all([
        profilePayload(userId),
        queryOne<RunRow>(`SELECT ${RUN_COLUMNS} FROM runs WHERE user_id = ? ORDER BY started_at DESC, id DESC LIMIT 1`, [userId]),
        queryOne<{ started_at: Date }>("SELECT started_at FROM runs WHERE user_id = ? AND `trigger` = 'manual' ORDER BY started_at DESC LIMIT 1", [userId]),
        query<{ id: number; company: string; job_title: string; to_email: string; send_at: Date; run_id: number }>(
          "SELECT id, company, job_title, to_email, send_at, run_id FROM run_items WHERE user_id = ? AND send_state = 'scheduled' ORDER BY send_at, id LIMIT 30",
          [userId],
        ),
        query<{ id: number; sequence: number; send_at: Date; company: string; job_title: string; to_email: string; item_id: number }>(
          `SELECT f.id, f.sequence, f.send_at, i.company, i.job_title, i.to_email, i.id AS item_id FROM followups f JOIN run_items i ON i.id = f.run_item_id
           WHERE f.user_id = ? AND f.state = 'scheduled' ORDER BY f.send_at, f.id LIMIT 30`,
          [userId],
        ),
        query<{ id: number; sequence: number; created_at: Date; company: string; job_title: string; item_id: number }>(
          `SELECT f.id, f.sequence, f.created_at, i.company, i.job_title, i.id AS item_id FROM followups f JOIN run_items i ON i.id = f.run_item_id
           WHERE f.user_id = ? AND f.state = 'draft_created' ORDER BY f.created_at`,
          [userId],
        ),
        queryOne<{ sent: number; replies: number; no_response: number; followups: number }>(
          `SELECT
             (SELECT COUNT(*) FROM run_items WHERE user_id = ? AND send_state = 'sent' AND sent_at >= ?) AS sent,
             (SELECT COUNT(*) FROM run_items WHERE user_id = ? AND reply_state = 'replied' AND replied_at >= ?) AS replies,
             (SELECT COUNT(*) FROM run_items WHERE user_id = ? AND outcome = 'no_response' AND created_at >= ?) AS no_response,
             (SELECT COUNT(*) FROM followups WHERE user_id = ? AND state = 'sent' AND sent_at >= ?) AS followups`,
          [userId, since, userId, since, userId, since, userId, since],
        ),
      ]);
      const cooldownUntil = lastManual ? new Date(new Date(lastManual.started_at).getTime() + config().manualRunCooldownMin * MINUTE) : null;
      const upcoming = [
        ...upcomingItems.map((i) => ({ kind: "email" as const, id: Number(i.id), itemId: Number(i.id), runId: Number(i.run_id), label: "Application", company: i.company, jobTitle: i.job_title, toEmail: i.to_email, sendAt: i.send_at })),
        ...upcomingFus.map((f) => ({ kind: "followup" as const, id: Number(f.id), itemId: Number(f.item_id), runId: null, label: `Follow-up ${f.sequence}/2`, company: f.company, jobTitle: f.job_title, toEmail: f.to_email, sendAt: f.send_at })),
      ].sort((a, b) => new Date(a.sendAt).getTime() - new Date(b.sendAt).getTime());
      res.json({
        automation: profile.automation,
        nextRunAt: profile.nextRunAt,
        runTime: profile.preferences.runTime,
        lastRun: last ? runDto(last) : null,
        upcoming,
        followupDrafts: fuDrafts.map((f) => ({ id: Number(f.id), itemId: Number(f.item_id), sequence: f.sequence, company: f.company, jobTitle: f.job_title, createdAt: f.created_at, expiresAt: new Date(new Date(f.created_at).getTime() + 7 * DAY) })),
        stats30: { sent: Number(stats?.sent ?? 0), replies: Number(stats?.replies ?? 0), followups: Number(stats?.followups ?? 0), noResponse: Number(stats?.no_response ?? 0) },
        runNowAvailableAt: cooldownUntil && cooldownUntil > now ? cooldownUntil : null,
        sendingPausedUntil: profile.gmail.sendPausedUntil,
        profile,
        notConfigured: missingFeatureMessages(),
        mock: features().mock,
        now,
      });
    }),
  );

  r.get(
    "/runs",
    h(async (req, res) => {
      const q = parse(listQuery, req.query);
      const rows = await query<RunRow>(
        `SELECT ${RUN_COLUMNS} FROM runs WHERE user_id = ? ${q.before ? "AND id < ?" : ""} ORDER BY id DESC LIMIT ?`,
        q.before ? [userOf(req).id, q.before, q.limit + 1] : [userOf(req).id, q.limit + 1],
      );
      const page = rows.slice(0, q.limit);
      res.json({ runs: page.map(runDto), nextCursor: rows.length > q.limit ? Number(page[page.length - 1]!.id) : null });
    }),
  );

  r.post(
    "/runs",
    h(async (req, res) => {
      const { runId } = await startManualRun(userOf(req).id);
      const run = await queryOne<RunRow>(`SELECT ${RUN_COLUMNS} FROM runs WHERE id = ?`, [runId]);
      res.status(202).json({ run: runDto(run!) });
    }),
  );

  // History opened: refresh sent/replied/bounced states from Gmail (at most once a minute).
  r.post(
    "/runs/refresh",
    h(async (req, res) => {
      const userId = userOf(req).id;
      const now = Date.now();
      if (now - (lastTracked.get(userId) ?? 0) < 60_000) return res.json({ checked: 0 });
      lastTracked.set(userId, now);
      res.json(await trackUser(userId));
    }),
  );

  r.get(
    "/runs/:id",
    h(async (req, res) => {
      const { id } = parse(idParam, req.params);
      const userId = userOf(req).id;
      const run = await queryOne<RunRow>(`SELECT ${RUN_COLUMNS} FROM runs WHERE id = ? AND user_id = ?`, [id, userId]);
      if (!run) throw new HttpError(404, "Run not found.");
      const items = await query<ItemRow>(`SELECT ${ITEM_COLUMNS} FROM run_items WHERE run_id = ? AND user_id = ? ORDER BY id`, [id, userId]);
      const fus = await followUpsFor(items.map((i) => Number(i.id)));
      const dto = items.map((i) => itemDto(i, fus));
      res.json({ run: runDto(run), applications: dto.filter((i) => i.type !== "link_only"), linkOnly: dto.filter((i) => i.type === "link_only") });
    }),
  );

  r.post(
    "/runs/:id/cancel-all",
    h(async (req, res) => {
      const { id } = parse(idParam, req.params);
      res.json({ cancelled: await cancelRunSends(userOf(req).id, id) });
    }),
  );

  r.post(
    "/items/:id/cancel",
    h(async (req, res) => {
      const { id } = parse(idParam, req.params);
      if (!(await cancelItemSend(userOf(req).id, id))) throw new HttpError(409, "This email can no longer be cancelled.");
      res.json({ ok: true });
    }),
  );

  r.post(
    "/items/:id/stop-followups",
    h(async (req, res) => {
      const { id } = parse(idParam, req.params);
      if (!(await stopFollowUps(userOf(req).id, id))) throw new HttpError(404, "Application not found.");
      res.json({ ok: true });
    }),
  );

  r.post(
    "/followups/:id/cancel",
    h(async (req, res) => {
      const { id } = parse(idParam, req.params);
      if (!(await cancelFollowUp(userOf(req).id, id))) throw new HttpError(409, "This follow-up can no longer be cancelled.");
      res.json({ ok: true });
    }),
  );

  return r;
}
