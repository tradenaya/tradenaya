// A user's own (optional) RapidAPI key for JSearch on the Setup page, and the
// cover notes for "apply via link" postings.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiQuotaError, setGeneratorForTests } from "../../src/ai/index.js";
import { mockGenerateJson } from "../../src/ai/mock.js";
import { closePool, query, queryOne } from "../../src/db/pool.js";
import { setJSearchKeyVerifierForTests } from "../../src/jobs/jsearch-key.js";
import { runDueUsers } from "../../src/runs/runner.js";
import { items, readyUser, registerUser, resetDb, setIst } from "../helpers.js";

const KEY = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5";

beforeEach(resetDb);
afterEach(() => {
  setJSearchKeyVerifierForTests(null);
  setGeneratorForTests(null);
});
afterAll(closePool);

describe("own JSearch key (Setup, optional)", () => {
  it("is optional: a new account has none, it's never a setup step, and the profile links to where to get one", async () => {
    const { agent } = await registerUser();
    const p = (await agent.get("/api/profile").expect(200)).body;
    expect(p.jsearch).toMatchObject({ ownKey: null });
    expect(p.jsearch.subscribeUrl).toBe("https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch/pricing");
    expect(p.jsearch.playgroundUrl).toBe("https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch/playground");
    expect(Object.keys(p.complete)).toEqual(["geminiKey", "resume", "preferences", "gmail"]);
  });

  it("is checked with RapidAPI, stored encrypted, and only its last 4 characters are ever shown", async () => {
    const { agent, user } = await registerUser();
    const checked: string[] = [];
    setJSearchKeyVerifierForTests(async (k) => {
      checked.push(k);
      return { status: "valid" };
    });
    setIst("2026-11-02T10:00");
    // Pasted straight from RapidAPI's code sample: reduced to the key.
    const res = await agent.put("/api/profile/jsearch-key").send({ key: `  'x-rapidapi-key': '${KEY}',` }).expect(200);
    expect(checked).toEqual([KEY]);
    // The check was a real search (1 used). Cycle Nov 2 → Dec 2: 200 / 30 days → 6 a day.
    expect(res.body.jsearch.ownKey).toMatchObject({ hint: KEY.slice(-4), status: "valid", monthlyQuota: 200, usedThisMonth: 1, usedToday: 1, todayAllowance: 6 });
    expect(JSON.stringify(res.body)).not.toContain(KEY);
    const row = await queryOne<{ rapidapi_key_enc: string }>("SELECT rapidapi_key_enc FROM profiles WHERE user_id = ?", [user.id]);
    expect(row!.rapidapi_key_enc).toBeTruthy();
    expect(row!.rapidapi_key_enc).not.toContain(KEY);
  });

  it("a key RapidAPI doesn't accept is refused with what to do, and not saved", async () => {
    const { agent } = await registerUser();
    setJSearchKeyVerifierForTests(async () => ({ status: "invalid" }));
    const res = await agent.put("/api/profile/jsearch-key").send({ key: KEY }).expect(400);
    expect(res.body.error).toMatch(/RapidAPI didn't accept this key\. Copy the whole value next to X-RapidAPI-Key/);
    expect((await agent.get("/api/profile").expect(200)).body.jsearch.ownKey).toBeNull();
    const short = await agent.put("/api/profile/jsearch-key").send({ key: "abc" }).expect(400);
    expect(JSON.stringify(short.body)).toMatch(/doesn't look like a RapidAPI key/);
  });

  it("a key that isn't subscribed yet is kept with the next step; 'check again' after subscribing makes it work", async () => {
    const { agent } = await registerUser();
    setIst("2026-11-02T10:00");
    setJSearchKeyVerifierForTests(async () => ({ status: "not_subscribed" }));
    const first = await agent.put("/api/profile/jsearch-key").send({ key: KEY }).expect(200);
    expect(first.body.jsearch.ownKey).toMatchObject({ status: "not_subscribed", usedThisMonth: 0 });

    // Still not subscribed: says so again.
    const still = await agent.post("/api/profile/jsearch-key/check").expect(200);
    expect(still.body.jsearch.ownKey.status).toBe("not_subscribed");

    setIst("2026-11-05T10:00");
    setJSearchKeyVerifierForTests(async () => ({ status: "valid" }));
    const ok = await agent.post("/api/profile/jsearch-key/check").expect(200);
    // Works now; its monthly cycle starts today (Nov 5 → Dec 5: 30 days).
    expect(ok.body.jsearch.ownKey).toMatchObject({ status: "valid", usedThisMonth: 1, todayAllowance: 6 });
    expect(new Date(ok.body.jsearch.ownKey.updatedAt).toISOString()).toBe(setIst("2026-11-05T10:00").toISOString());
  });

  it("a working key with this month's searches used up is saved and says so", async () => {
    const { agent } = await registerUser();
    setJSearchKeyVerifierForTests(async () => ({ status: "quota_used" }));
    const res = await agent.put("/api/profile/jsearch-key").send({ key: KEY }).expect(200);
    expect(res.body.jsearch.ownKey).toMatchObject({ status: "valid", quotaUsedUp: true, usedThisMonth: 0 });
  });

  it("RapidAPI unreachable: 503 and nothing saved; removing the key forgets it and its count", async () => {
    const { agent, user } = await registerUser();
    setJSearchKeyVerifierForTests(async () => {
      throw new Error("ETIMEDOUT");
    });
    const down = await agent.put("/api/profile/jsearch-key").send({ key: KEY }).expect(503);
    expect(down.body.error).toMatch(/Couldn't reach RapidAPI/);

    setJSearchKeyVerifierForTests(async () => ({ status: "valid" }));
    await agent.put("/api/profile/jsearch-key").send({ key: KEY }).expect(200);
    const removed = await agent.delete("/api/profile/jsearch-key").expect(200);
    expect(removed.body.jsearch.ownKey).toBeNull();
    expect(await query("SELECT * FROM jsearch_user_usage WHERE user_id = ? AND own_key = 1", [user.id])).toEqual([]);
    await agent.post("/api/profile/jsearch-key/check").expect(404);
  });
});

describe("cover notes for 'apply via link' postings", () => {
  async function linkItems() {
    setIst("2026-11-01T20:00");
    const ctx = await readyUser();
    setIst("2026-11-02T09:00");
    await runDueUsers();
    return { ...ctx, links: await items(ctx.user.id, "link_only"), emails: (await items(ctx.user.id)).filter((i) => i.type !== "link_only") };
  }

  it("keeps the posting's description, writes a note with the user's own key on request, and keeps it", async () => {
    const { agent, user, links } = await linkItems();
    expect(links.length).toBeGreaterThan(0);
    const item = links[0]!;
    const stored = await queryOne<{ job_description: string | null }>("SELECT job_description FROM run_items WHERE id = ?", [item.id]);
    expect(stored!.job_description).toBeTruthy();

    const keys: (string | undefined)[] = [];
    setGeneratorForTests(async (req) => {
      if (req.task === "cover_note") keys.push(req.apiKey);
      return mockGenerateJson(req);
    });
    const res = await agent.post(`/api/items/${item.id}/cover-note`).expect(200);
    expect(res.body.coverNote).toContain(item.job_title);
    expect(res.body.coverNote).toContain(item.company);
    expect(res.body.coverNote).toMatch(/^Dear Hiring Team,/);
    expect(keys).toHaveLength(1);

    // Asked again: the same note, no second AI call. It shows in the run's details too.
    const again = await agent.post(`/api/items/${item.id}/cover-note`).expect(200);
    expect(again.body.coverNote).toBe(res.body.coverNote);
    expect(keys).toHaveLength(1);
    const runId = (await queryOne<{ run_id: number }>("SELECT run_id FROM run_items WHERE id = ?", [item.id]))!.run_id;
    const detail = await agent.get(`/api/runs/${runId}`).expect(200);
    expect(detail.body.linkOnly.find((l: { id: number }) => l.id === Number(item.id)).coverNote).toBe(res.body.coverNote);
    expect(user.id).toBeGreaterThan(0);
  });

  it("only for the user's own 'apply via link' items; a key at its limit says so", async () => {
    const { agent, links, emails } = await linkItems();
    const other = await registerUser(undefined, { email: "someone.else@example.org" });
    await other.agent.post(`/api/items/${links[0]!.id}/cover-note`).expect(404);
    await agent.post(`/api/items/${emails[0]!.id}/cover-note`).expect(404);

    setGeneratorForTests(async (req) => {
      if (req.task === "cover_note") throw new AiQuotaError();
      return mockGenerateJson(req);
    });
    const limited = await agent.post(`/api/items/${links[0]!.id}/cover-note`).expect(429);
    expect(limited.body.error).toMatch(/usage limit/);
  });
});
