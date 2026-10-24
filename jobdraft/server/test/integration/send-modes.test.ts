import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { setGeneratorForTests } from "../../src/ai/index.js";
import { mockGenerateJson } from "../../src/ai/mock.js";
import { closePool, execute, query, queryOne } from "../../src/db/pool.js";
import { mockGmail } from "../../src/gmail/index.js";
import { processFollowUps } from "../../src/runs/followups.js";
import { runDueUsers } from "../../src/runs/runner.js";
import type { SendMode } from "../../src/runs/safety.js";
import { processSendQueue } from "../../src/runs/send-queue.js";
import { drainQueue, followups, readyUser, resetDb, setIst, type Agent } from "../helpers.js";

beforeEach(resetDb);
afterEach(() => setGeneratorForTests(null));
afterAll(closePool);

interface ModeItem {
  id: number;
  type: string;
  send_mode: string | null;
  send_state: string;
  send_at: Date | null;
  sent_by: string | null;
  skip_reason: string | null;
  confidence: number | null;
  gmail_draft_id: string | null;
}
const modeItems = (userId: number) => query<ModeItem>("SELECT * FROM run_items WHERE user_id = ? AND type <> 'link_only' ORDER BY id", [userId]);

const setMode = (agent: Agent, mode: SendMode) => agent.put("/api/automation/send-mode").send({ mode });

/** A user set up the evening before, in the given mode, whose 09:00 run has happened. */
async function ranAt9(mode: SendMode) {
  setIst("2026-11-01T20:00");
  const ctx = await readyUser();
  await setMode(ctx.agent, mode).expect(200);
  setIst("2026-11-02T09:00");
  expect((await runDueUsers()).claimed).toBe(1);
  return ctx;
}

