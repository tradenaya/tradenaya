import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiKeyRejectedError, AiQuotaError, setGeneratorForTests } from "../../src/ai/index.js";
import { mockGenerateJson } from "../../src/ai/mock.js";
import { closePool, query, queryOne } from "../../src/db/pool.js";
import { processFollowUps } from "../../src/runs/followups.js";
import { runDueUsers } from "../../src/runs/runner.js";
import { drainQueue, readyUser, registerUser, resetDb, setIst, TEST_GEMINI_KEY, uploadResume } from "../helpers.js";

beforeEach(resetDb);
afterEach(() => setGeneratorForTests(null));
afterAll(closePool);

describe("AI calls use each user's own Gemini key", () => {
  it("resume reading, screening, emails and follow-ups all carry that user's key (never a server key)", async () => {
    const seen = new Map<string, Set<string | undefined>>();
    setGeneratorForTests(async (req) => {
      if (!seen.has(req.task)) seen.set(req.task, new Set());
      seen.get(req.task)!.add(req.apiKey);
      return mockGenerateJson(req);
    });
    setIst("2026-11-01T20:00");
    const other = "AIzaSecondUserKey_abcdefghijklmnopqrstuv";
    await readyUser(); // user 1: TEST_GEMINI_KEY
    const b = await registerUser(undefined, { geminiKey: other });
    await uploadResume(b.agent).expect(200);
    setIst("2026-11-02T09:00");
    await runDueUsers();
    await drainQueue("2026-11-02T09:30", "2026-11-02T11:00");
    await processFollowUps(setIst("2026-11-09T10:00"), () => 0.5);

    expect([...seen.get("resume")!]).toEqual([TEST_GEMINI_KEY, other]);
    expect([...seen.get("screen")!]).toEqual([TEST_GEMINI_KEY]);
    expect([...seen.get("job_check")!]).toEqual([TEST_GEMINI_KEY]);
    expect([...seen.get("followup")!]).toEqual([TEST_GEMINI_KEY]);
  });
});

describe("without a usable key", () => {
  it("a resume can't be read until a key is added", async () => {
    const { agent } = await registerUser();
    await agent.delete("/api/profile/gemini-key").expect(200);
    const res = await uploadResume(agent).expect(400);
    expect(res.body.error).toMatch(/Add your Gemini API key first/);
  });

  it("automation can't start, and a due run says why in History (never silent)", async () => {
    setIst("2026-11-01T20:00");
    const { user, agent } = await readyUser();
    await agent.delete("/api/profile/gemini-key").expect(200);
    const p = (await agent.get("/api/profile").expect(200)).body;
    expect(p.automation.missing[0]).toBe("Add your Gemini API key");
    expect(p.complete.geminiKey).toBe(false);
    setIst("2026-11-02T09:00");
    expect(await runDueUsers()).toEqual({ claimed: 0, skipped: 0, blocked: 1 });
    const run = await queryOne<{ status: string; error_message: string }>("SELECT status, error_message FROM runs WHERE user_id = ?", [user.id]);
    expect(run).toMatchObject({ status: "failed" });
    expect(run!.error_message).toMatch(/^Today's run couldn't start: add your gemini api key/);
  });

  it("a key Google rejects during a run stops the run, marks the key, and asks for a new one", async () => {
    setIst("2026-11-01T20:00");
    const { user, agent } = await readyUser();
    let calls = 0;
    setGeneratorForTests(async () => {
      calls++;
      throw new AiKeyRejectedError();
    });
    setIst("2026-11-02T09:00");
    await runDueUsers();
    expect(calls).toBe(1); // no retries with a key that can't work
    const run = await queryOne<{ status: string; error_message: string }>("SELECT status, error_message FROM runs WHERE user_id = ?", [user.id]);
    expect(run).toMatchObject({ status: "failed", error_message: "Your Gemini API key was rejected by Google. Update it in Setup." });
    const p = (await agent.get("/api/profile").expect(200)).body;
    expect(p.geminiKey.status).toBe("invalid");
    expect(p.automation.missing).toContain("Update your Gemini API key (Google rejected it)");
    // Saving a working key clears it.
    setGeneratorForTests(null);
    const fixed = await agent.put("/api/profile/gemini-key").send({ key: "AIzaFixedKey_abcdefghijklmnopqrstuvwxyz12" }).expect(200);
    expect(fixed.body.geminiKey.status).toBe("valid");
    expect(fixed.body.automation.missing).toEqual([]);
    expect(await query("SELECT id FROM runs WHERE user_id = ?", [user.id])).toHaveLength(1);
  });
});

describe("no fixed cap on AI checks", () => {
  it("checks every posting it can; when the key's limit is reached it stops calmly, keeps what it made, and carries the rest over", async () => {
    setIst("2026-11-01T20:00");
    const { user } = await readyUser({ prefs: { target_roles: ["Software Engineer", "Backend Developer", "Full Stack Developer"] } });
    let screens = 0;
    setGeneratorForTests(async (req) => {
      if (req.task === "screen" && ++screens >= 2) throw new AiQuotaError(); // the 2nd screening call hits the limit
      return mockGenerateJson(req);
    });
    setIst("2026-11-02T09:00");
    await runDueUsers();
    const run = await queryOne<{ status: string; error_message: string; funnel: unknown }>("SELECT status, error_message, funnel FROM runs WHERE user_id = ?", [user.id]);
    expect(run!.status).not.toBe("failed");
    expect(run!.error_message).toMatch(/^Your Gemini key reached its usage limit\. \d+ postings will be checked in the next run\.$/);
    const f = (typeof run!.funnel === "string" ? JSON.parse(run!.funnel) : run!.funnel) as { aiChecked: number; notChecked: number; afterFilters: number };
    expect(f.aiChecked).toBe(10); // the first call: 10 postings
    expect(f.notChecked).toBe(f.afterFilters - 10);
    expect((await query("SELECT id FROM run_items WHERE user_id = ?", [user.id])).length).toBeGreaterThanOrEqual(1);
  });
});
