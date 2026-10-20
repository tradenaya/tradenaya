import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, execute, queryOne } from "../../src/db/pool.js";
import { mockGmail } from "../../src/gmail/index.js";
import { runDueUsers } from "../../src/runs/runner.js";
import { processSendQueue } from "../../src/runs/send-queue.js";
import { drainQueue, istFmt, items, readyUser, resetDb, setIst } from "../helpers.js";

beforeEach(resetDb);
afterAll(closePool);

/** One role → two strong matches (auto-send) and one draft, run at 09:00 IST on Monday. */
async function runWithAutoSends() {
  setIst("2026-11-01T20:00");
  const u = await readyUser({ prefs: { target_roles: ["Software Engineer"] } });
  setIst("2026-11-02T09:00");
  await runDueUsers();
  const autos = await items(u.user.id, "auto_send");
  expect(autos.length).toBeGreaterThanOrEqual(2);
  return { ...u, autos };
}

const threadSentCount = (threadId: string) => mockGmail.thread(threadId).filter((m) => m.labels.has("SENT")).length;

describe("send queue", () => {
  it("waits for the 30-minute cancel window, then sends one at a time with a 2–4 minute gap", async () => {
    const { user, autos, agent } = await runWithAutoSends();
    const dash = await agent.get("/api/dashboard").expect(200);
    expect(dash.body.upcoming).toHaveLength(autos.length);
    expect(istFmt(dash.body.upcoming[0].sendAt)).toBe("2026-11-02 09:30");

    expect(await drainQueue("2026-11-02T09:00", "2026-11-02T09:29", 1)).toBe(0);
    expect(await drainQueue("2026-11-02T09:30", "2026-11-02T09:31", 1)).toBe(1); // gap blocks the 2nd at 09:31
    expect(await drainQueue("2026-11-02T09:32", "2026-11-02T09:40", 1)).toBe(autos.length - 1 > 0 ? Math.min(autos.length - 1, 5) : 0);
    const sent = (await items(user.id, "auto_send")).filter((i) => i.send_state === "sent");
    expect(sent).toHaveLength(autos.length);
    const times = sent.map((i) => new Date(i.sent_at!).getTime()).sort();
    for (let k = 1; k < times.length; k++) expect(times[k]! - times[k - 1]!).toBeGreaterThanOrEqual(2 * 60_000);
    for (const i of sent) expect(threadSentCount(i.gmail_thread_id!)).toBe(1);
    // Manual drafts are never sent by the queue.
    for (const d of await items(user.id, "draft")) expect(d.send_state).toBe("none");
    const run = await queryOne<{ status: string; sent_count: number }>("SELECT status, sent_count FROM runs WHERE user_id = ?", [user.id]);
    expect(run).toMatchObject({ status: "ready_to_send", sent_count: autos.length });
  });

  it("Cancel keeps the email as a normal draft; Cancel all stops the rest of the run", async () => {
    const { user, autos, agent } = await runWithAutoSends();
    await agent.post(`/api/items/${autos[0]!.id}/cancel`).expect(200);
    await agent.post(`/api/items/${autos[0]!.id}/cancel`).expect(409);
    await agent.post(`/api/runs/${autos[0]!.run_id}/cancel-all`).expect(200);
    expect(await drainQueue("2026-11-02T09:30", "2026-11-02T10:00")).toBe(0);
    for (const i of await items(user.id, "auto_send")) {
      expect(i).toMatchObject({ send_state: "cancelled", followup_mode: "draft" });
      expect(mockGmail.drafts.has(i.gmail_draft_id!)).toBe(true);
    }
    expect(mockGmail.sendCalls).toBe(0);
  });

  it("never sends twice under concurrent workers", async () => {
    const { user, autos } = await runWithAutoSends();
    setIst("2026-11-02T09:30");
    const t = new Date();
    await Promise.all([processSendQueue(t, () => 0), processSendQueue(t, () => 0), processSendQueue(t, () => 0)]);
    await drainQueue("2026-11-02T09:31", "2026-11-02T10:00", 1);
    for (const i of await items(user.id, "auto_send")) {
      expect(i.send_state).toBe("sent");
      expect(threadSentCount(i.gmail_thread_id!)).toBe(1);
    }
    expect(mockGmail.sendCalls).toBe(autos.length);
  });

  it("recovers after a restart mid-send without double sending", async () => {
    const { user, autos } = await runWithAutoSends();
    const [a, b] = autos;
    // Crash 1: claimed but never reached Gmail → retried later.
    await execute("UPDATE run_items SET send_state = 'sending', sending_started_at = ?, send_attempts = 1 WHERE id = ?", [new Date("2026-11-02T04:00:00Z"), a!.id]);
    // Crash 2: Gmail sent it, but the server died before recording it.
    await execute("UPDATE run_items SET send_state = 'sending', sending_started_at = ?, send_attempts = 1 WHERE id = ?", [new Date("2026-11-02T04:00:00Z"), b!.id]);
    mockGmail.userSendsDraft(b!.gmail_draft_id!);
    await drainQueue("2026-11-02T09:45", "2026-11-02T10:30");
    const after = await items(user.id, "auto_send");
    expect(after.find((i) => i.id === b!.id)!.send_state).toBe("sent");
    expect(threadSentCount(b!.gmail_thread_id!)).toBe(1);
    expect(after.find((i) => i.id === a!.id)!.send_state).toBe("sent");
    expect(threadSentCount(a!.gmail_thread_id!)).toBe(1);
  });

  it("skips when the draft is gone (deleted, or already sent by hand)", async () => {
    const { user, autos } = await runWithAutoSends();
    mockGmail.userDeletesDraft(autos[0]!.gmail_draft_id!);
    mockGmail.userSendsDraft(autos[1]!.gmail_draft_id!);
    await drainQueue("2026-11-02T09:30", "2026-11-02T10:00");
    const after = await items(user.id, "auto_send");
    expect(after.find((i) => i.id === autos[0]!.id)!.send_state).toBe("removed");
    expect(after.find((i) => i.id === autos[1]!.id)!.send_state).toBe("sent");
    expect(threadSentCount(autos[1]!.gmail_thread_id!)).toBe(1);
  });

  it("retries a failed send at most twice (3 attempts, ≥15 minutes apart), then marks it failed for good", async () => {
    const { user, autos } = await runWithAutoSends();
    mockGmail.failSends = 1000;
    await drainQueue("2026-11-02T09:30", "2026-11-02T12:00");
    const after = await items(user.id, "auto_send");
    for (const i of after) {
      expect(i.send_state).toBe("failed");
      const row = await queryOne<{ send_attempts: number }>("SELECT send_attempts FROM run_items WHERE id = ?", [i.id]);
      expect(row!.send_attempts).toBe(3);
    }
    expect(mockGmail.sendCalls).toBe(3 * autos.length);
    await drainQueue("2026-11-02T12:00", "2026-11-03T12:00", 60);
    expect(mockGmail.sendCalls).toBe(3 * autos.length); // never re-queued automatically
  });

  it("pauses all sending for 24 hours on a Gmail rate-limit error and keeps the rest as drafts", async () => {
    const { user, token, agent } = await runWithAutoSends();
    mockGmail.rateLimitedTokens.add(token);
    await drainQueue("2026-11-02T09:30", "2026-11-02T10:30");
    expect(mockGmail.sendCalls).toBe(1);
    for (const i of await items(user.id, "auto_send")) expect(i).toMatchObject({ send_state: "skipped", followup_mode: "draft" });
    const conn = await queryOne<{ send_paused_until: Date }>("SELECT send_paused_until FROM gmail_connections WHERE user_id = ?", [user.id]);
    expect(istFmt(conn!.send_paused_until)).toBe("2026-11-03 09:30");
    setIst("2026-11-02T11:00");
    const dash = await agent.get("/api/dashboard").expect(200);
    expect(dash.body.sendingPausedUntil).toBeTruthy();
  });
});