describe("sending modes", () => {
  it("the default for new users is Smart send; the profile shows it", async () => {
    setIst("2026-11-01T20:00");
    const { agent } = await readyUser();
    const p = await agent.get("/api/profile").expect(200);
    expect(p.body.automation).toMatchObject({ enabled: true, sendMode: "smart" });
  });

  it("Drafts only: a full run creates only drafts, nothing is ever sent", async () => {
    const { user } = await ranAt9("drafts_only");
    const all = await modeItems(user.id);
    expect(all.length).toBeGreaterThanOrEqual(2);
    for (const i of all) expect(i).toMatchObject({ type: "draft", send_mode: "drafts_only", send_state: "none" });
    expect(await drainQueue("2026-11-02T09:00", "2026-11-02T11:00")).toBe(0);
    expect(mockGmail.sentCount()).toBe(0);
  });

  it("Smart send: only confidence ≥ 85 and unflagged items are auto-sent, after 30 minutes", async () => {
    const { user } = await ranAt9("smart");
    const all = await modeItems(user.id);
    const auto = all.filter((i) => i.type === "auto_send");
    expect(auto.length).toBeGreaterThanOrEqual(1);
    for (const i of auto) {
      expect(i.confidence).toBeGreaterThanOrEqual(85);
      expect(new Date(i.send_at!).toISOString()).toBe(new Date("2026-11-02T04:00:00Z").toISOString()); // 09:30 IST
    }
    for (const i of all.filter((x) => x.type === "draft")) expect(i.confidence).toBeLessThan(85);
    expect(all.every((i) => i.send_mode === "smart")).toBe(true);
    expect(await drainQueue("2026-11-02T09:00", "2026-11-02T09:28")).toBe(0); // inside the cancel window
    expect(await drainQueue("2026-11-02T09:30", "2026-11-02T10:30")).toBe(auto.length);
    for (const i of await modeItems(user.id)) if (i.type === "auto_send") expect(i.sent_by).toBe("auto");
  });

  it("Send all: every suitable, safe email is auto-sent after the 30-minute window, whatever its confidence", async () => {
    const { user } = await ranAt9("send_all");
    const all = await modeItems(user.id);
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all.some((i) => (i.confidence ?? 0) < 85)).toBe(true); // lower-confidence emails too
    for (const i of all) {
      expect(i).toMatchObject({ type: "auto_send", send_mode: "send_all", send_state: "scheduled" });
      expect(new Date(i.send_at!).toISOString()).toBe(new Date("2026-11-02T04:00:00Z").toISOString());
    }
    expect(await drainQueue("2026-11-02T09:30", "2026-11-02T11:00")).toBe(all.length);
  });

  it("Send all instantly: queued for the run's finish time, still one send per 2–4 minutes", async () => {
    const { user } = await ranAt9("send_all_instant");
    const all = await modeItems(user.id);
    expect(all.length).toBeGreaterThanOrEqual(2);
    for (const i of all) {
      expect(i).toMatchObject({ type: "auto_send", send_mode: "send_all_instant", send_state: "scheduled" });
      expect(new Date(i.send_at!).toISOString()).toBe(setIst("2026-11-02T09:00").toISOString()); // no cancel window
    }
    expect((await processSendQueue(setIst("2026-11-02T09:00"), () => 0)).sent).toBe(1);
    expect((await processSendQueue(setIst("2026-11-02T09:01"), () => 0)).sent).toBe(0); // gap
    expect((await processSendQueue(setIst("2026-11-02T09:02"), () => 0)).sent).toBe(1);
  });

  it("daily auto-send caps (IST): 8 in Smart send, 15 in the send-all modes; the rest stay drafts", async () => {
    // Every check is a strong match, so only the caps limit auto-sending.
    setGeneratorForTests(async (req) => {
      const out = (await mockGenerateJson(req)) as Record<string, unknown>;
      return req.task === "job_check" && out.suitable ? { ...out, confidence: 95 } : out;
    });
    for (const [mode, cap] of [["smart", 8], ["send_all", 15], ["send_all_instant", 15]] as const) {
      await resetDb();
      setIst("2026-11-01T20:00");
      const { user, agent } = await readyUser();
      await setMode(agent, mode).expect(200);
      // Earlier today this user already had cap − 1 auto-sends.
      const now = setIst("2026-11-02T08:00");
      const run = await execute("INSERT INTO runs (user_id, `trigger`, run_date, status, started_at) VALUES (?, 'manual', '2026-11-02', 'sent', ?)", [user.id, now]);
      for (let k = 0; k < cap - 1; k++) {
        await execute(
          "INSERT INTO run_items (run_id, user_id, type, send_mode, company, company_key, job_title, source, to_email, send_state, created_at) VALUES (?, ?, 'auto_send', ?, ?, ?, 'X', 'mock', ?, 'sent', ?)",
          [run.insertId, user.id, mode, `Earlier ${k}`, `earlier ${k}`, `hr@earlier${k}.in`, now],
        );
      }
      setIst("2026-11-02T09:00");
      await runDueUsers();
      const fresh = (await modeItems(user.id)).filter((i) => !i.gmail_draft_id === false);
      expect(fresh.filter((i) => i.type === "auto_send")).toHaveLength(1);
      expect(fresh.filter((i) => i.type === "draft").length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("changing the mode", () => {
  it("switching to Drafts only cancels every scheduled send at once; they stay Gmail drafts", async () => {
    const { user, agent } = await ranAt9("send_all");
    const scheduled = await modeItems(user.id);
    expect(scheduled.every((i) => i.send_state === "scheduled")).toBe(true);
    setIst("2026-11-02T09:10");
    const res = await setMode(agent, "drafts_only").expect(200);
    expect(res.body.automation.sendMode).toBe("drafts_only");
    for (const i of await modeItems(user.id)) {
      expect(i.send_state).toBe("cancelled");
      expect(mockGmail.drafts.has(i.gmail_draft_id!)).toBe(true);
    }
    expect(await drainQueue("2026-11-02T09:30", "2026-11-02T10:30")).toBe(0);
  });

  it("switching to a send mode never sends existing drafts", async () => {
    const { user, agent } = await ranAt9("drafts_only");
    setIst("2026-11-02T09:10");
    await setMode(agent, "send_all_instant").expect(200);
    expect(await drainQueue("2026-11-02T09:10", "2026-11-02T11:00")).toBe(0);
    for (const i of await modeItems(user.id)) expect(i).toMatchObject({ type: "draft", send_state: "none" });
  });

  it("the queue re-checks the CURRENT mode: changed to drafts only before sending → skipped", async () => {
    const { user } = await ranAt9("send_all");
    // Changed without going through the API (e.g. another tab) — the queue must still notice.
    await execute("UPDATE profiles SET send_mode = 'drafts_only' WHERE user_id = ?", [user.id]);
    expect(await drainQueue("2026-11-02T09:30", "2026-11-02T10:30")).toBe(0);
    const all = await modeItems(user.id);
    expect(all[0]).toMatchObject({ send_state: "skipped", skip_reason: "mode changed to drafts only" });
  });

  it("follow-ups: auto only if the original was sent automatically; all drafts in Drafts only", async () => {
    const { user, agent } = await ranAt9("send_all");
    await drainQueue("2026-11-02T09:30", "2026-11-02T11:00");
    const sent = (await modeItems(user.id)).filter((i) => i.sent_by === "auto");
    expect(sent.length).toBeGreaterThanOrEqual(2);
    // One user switches to drafts only before the follow-ups are due.
    await setMode(agent, "drafts_only").expect(200);
    await processFollowUps(setIst("2026-11-09T10:00"), () => 0.5);
    const fus = await followups(user.id);
    expect(fus.length).toBeGreaterThanOrEqual(1);
    for (const f of fus) expect(f).toMatchObject({ mode: "draft", state: "draft_created" });
  });

  it("follow-ups of auto-sent emails are auto in Send all instantly, with no cancel window", async () => {
    const { user } = await ranAt9("send_all_instant");
    await drainQueue("2026-11-02T09:00", "2026-11-02T10:00");
    await processFollowUps(setIst("2026-11-09T10:00"), () => 0.5);
    const fus = await followups(user.id);
    expect(fus.length).toBeGreaterThanOrEqual(1);
    for (const f of fus) {
      expect(f).toMatchObject({ mode: "auto", state: "scheduled" });
      expect(new Date(f.send_at!).getTime()).toBe(new Date(f.due_at).getTime()); // no extra 30 minutes
    }
  });
});

describe("automation OFF", () => {
  it("the mode can't be changed (saved value kept), and nothing is sent in any mode", async () => {
    for (const mode of ["smart", "send_all", "send_all_instant"] as const) {
      await resetDb();
      const { user, agent } = await ranAt9(mode);
      setIst("2026-11-02T09:05");
      await agent.put("/api/automation").send({ enabled: false }).expect(200);
      const blocked = await setMode(agent, "drafts_only").expect(400);
      expect(blocked.body.error).toBe("Turn on automation to use sending modes.");
      expect((await agent.get("/api/profile").expect(200)).body.automation).toMatchObject({ enabled: false, sendMode: mode });
      expect(await drainQueue("2026-11-02T09:05", "2026-11-02T11:00")).toBe(0);
      expect(mockGmail.sentCount()).toBe(0);
      expect((await modeItems(user.id)).every((i) => i.send_state !== "sent")).toBe(true);
      // And no new runs while OFF.
      setIst("2026-11-03T09:00");
      expect((await runDueUsers()).claimed).toBe(0);
    }
  });
});

describe("History shows how each application was handled", () => {
  it("Sent automatically · Sent by you · Draft – waiting for you", async () => {
    const { user, agent } = await ranAt9("smart");
    const all = await modeItems(user.id);
    const draft = all.find((i) => i.type === "draft")!;
    mockGmail.userSendsDraft(draft.gmail_draft_id!); // sent by hand in Gmail
    await drainQueue("2026-11-02T09:30", "2026-11-02T10:30");
    await agent.post("/api/runs/refresh").expect(200);
    const run = await queryOne<{ id: number }>("SELECT id FROM runs WHERE user_id = ?", [user.id]);
    const detail = await agent.get(`/api/runs/${run!.id}`).expect(200);
    const labels = (detail.body.applications as { id: number; handling: { label: string } }[]).map((a) => [a.id, a.handling.label]);
    expect(labels).toContainEqual([draft.id, "Sent by you"]);
    expect(labels.some(([, l]) => l === "Sent automatically")).toBe(true);
    if (all.filter((i) => i.type === "draft").length > 1) expect(labels.some(([, l]) => l === "Draft – waiting for you")).toBe(true);
  });
});
