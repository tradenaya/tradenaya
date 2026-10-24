import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { setGeneratorForTests } from "../../src/ai/index.js";
import { mockGenerateJson } from "../../src/ai/mock.js";
import { closePool, query, queryOne } from "../../src/db/pool.js";
import { mockGmail } from "../../src/gmail/index.js";
import { runDueUsers, startManualRun } from "../../src/runs/runner.js";
import { drainQueue, followups, items, readyUser, registerUser, resetDb, setIst, waitForRun } from "../helpers.js";

beforeEach(resetDb);
afterEach(() => setGeneratorForTests(null));
afterAll(closePool);

const PAST_EMPLOYERS = /acme|blue ocean|workline|retail careers hub/i;

describe("a full daily run", () => {
  it("creates auto-send, draft and link-only items with the right statuses", async () => {
    setIst("2026-11-01T20:00"); // set up the evening before
    const { user, agent } = await readyUser();
    setIst("2026-11-02T09:00");
    expect(await runDueUsers()).toEqual({ claimed: 1, skipped: 0, blocked: 0 });

    const run = await queryOne<{ id: number; status: string; trigger: string; drafts_count: number; auto_send_count: number; link_only_count: number; scheduled_for: Date }>(
      "SELECT * FROM runs WHERE user_id = ?",
      [user.id],
    );
    expect(run).toMatchObject({ trigger: "scheduled", status: "ready_to_send" });
    expect(run!.auto_send_count).toBeGreaterThanOrEqual(1);
    expect(run!.auto_send_count).toBeLessThanOrEqual(5);
    expect(run!.drafts_count).toBeGreaterThanOrEqual(1);
    expect(run!.link_only_count).toBeGreaterThanOrEqual(1);
    expect(run!.drafts_count + run!.auto_send_count).toBeLessThanOrEqual(10);

    const all = await items(user.id);
    for (const i of all.filter((x) => x.type === "auto_send")) {
      expect(i).toMatchObject({ send_state: "scheduled", followup_mode: "auto" });
      expect(new Date(i.send_at!).toISOString()).toBe(new Date("2026-11-02T04:00:00Z").toISOString()); // 09:30 IST = run end + 30 min
    }
    for (const i of all.filter((x) => x.type === "draft")) expect(i).toMatchObject({ send_state: "none", followup_mode: "draft" });
    // Drafts really exist in Gmail, one per application, nothing sent yet.
    expect(mockGmail.drafts.size).toBe(run!.drafts_count + run!.auto_send_count);
    expect(mockGmail.sentCount()).toBe(0);
    // Contacted companies and addresses are recorded at draft time.
    const contacted = await query("SELECT * FROM contacted_emails WHERE user_id = ?", [user.id]);
    expect(contacted).toHaveLength(run!.drafts_count + run!.auto_send_count);
    // One email per company per run.
    const companies = all.filter((i) => i.type !== "link_only").map((i) => i.company);
    expect(new Set(companies).size).toBe(companies.length);
    expect(companies.join("|")).not.toMatch(PAST_EMPLOYERS);

    const dash = await agent.get("/api/dashboard").expect(200);
    expect(dash.body.lastRun.status).toBe("ready_to_send");
    expect(dash.body.upcoming.length).toBe(run!.auto_send_count);
    expect(dash.body.upcoming[0]).toMatchObject({ kind: "email", label: "Application" });
  });

  it("records a funnel that matches what was created; screens in batches of 5, at most 15 per run", async () => {
    const screens: number[] = [];
    let writes = 0;
    setGeneratorForTests(async (req) => {
      if (req.task === "screen") screens.push((req.input as { postings: unknown[] }).postings.length);
      if (req.task === "job_check") writes++;
      return mockGenerateJson(req);
    });
    setIst("2026-11-01T20:00");
    const { user, agent } = await readyUser();
    setIst("2026-11-02T09:00");
    await runDueUsers();

    const list = await agent.get("/api/runs").expect(200);
    const run = list.body.runs[0];
    const f = run.funnel;
    const all = await items(user.id);
    // Counts agree with the items that exist.
    expect(f.drafted).toBe(all.filter((i) => i.type === "draft").length);
    expect(f.autoSent).toBe(all.filter((i) => i.type === "auto_send").length);
    expect(f.linkOnly).toBe(all.filter((i) => i.type === "link_only").length);
    expect(f.drafted + f.autoSent).toBeGreaterThanOrEqual(1);
    expect(f.linkOnly).toBeGreaterThanOrEqual(1);
    expect(run.jobsConsidered).toBe(f.fetched);
    // Every filter step that the demo postings exercise is counted.
    expect(f.removed.excluded).toBeGreaterThanOrEqual(1); // past employers
    expect(f.removed.agency).toBeGreaterThanOrEqual(1);
    expect(f.removed.seniority).toBeGreaterThanOrEqual(1); // internship
    expect(f.removed.experience).toBeGreaterThanOrEqual(1); // principal, 12+ years
    const removed = Object.values(f.removed as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(f.afterFilters).toBeLessThanOrEqual(f.fetched);
    expect(f.fetched - removed).toBeLessThanOrEqual(f.afterFilters + (f.removed.excluded ?? 0));
    // AI: batches of ≤5, ≤15 postings per run, emails written only for suitable postings with an address.
    expect(screens.every((n) => n <= 5)).toBe(true);
    expect(f.aiChecked).toBe(screens.reduce((a, b) => a + b, 0));
    expect(f.aiChecked).toBeLessThanOrEqual(15);
    expect(f.notChecked).toBe(f.afterFilters - f.aiChecked);
    expect(f.suitable).toBeLessThanOrEqual(f.aiChecked);
    expect(f.emailsFound).toBeLessThanOrEqual(f.suitable);
    expect(writes).toBeLessThanOrEqual(f.emailsFound);
    expect(f.variants.plain.fetched).toBe(f.fetched);
    expect(f.variants.plain.emailApply).toBe(f.emailsFound);
    // Each link-only item keeps its apply URL; items remember the search variant.
    for (const i of await query<{ job_url: string; query_variant: string }>("SELECT job_url, query_variant FROM run_items WHERE user_id = ?", [user.id])) {
      expect(i.job_url).toMatch(/^https:\/\//);
      expect(i.query_variant).toBe("plain");
    }
  });

  it("never drafts or sends to current or past employers (name, portal client, web domain)", async () => {
    setIst("2026-11-01T20:00");
    // One role → the queue of AI checks reaches the "our client Blue Ocean Systems" portal posting.
    const { user, agent } = await readyUser({ prefs: { target_roles: ["Software Engineer"] } });
    const profile = await agent.get("/api/profile").expect(200);
    expect(profile.body.excludedCompanies.map((c: { name: string }) => c.name)).toEqual(expect.arrayContaining(["Acme Retail Tech", "Blue Ocean Systems"]));

    setIst("2026-11-02T09:00");
    await runDueUsers();
    await drainQueue("2026-11-02T09:30", "2026-11-02T10:30");
    const all = await items(user.id);
    expect(all.length).toBeGreaterThan(0);
    for (const i of all) {
      expect(i.company).not.toMatch(PAST_EMPLOYERS);
      expect(i.to_email ?? "").not.toMatch(/acmeretailtech|worklinecareers/);
    }
    // Every sent message went to a non-excluded address.
    for (const m of mockGmail.messages.values()) if (m.labels.has("SENT")) expect(m.headers.to).not.toMatch(/acmeretailtech|worklinecareers/);
    const seen = await query("SELECT * FROM seen_jobs WHERE user_id = ?", [user.id]);
    expect(seen.length).toBeGreaterThan(0);
  });

  it("respects a manually added company to skip", async () => {
    setIst("2026-11-01T20:00");
    const { user, agent } = await readyUser({ prefs: { target_roles: ["Software Engineer"] } });
    // Learn which companies a run would pick, then skip them all on another day's run.
    setIst("2026-11-02T09:00");
    await runDueUsers();
    const firstCompanies = (await items(user.id)).map((i) => i.company);
    await agent
      .put("/api/profile/preferences")
      .send({ target_roles: ["Software Engineer"], locations: ["Bengaluru, Karnataka"], expected_salary_lpa: 12, run_time: "09:00", excluded_companies: ["Acme Retail Tech", "Blue Ocean Systems", ...firstCompanies] })
      .expect(200);
    setIst("2026-11-03T09:00");
    await runDueUsers();
    const runs = await query<{ id: number }>("SELECT id FROM runs WHERE user_id = ? ORDER BY id", [user.id]);
    expect(runs).toHaveLength(2);
    const secondRun = (await items(user.id)).filter((i) => i.run_id === runs[1]!.id);
    for (const i of secondRun) expect(firstCompanies).not.toContain(i.company);
  });
});

describe("automation switch", () => {
  it("can't be turned on until setup is complete, and says what's missing", async () => {
    const { agent } = await registerUser();
    const res = await agent.put("/api/automation").send({ enabled: true }).expect(400);
    expect(res.body.error).toMatch(/upload your resume/i);
    const profile = await agent.get("/api/profile").expect(200);
    expect(profile.body.automation.missing).toEqual(expect.arrayContaining(["Upload your resume", "Connect Gmail"]));
    expect(profile.body.automation.enabled).toBe(false);
  });

  it("OFF: the scheduler skips the user entirely (no fetch, no AI calls) and scheduled sends are cancelled but kept as drafts", async () => {
    let aiCalls = 0;
    setGeneratorForTests(async (req) => {
      aiCalls++;
      return mockGenerateJson(req);
    });
    setIst("2026-11-01T20:00");
    const { user, agent } = await readyUser({ prefs: { target_roles: ["Data Analyst"] } });
    setIst("2026-11-02T09:00");
    await runDueUsers();
    const scheduled = (await items(user.id)).filter((i) => i.send_state === "scheduled");
    const callsAfterFirstRun = aiCalls;

    setIst("2026-11-02T09:10");
    await agent.put("/api/automation").send({ enabled: false }).expect(200);
    for (const i of await items(user.id, "auto_send")) expect(i.send_state).toBe("cancelled");
    for (const s of scheduled) expect(mockGmail.drafts.has(s.gmail_draft_id!)).toBe(true); // still a Gmail draft
    expect(await drainQueue("2026-11-02T09:30", "2026-11-02T10:00")).toBe(0);
    expect(mockGmail.sentCount()).toBe(0);

    const cacheBefore = await query("SELECT * FROM job_cache");
    setIst("2026-11-03T09:00");
    expect(await runDueUsers()).toEqual({ claimed: 0, skipped: 0, blocked: 0 });
    expect(aiCalls).toBe(callsAfterFirstRun);
    expect(await query("SELECT * FROM job_cache")).toHaveLength(cacheBefore.length);
    const dash = await agent.get("/api/dashboard").expect(200);
    expect(dash.body.automation.enabled).toBe(false);
    expect(dash.body.nextRunAt).toBeNull();
    await agent.post("/api/runs").expect(400); // Run now disabled while OFF
  });

  it("turning back ON never runs immediately and resumes at the next run time", async () => {
    setIst("2026-11-01T20:00");
    const { user, agent } = await readyUser();
    await agent.put("/api/automation").send({ enabled: false }).expect(200);
    setIst("2026-11-02T10:00"); // after today's 09:00
    const on = await agent.put("/api/automation").send({ enabled: true }).expect(200);
    expect(on.body.nextRunAt).toBe(new Date("2026-11-03T03:30:00Z").toISOString());
    expect(await runDueUsers()).toEqual({ claimed: 0, skipped: 0, blocked: 0 });
    setIst("2026-11-03T09:00");
    expect((await runDueUsers()).claimed).toBe(1);
    expect(await queryOne("SELECT id FROM runs WHERE user_id = ? AND `trigger` = 'scheduled'", [user.id])).not.toBeNull();
  });

  it("turned off mid-run: stops and keeps what was created as drafts", async () => {
    setIst("2026-11-01T20:00");
    const { user } = await readyUser();
    let calls = 0;
    setGeneratorForTests(async (req) => {
      calls++;
      if (calls === 2) {
        const { execute } = await import("../../src/db/pool.js");
        await execute("UPDATE profiles SET automation_enabled = 0 WHERE user_id = ?", [user.id]);
      }
      return mockGenerateJson(req);
    });
    setIst("2026-11-02T09:00");
    await runDueUsers();
    expect(calls).toBeLessThanOrEqual(3);
    const run = await queryOne<{ error_message: string }>("SELECT error_message FROM runs WHERE user_id = ?", [user.id]);
    expect(run!.error_message).toMatch(/turned off/);
    for (const i of await items(user.id)) expect(["none", "cancelled"]).toContain(i.send_state);
    expect(await followups(user.id)).toHaveLength(0);
  });
});

describe("Run now (manual)", () => {
  it("works, is rate-limited to once per 30 minutes, and doesn't block the scheduled run", async () => {
    setIst("2026-11-01T20:00");
    const { user, agent } = await readyUser();
    setIst("2026-11-02T08:00");
    const res = await agent.post("/api/runs").expect(202);
    expect(res.body.run).toMatchObject({ trigger: "manual", status: "running" });
    await waitForRun(res.body.run.id);
    const second = await agent.post("/api/runs").expect(429);
    expect(second.body.error).toMatch(/run again in 30 minutes/);
    setIst("2026-11-02T09:00");
    expect((await runDueUsers()).claimed).toBe(1);
    const runs = await query<{ trigger: string }>("SELECT `trigger` FROM runs WHERE user_id = ? ORDER BY id", [user.id]);
    expect(runs.map((r) => r.trigger)).toEqual(["manual", "scheduled"]);
    setIst("2026-11-02T08:31");
    const { done } = await startManualRun(user.id);
    await done;
  });

  it("fails clearly and flags Gmail when access expired (invalid_grant)", async () => {
    setIst("2026-11-01T20:00");
    const { user, agent, token } = await readyUser();
    mockGmail.invalidTokens.add(token);
    setIst("2026-11-02T09:00");
    await runDueUsers();
    const run = await queryOne<{ status: string; error_message: string }>("SELECT status, error_message FROM runs WHERE user_id = ?", [user.id]);
    expect(run).toMatchObject({ status: "failed", error_message: "Gmail access expired — please reconnect" });
    const profile = await agent.get("/api/profile").expect(200);
    expect(profile.body.gmail.status).toBe("error");
  });
});
