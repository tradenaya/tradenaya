import { DateTime } from "luxon";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, execute } from "../../src/db/pool.js";
import { mockGmail } from "../../src/gmail/index.js";
import { mockProvider } from "../../src/gmail/mock.js";
import { buildMimeMessage, generateMessageId, toBase64Url } from "../../src/gmail/mime.js";
import { clock } from "../../src/lib/clock.js";
import { processFollowUps } from "../../src/runs/followups.js";
import { runDueUsers } from "../../src/runs/runner.js";
import { trackUser } from "../../src/runs/tracking.js";
import { drainQueue, followups, istFmt, items, readyUser, resetDb, setIst } from "../helpers.js";

beforeEach(resetDb);
afterAll(closePool);

const sentIn = (threadId: string) => mockGmail.thread(threadId).filter((m) => m.labels.has("SENT"));

/** One role; Monday 09:00 run; the auto-sends go out at 09:30–09:32. */
async function sentApplications() {
  setIst("2026-11-01T20:00");
  const u = await readyUser({ prefs: { target_roles: ["Software Engineer"] } });
  setIst("2026-11-02T09:00");
  await runDueUsers();
  await drainQueue("2026-11-02T09:30", "2026-11-02T10:00");
  const autos = await items(u.user.id, "auto_send");
  expect(autos.length).toBeGreaterThanOrEqual(2);
  for (const a of autos) expect(a.send_state).toBe("sent");
  return { ...u, autos };
}

/**
 * Simulates the daily follow-up cron (10:00 IST), the per-minute send queue
 * (every 10 min, 10:00–12:00) and 2-hourly tracking for `days` days.
 */
async function simulateDays(userId: number, fromDate: string, days: number, opts: { parallel?: boolean } = {}) {
  let day = DateTime.fromISO(fromDate, { zone: "Asia/Kolkata" });
  for (let i = 0; i < days; i++, day = day.plus({ days: 1 })) {
    const d = day.toFormat("yyyy-MM-dd");
    const t = setIst(`${d}T10:00`);
    if (opts.parallel) await Promise.all([processFollowUps(t, () => 0.5), processFollowUps(t, () => 0.5)]);
    else await processFollowUps(t, () => 0.5);
    await drainQueue(`${d}T10:00`, `${d}T12:00`, 10);
    setIst(`${d}T14:00`);
    await trackUser(userId);
  }
}

describe("application tracking (headers only)", () => {
  it("detects a manually sent draft, a deleted draft, a reply and a bounce", async () => {
    setIst("2026-11-01T20:00");
    const { user } = await readyUser({ prefs: { target_roles: ["Software Engineer", "Backend Developer"] } });
    setIst("2026-11-02T09:00");
    await runDueUsers();
    const drafts = await items(user.id, "draft");
    const autos = await items(user.id, "auto_send");
    expect(drafts.length).toBeGreaterThanOrEqual(1);
    mockGmail.userSendsDraft(drafts[0]!.gmail_draft_id!);
    if (drafts[1]) mockGmail.userDeletesDraft(drafts[1].gmail_draft_id!);
    await drainQueue("2026-11-02T09:30", "2026-11-02T10:00");
    mockGmail.reply(autos[0]!.gmail_thread_id!);
    mockGmail.bounce(autos[1]!.gmail_thread_id!);
    setIst("2026-11-02T12:00");
    await trackUser(user.id);
    const after = new Map((await items(user.id)).map((i) => [i.id, i]));
    expect(after.get(drafts[0]!.id)).toMatchObject({ send_state: "sent", followup_mode: "draft" });
    if (drafts[1]) expect(after.get(drafts[1].id)!.send_state).toBe("removed");
    expect(after.get(autos[0]!.id)).toMatchObject({ reply_state: "replied", outcome: "replied" });
    expect(after.get(autos[1]!.id)).toMatchObject({ reply_state: "bounced", outcome: "bounced" });
  });
});

describe("follow-ups: at most 2 per application, ever", () => {
  it("with no reply: exactly 2 follow-ups (day 7 and day 14), then No response — and nothing else for 60 more days", async () => {
    const { user, autos } = await sentApplications();
    const callsBefore = mockGmail.sendCalls;
    await simulateDays(user.id, "2026-11-03", 90);
    for (const a of autos) {
      const fus = (await followups(user.id)).filter((f) => f.run_item_id === a.id);
      expect(fus.map((f) => [f.sequence, f.state, f.mode])).toEqual([
        [1, "sent", "auto"],
        [2, "sent", "auto"],
      ]);
      expect(istFmt(fus[0]!.sent_at)).toMatch(/^2026-11-09 1[01]:/); // Monday, a week later, business hours
      expect(istFmt(fus[1]!.sent_at)).toMatch(/^2026-11-16 1[01]:/);
      const sent = sentIn(a.gmail_thread_id!);
      expect(sent).toHaveLength(3); // original + 2 follow-ups, in the same thread
      const original = sent[0]!.headers["message-id"];
      expect(sent[1]!.headers["in-reply-to"]).toBe(original);
      expect(sent[2]!.headers.references).toContain(original);
      expect(sent[1]!.raw).not.toBe("");
      expect(Buffer.from(sent[1]!.raw, "base64url").toString("utf8")).not.toMatch(/multipart|filename=/);
      const item = (await items(user.id)).find((i) => i.id === a.id)!;
      expect(item).toMatchObject({ outcome: "no_response", followup_count: 2 });
    }
    expect(mockGmail.sendCalls - callsBefore).toBe(2 * autos.length);
  });

  it("a third follow-up is impossible — duplicate firings, parallel workers, restarts, and direct DB inserts", async () => {
    const { user, autos } = await sentApplications();
    await simulateDays(user.id, "2026-11-03", 40, { parallel: true });
    const fus = await followups(user.id);
    for (const a of autos) {
      expect(fus.filter((f) => f.run_item_id === a.id)).toHaveLength(2);
      expect(sentIn(a.gmail_thread_id!)).toHaveLength(3);
    }
    // "Restart" and fire the job again many times.
    for (let k = 0; k < 5; k++) await processFollowUps(setIst("2026-12-20T10:00"));
    expect(await followups(user.id)).toHaveLength(fus.length);
    // The database itself refuses a duplicate or a third one.
    await expect(execute("INSERT INTO followups (run_item_id, user_id, sequence, mode, state, due_at) VALUES (?, ?, 1, 'auto', 'scheduled', NOW())", [autos[0]!.id, user.id])).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
    await expect(execute("INSERT INTO followups (run_item_id, user_id, sequence, mode, state, due_at) VALUES (?, ?, 3, 'auto', 'scheduled', NOW())", [autos[0]!.id, user.id])).rejects.toMatchObject({
      code: "ER_CHECK_CONSTRAINT_VIOLATED",
    });
  });

  it("a reply after follow-up 1 means follow-up 2 is never created", async () => {
    const { user, autos } = await sentApplications();
    await simulateDays(user.id, "2026-11-03", 7); // through Mon 11-09: follow-up 1 sent
    expect((await followups(user.id)).filter((f) => f.state === "sent")).toHaveLength(autos.length);
    setIst("2026-11-10T09:00");
    mockGmail.reply(autos[0]!.gmail_thread_id!);
    await simulateDays(user.id, "2026-11-10", 30);
    const mine = (await followups(user.id)).filter((f) => f.run_item_id === autos[0]!.id);
    expect(mine.map((f) => f.sequence)).toEqual([1]);
    expect((await items(user.id)).find((i) => i.id === autos[0]!.id)!.outcome).toBe("replied");
    expect(sentIn(autos[0]!.gmail_thread_id!)).toHaveLength(2);
  });

  it("a reply just before a scheduled follow-up cancels it (and deletes its draft)", async () => {
    const { user, autos } = await sentApplications();
    await simulateDays(user.id, "2026-11-03", 6); // through Sunday
    await processFollowUps(setIst("2026-11-09T10:00"), () => 0.5);
    const fu = (await followups(user.id)).find((f) => f.run_item_id === autos[0]!.id)!;
    expect(fu).toMatchObject({ sequence: 1, state: "scheduled" });
    expect(istFmt(fu.send_at)).toBe("2026-11-09 10:45");
    setIst("2026-11-09T10:20");
    mockGmail.reply(autos[0]!.gmail_thread_id!);
    const calls = mockGmail.sendCalls;
    await drainQueue("2026-11-09T10:30", "2026-11-09T12:00", 5);
    const after = (await followups(user.id)).find((f) => f.id === fu.id)!;
    expect(after.state).toBe("not_needed");
    expect(mockGmail.drafts.has(fu.gmail_draft_id!)).toBe(false);
    expect(sentIn(autos[0]!.gmail_thread_id!)).toHaveLength(1);
    // Only the other applications' follow-ups were sent.
    expect(mockGmail.sendCalls - calls).toBe(autos.length - 1);
  });

  it("a bounce stops all follow-ups", async () => {
    const { user, autos } = await sentApplications();
    setIst("2026-11-03T09:00");
    mockGmail.bounce(autos[0]!.gmail_thread_id!);
    await simulateDays(user.id, "2026-11-03", 30);
    expect((await followups(user.id)).filter((f) => f.run_item_id === autos[0]!.id)).toHaveLength(0);
    expect((await items(user.id)).find((i) => i.id === autos[0]!.id)).toMatchObject({ reply_state: "bounced", outcome: "bounced" });
  });

  it("follow-up 2 is not created if follow-up 1 was cancelled or failed", async () => {
    const { user, autos, agent } = await sentApplications();
    await simulateDays(user.id, "2026-11-03", 6);
    await processFollowUps(setIst("2026-11-09T10:00"), () => 0.5);
    const fus = await followups(user.id);
    await agent.post(`/api/followups/${fus.find((f) => f.run_item_id === autos[0]!.id)!.id}/cancel`).expect(200);
    mockGmail.failSends = 1000; // every send of the other follow-up 1s fails
    await drainQueue("2026-11-09T10:00", "2026-11-09T12:00", 5);
    mockGmail.failSends = 0;
    await simulateDays(user.id, "2026-11-10", 30);
    const after = await followups(user.id);
    expect(after.every((f) => f.sequence === 1)).toBe(true);
    expect(after.find((f) => f.run_item_id === autos[0]!.id)!.state).toBe("cancelled");
    for (const f of after.filter((x) => x.run_item_id !== autos[0]!.id)) expect(f.state).toBe("failed");
    for (const a of autos) expect(sentIn(a.gmail_thread_id!)).toHaveLength(1);
  });

  it("a draft-mode follow-up not sent within 7 days expires, its draft is deleted, and nothing further is created", async () => {
    setIst("2026-11-01T20:00");
    const { user, agent } = await readyUser({ prefs: { target_roles: ["Software Engineer"] } });
    setIst("2026-11-02T09:00");
    await runDueUsers();
    const draft = (await items(user.id, "draft"))[0]!;
    // The user sends the draft by hand at noon; tracking notices.
    setIst("2026-11-02T12:00");
    mockGmail.userSendsDraft(draft.gmail_draft_id!);
    await trackUser(user.id);
    // Sent at 12:00 → 7 days later is past Monday's 10:00–11:30 window → due Tuesday 11-10.
    await simulateDays(user.id, "2026-11-03", 8);
    const fu = (await followups(user.id)).find((f) => f.run_item_id === draft.id)!;
    expect(fu).toMatchObject({ sequence: 1, mode: "draft", state: "draft_created" });
    expect(mockGmail.drafts.has(fu.gmail_draft_id!)).toBe(true);
    const dash = await agent.get("/api/dashboard").expect(200);
    expect(dash.body.followupDrafts).toEqual([expect.objectContaining({ itemId: draft.id, sequence: 1 })]);
    await simulateDays(user.id, "2026-11-11", 30);
    const after = (await followups(user.id)).filter((f) => f.run_item_id === draft.id);
    expect(after.map((f) => [f.sequence, f.state])).toEqual([[1, "expired"]]);
    expect(mockGmail.drafts.has(fu.gmail_draft_id!)).toBe(false);
    expect((await items(user.id)).find((i) => i.id === draft.id)!.outcome).toBe("no_response");
    expect(sentIn(draft.gmail_thread_id!)).toHaveLength(1);
  });

  it("Stop follow-ups prevents all future follow-ups", async () => {
    const { user, autos, agent } = await sentApplications();
    await agent.post(`/api/items/${autos[0]!.id}/stop-followups`).expect(200);
    await simulateDays(user.id, "2026-11-03", 7);
    const fu1Other = (await followups(user.id)).find((f) => f.run_item_id === autos[1]!.id);
    expect(fu1Other?.state).toBe("sent");
    // Stop the other one while its follow-up 2 is pending later on.
    await agent.post(`/api/items/${autos[1]!.id}/stop-followups`).expect(200);
    await simulateDays(user.id, "2026-11-10", 30);
    expect((await followups(user.id)).filter((f) => f.run_item_id === autos[0]!.id)).toHaveLength(0);
    expect((await followups(user.id)).filter((f) => f.run_item_id === autos[1]!.id).map((f) => f.sequence)).toEqual([1]);
    for (const a of autos.slice(0, 2)) expect((await items(user.id)).find((i) => i.id === a.id)).toMatchObject({ outcome: "stopped", followups_stopped: 1 });
  });

  it("automation OFF prevents follow-ups; cancelled ones are not revived when it's turned back ON", async () => {
    const { user, autos, agent } = await sentApplications();
    await simulateDays(user.id, "2026-11-03", 6);
    await processFollowUps(setIst("2026-11-09T10:00"), () => 0.5);
    expect((await followups(user.id)).every((f) => f.state === "scheduled")).toBe(true);
    setIst("2026-11-09T10:10");
    await agent.put("/api/automation").send({ enabled: false }).expect(200);
    expect((await followups(user.id)).every((f) => f.state === "cancelled")).toBe(true);
    await drainQueue("2026-11-09T10:10", "2026-11-09T12:00", 5);
    setIst("2026-11-10T08:00");
    await agent.put("/api/automation").send({ enabled: true }).expect(200);
    await simulateDays(user.id, "2026-11-10", 30);
    const fus = await followups(user.id);
    expect(fus).toHaveLength(autos.length);
    expect(fus.every((f) => f.sequence === 1 && f.state === "cancelled")).toBe(true);
    for (const a of autos) expect(sentIn(a.gmail_thread_id!)).toHaveLength(1);
  });

  it("the daily cap (5 per user) pushes the rest to the next weekday window, never earlier", async () => {
    setIst("2026-11-01T20:00");
    const { user, token } = await readyUser({ prefs: { target_roles: ["Software Engineer"] } });
    // Seven applications auto-sent on Friday 11-06 at 09:00 (crafted directly).
    const sentAt = setIst("2026-11-06T09:00");
    const [{ insertId: runId }] = [await execute("INSERT INTO runs (user_id, `trigger`, run_date, status, started_at) VALUES (?, 'manual', '2026-11-06', 'sent', ?)", [user.id, sentAt])];
    for (let k = 0; k < 7; k++) {
      const messageId = generateMessageId("mock.user@gmail.com");
      const raw = buildMimeMessage({ from: "mock.user@gmail.com", to: `hr${k}@company${k}.in`, subject: `Application for Software Engineer – Priya Sharma`, body: "Dear Hiring Team, …", messageId });
      const d = await mockProvider.createDraft(token, toBase64Url(raw));
      mockGmail.userSendsDraft(d.draftId);
      await execute(
        `INSERT INTO run_items (run_id, user_id, type, company, company_key, job_title, location, job_url, source, to_email, subject, gmail_draft_id, gmail_thread_id, gmail_message_id, rfc_message_id,
           send_state, sent_at, followup_mode, created_at)
         VALUES (?, ?, 'auto_send', ?, ?, 'Software Engineer', 'Bengaluru', ?, 'mock', ?, 'Application for Software Engineer – Priya Sharma', ?, ?, ?, ?, 'sent', ?, 'auto', ?)`,
        [runId, user.id, `Company ${k}`, `company ${k}`, `https://company${k}.in/jobs`, `hr${k}@company${k}.in`, d.draftId, d.threadId, d.messageId, messageId, sentAt, sentAt],
      );
    }
    // Follow-up 1 is due Fri 11-13 (window 10:00–11:30).
    await processFollowUps(setIst("2026-11-12T10:00"), () => 0.5); // Thursday: nothing due yet
    expect(await followups(user.id)).toHaveLength(0);
    await processFollowUps(setIst("2026-11-13T10:00"), () => 0.5);
    expect(await followups(user.id)).toHaveLength(5);
    // Weekend: nothing is created or sent.
    await processFollowUps(setIst("2026-11-14T10:00"), () => 0.5);
    await processFollowUps(setIst("2026-11-15T10:00"), () => 0.5);
    expect(await followups(user.id)).toHaveLength(5);
    await processFollowUps(setIst("2026-11-16T10:00"), () => 0.5); // Monday: the remaining 2
    const all = await followups(user.id);
    expect(all).toHaveLength(7);
    const pushed = all.filter((f) => istFmt(f.due_at)!.startsWith("2026-11-16"));
    expect(pushed).toHaveLength(2);
    for (const f of pushed) expect(new Date(f.send_at!).getTime()).toBeGreaterThanOrEqual(DateTime.fromISO("2026-11-16T10:00", { zone: "Asia/Kolkata" }).toMillis());
    for (const f of all) {
      const due = DateTime.fromJSDate(new Date(f.due_at), { zone: "Asia/Kolkata" });
      expect(due.weekday).toBeLessThanOrEqual(5);
      expect(due.hour * 60 + due.minute).toBeGreaterThanOrEqual(600);
      expect(due.hour * 60 + due.minute).toBeLessThanOrEqual(690);
    }
    clock.reset();
  });
});
