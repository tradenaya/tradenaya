import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiUnavailableError, setGeneratorForTests } from "../../src/ai/index.js";
import { mockGenerateJson } from "../../src/ai/mock.js";
import { sleep } from "../../src/lib/errors.js";
import { RESUME_WAIT } from "../../src/resume/jobs.js";
import { config } from "../../src/config/env.js";
import { closePool, query, queryOne } from "../../src/db/pool.js";
import { GMAIL_COMPOSE, mockGmail } from "../../src/gmail/index.js";
import { decrypt } from "../../src/lib/crypto.js";
import { runDueUsers } from "../../src/runs/runner.js";
import { mockStorage } from "../../src/storage/index.js";
import { connectGmail, makePdf, newAgent, readyUser, registerUser, RESUME_LINES, resetDb, savePreferences, setIst, uploadResume } from "../helpers.js";

beforeEach(resetDb);
afterEach(() => {
  setGeneratorForTests(null);
  mockStorage.failNextUpload = false;
});
afterAll(closePool);

const publicIdOf = async (userId: number) =>
  (await queryOne<{ resume_public_id: string | null }>("SELECT resume_public_id FROM profiles WHERE user_id = ?", [userId]))?.resume_public_id ?? null;

const excludedOf = (userId: number) => query<{ company_name: string; source: string }>("SELECT company_name, source FROM excluded_companies WHERE user_id = ? ORDER BY company_name", [userId]);

describe("resume upload", () => {
  it("extracts, validates, computes experience, saves past employers to skip, and returns a preview", async () => {
    const { agent, user } = await registerUser();
    const res = await uploadResume(agent).expect(200);
    const r = res.body.resume;
    expect(r).toMatchObject({ fullName: "Priya Sharma", email: "priya.sharma@gmail.com", currentTitle: "Software Engineer", fileName: "Priya Sharma Resume.pdf" });
    expect(r.experienceYears).toBeGreaterThanOrEqual(7);
    expect(r.companies).toEqual(["Acme Retail Tech", "Blue Ocean Systems"]);
    expect(res.body.excludedCompanies).toEqual([
      { name: "Acme Retail Tech", source: "resume" },
      { name: "Blue Ocean Systems", source: "resume" },
    ]);
    expect(res.body).not.toHaveProperty("resume_text");
    const id = await publicIdOf(user.id);
    expect(id).toMatch(new RegExp(`^jobdraft/resumes/${user.id}/`));
    expect(await mockStorage.exists(id!)).toBe(true);
    const file = await agent.get("/api/profile/resume/file").expect(200);
    expect(file.headers["content-type"]).toBe("application/pdf");
  });

  it("rejects scanned/image PDFs, non-PDFs and big files", async () => {
    const { agent } = await registerUser();
    const scanned = await uploadResume(agent, await makePdf(["Scan 001"])).expect(400);
    expect(scanned.body.error).toBe("This looks like a scanned/image PDF. Please upload a text-based PDF.");
    const notPdf = await agent.post("/api/profile/resume").attach("resume", Buffer.from("PK\u0003\u0004 not a pdf"), { filename: "cv.pdf", contentType: "application/pdf" }).expect(400);
    expect(notPdf.body.error).toBe("Please upload a PDF file.");
    const png = await agent.post("/api/profile/resume").attach("resume", await makePdf(), { filename: "cv.png", contentType: "image/png" }).expect(400);
    expect(png.body.error).toBe("Please upload a PDF file.");
    const big = Buffer.concat([await makePdf(), Buffer.alloc(5 * 1024 * 1024)]);
    const tooBig = await agent.post("/api/profile/resume").attach("resume", big, { filename: "cv.pdf", contentType: "application/pdf" }).expect(400);
    expect(tooBig.body.error).toMatch(/5 MB/);
    await agent.post("/api/profile/resume").expect(400);
  });

  it("replaces a resume: old file deleted only after success; resume-sourced skips refreshed, manual ones kept", async () => {
    const { agent, user } = await registerUser();
    await uploadResume(agent).expect(200);
    const first = (await publicIdOf(user.id))!;
    await savePreferences(agent, { excluded_companies: ["Acme Retail Tech", "Blue Ocean Systems", "Sister Co Analytics"] }).expect(200);

    // 1) Upload to storage fails → old resume and skip list kept.
    mockStorage.failNextUpload = true;
    await uploadResume(agent, await makePdf([...RESUME_LINES, "Extra line"])).expect(502);
    expect(await publicIdOf(user.id)).toBe(first);
    expect(await mockStorage.exists(first)).toBe(true);

    // 2) AI output invalid twice → old resume kept.
    setGeneratorForTests(async () => ({ broken: true }));
    const bad = await uploadResume(agent).expect(422);
    expect(bad.body.error).toMatch(/couldn't read the details/);
    expect(await publicIdOf(user.id)).toBe(first);
    setGeneratorForTests(null);

    // 3) Scanned PDF → old resume kept.
    await uploadResume(agent, await makePdf(["tiny"])).expect(400);
    expect(await mockStorage.exists(first)).toBe(true);
    expect((await excludedOf(user.id)).map((e) => e.company_name)).toEqual(["Acme Retail Tech", "Blue Ocean Systems", "Sister Co Analytics"]);

    // 4) Success with a different employer history → new file, old one deleted, skips refreshed.
    const newLines = RESUME_LINES.map((l) => l.replace("Acme Retail Tech", "Kestrel Labs").replace("Blue Ocean Systems", "Orchid Robotics"));
    const ok = await uploadResume(agent, await makePdf(newLines), "New CV.pdf").expect(200);
    expect(ok.body.resume.fileName).toBe("New CV.pdf");
    const second = (await publicIdOf(user.id))!;
    expect(second).not.toBe(first);
    expect(await mockStorage.exists(second)).toBe(true);
    expect(await mockStorage.exists(first)).toBe(false);
    expect(await excludedOf(user.id)).toEqual([
      { company_name: "Kestrel Labs", source: "resume" },
      { company_name: "Orchid Robotics", source: "resume" },
      { company_name: "Sister Co Analytics", source: "manual" },
    ]);
  });
});

describe("resume read in the background", () => {
  afterEach(() => {
    RESUME_WAIT.ms = 20_000;
  });

  const pollUntilFinished = async (agent: Awaited<ReturnType<typeof registerUser>>["agent"]) => {
    for (let i = 0; i < 50; i++) {
      const s = (await agent.get("/api/profile/resume/status").expect(200)).body;
      if (s.status !== "reading") return s;
      await sleep(100);
    }
    throw new Error("still reading");
  };

  it("a slow read answers 202, keeps going, and the status endpoint reports it done (once)", async () => {
    const { agent } = await registerUser();
    RESUME_WAIT.ms = 50;
    setGeneratorForTests(async (req) => {
      await sleep(400);
      return mockGenerateJson(req);
    });
    const res = await uploadResume(agent).expect(202);
    expect(res.body).toEqual({ status: "reading" });
    const reading = (await agent.get("/api/profile/resume/status").expect(200)).body;
    expect(reading).toMatchObject({ status: "reading", fileName: "Priya Sharma Resume.pdf" });
    // A second upload while the first is still being read is refused.
    expect((await uploadResume(agent).expect(409)).body.error).toMatch(/still being read/);
    const done = await pollUntilFinished(agent);
    expect(done.status).toBe("done");
    expect(done.profile.resume.fullName).toBe("Priya Sharma");
    expect((await agent.get("/api/profile/resume/status").expect(200)).body).toEqual({ status: "none" });
  });

  it("a background read that fails is reported with a clear message and the old resume is kept", async () => {
    const { agent } = await registerUser();
    await uploadResume(agent).expect(200);
    RESUME_WAIT.ms = 50;
    setGeneratorForTests(async () => {
      await sleep(300);
      throw new AiUnavailableError("The AI is responding slowly right now. Please try again in a few minutes.");
    });
    await uploadResume(agent, undefined, "New.pdf").expect(202);
    const failed = await pollUntilFinished(agent);
    expect(failed).toEqual({ status: "failed", error: "The AI is responding slowly right now. Please try again in a few minutes." });
    expect((await agent.get("/api/profile").expect(200)).body.resume.fileName).toBe("Priya Sharma Resume.pdf");
  });

  it("quick problems (not a PDF, scanned) are still answered straight away", async () => {
    const { agent } = await registerUser();
    RESUME_WAIT.ms = 50;
    const scanned = await uploadResume(agent, await makePdf(["Scan 001"])).expect(400);
    expect(scanned.body.error).toMatch(/scanned/);
    expect((await agent.get("/api/profile/resume/status").expect(200)).body).toEqual({ status: "none" });
  });
});

describe("resume details edit", () => {
  it("returns everything that was read, and 404 before a resume exists", async () => {
    const { agent } = await registerUser();
    await agent.get("/api/profile/resume/details").expect(404);
    await uploadResume(agent).expect(200);
    const res = await agent.get("/api/profile/resume/details").expect(200);
    expect(res.body).toMatchObject({ full_name: "Priya Sharma", email: "priya.sharma@gmail.com" });
    expect(res.body.roles.length).toBeGreaterThanOrEqual(2);
    expect(res.body).not.toHaveProperty("projects");
  });

  it("saves corrections, recomputes experience and syncs only the changed skip-list companies", async () => {
    const { agent, user } = await registerUser();
    await uploadResume(agent).expect(200);
    // The user removed one resume company from the skip list on purpose.
    await agent.put("/api/profile/preferences").send({ target_roles: ["Backend Engineer"], locations: ["Bengaluru"], expected_salary_lpa: 20, excluded_companies: ["Blue Ocean Systems"] }).expect(200);
    const details = (await agent.get("/api/profile/resume/details").expect(200)).body;
    const edited = {
      ...details,
      full_name: "Priya S. Sharma",
      phone: "+91 98765 43210",
      roles: [
        { title: "Senior Engineer", company: "Nova Labs", start: "2020-01", end: "", is_current: true, bullets: ["Led payments", ""] },
        ...details.roles.filter((r: { company: string }) => r.company === "Acme Retail Tech"),
      ],
      skills: ["Go", "MySQL"],
      education: [{ degree: "", institution: "", year: "" }],
    };
    const res = await agent.put("/api/profile/resume/details").send(edited).expect(200);
    expect(res.body.resume).toMatchObject({ fullName: "Priya S. Sharma", phone: "+91 98765 43210", skills: ["Go", "MySQL"], education: [] });
    expect(res.body.resume.roles[0]).toMatchObject({ title: "Senior Engineer", company: "Nova Labs", end: "Present" });
    // Blue Ocean (no longer in roles) dropped, Nova Labs (new) added, Acme stays un-skipped as the user chose.
    expect(await excludedOf(user.id)).toEqual([{ company_name: "Nova Labs", source: "resume" }]);
    const saved = (await agent.get("/api/profile/resume/details").expect(200)).body;
    expect(saved.roles[0].bullets).toEqual(["Led payments"]);
    // Projects and role suggestions read from the PDF are kept.
    const row = await queryOne<{ resume_data: unknown }>("SELECT resume_data FROM profiles WHERE user_id = ?", [user.id]);
    const data = typeof row!.resume_data === "string" ? JSON.parse(row!.resume_data) : row!.resume_data;
    expect(data.suggested_target_roles.length).toBeGreaterThan(0);
  });

  it("rejects bad input with per-field messages", async () => {
    const { agent } = await registerUser();
    await uploadResume(agent).expect(200);
    const details = (await agent.get("/api/profile/resume/details").expect(200)).body;
    const res = await agent
      .put("/api/profile/resume/details")
      .send({ ...details, full_name: " ", email: "not-an-email", roles: [{ ...details.roles[0], start: "sometime" }], skills: ["Go", "go"] })
      .expect(400);
    expect(res.body.fields).toMatchObject({
      full_name: "Enter your name.",
      email: "Enter a valid email address.",
      "roles.0.start": "Use a date like 2024-06, Jun 2024 or 2024.",
      skills: "Skills must be different.",
    });
  });
});

describe("preferences", () => {
  it("saves roles, locations, salary, run time and companies to skip", async () => {
    const { agent } = await registerUser();
    await uploadResume(agent).expect(200);
    const res = await savePreferences(agent, { run_time: "18:45", excluded_companies: ["Acme Retail Tech", "Blue Ocean Systems", "Nimbus Analytics"] }).expect(200);
    expect(res.body.preferences).toMatchObject({ targetRoles: ["Software Engineer", "Backend Developer"], locations: ["Bengaluru, Karnataka"], expectedSalaryLpa: 12, runTime: "18:45" });
    expect(res.body.excludedCompanies).toEqual(expect.arrayContaining([{ name: "Nimbus Analytics", source: "manual" }]));
    expect(res.body.complete.preferences).toBe(true);
    // Removing a resume company (the UI confirms first) deletes it.
    const removed = await savePreferences(agent, { excluded_companies: ["Acme Retail Tech"] }).expect(200);
    expect(removed.body.excludedCompanies).toEqual([{ name: "Acme Retail Tech", source: "resume" }]);
  });

  it("defaults the daily run time to 9:00 AM", async () => {
    const { agent } = await registerUser();
    const res = await agent.put("/api/profile/preferences").send({ target_roles: ["Data Analyst"], locations: ["Pune, Maharashtra"], expected_salary_lpa: 8 }).expect(200);
    expect(res.body.preferences.runTime).toBe("09:00");
  });

  it.each([
    [{ target_roles: [] }, "target_roles"],
    [{ target_roles: Array.from({ length: 9 }, (_, i) => `Role ${i}`) }, "target_roles"],
    [{ target_roles: ["Dev Ops", "dev ops"] }, "target_roles"],
    [{ locations: [] }, "locations"],
    [{ locations: ["A1", "B2", "C3", "D4", "E5", "F6"] }, "locations"],
    [{ expected_salary_lpa: 0 }, "expected_salary_lpa"],
    [{ expected_salary_lpa: 201 }, "expected_salary_lpa"],
    [{ expected_salary_lpa: "lots" }, "expected_salary_lpa"],
    [{ run_time: "9am" }, "run_time"],
    [{ run_time: "09:10" }, "run_time"],
    [{ run_time: "24:00" }, "run_time"],
    [{ excluded_companies: ["x".repeat(151)] }, "excluded_companies.0"],
  ])("rejects %j", async (override, field) => {
    const { agent } = await registerUser();
    const res = await savePreferences(agent, override).expect(400);
    expect(res.body.fields).toHaveProperty(field);
  });

  it("previews the next run with the scheduler's own function", async () => {
    const { agent } = await registerUser();
    setIst("2026-11-02T08:00");
    const res = await agent.get("/api/profile/next-run?run_time=08:30").expect(200);
    expect(res.body.at).toBe(new Date("2026-11-02T03:00:00Z").toISOString());
    const past = await agent.get("/api/profile/next-run?run_time=07:30").expect(200);
    expect(past.body.at).toBe(new Date("2026-11-03T02:00:00Z").toISOString());
    await agent.get("/api/profile/next-run?run_time=07:31").expect(400);
  });
});

describe("gmail connect", () => {
  it("connects via the OAuth callback, stores the token encrypted and the granted scopes", async () => {
    const { agent, user } = await registerUser();
    const location = await connectGmail(agent);
    expect(location).toBe("http://localhost:3055/setup?gmail=connected");
    const row = await queryOne<{ gmail_address: string; refresh_token_enc: string; status: string; granted_scopes: string }>("SELECT * FROM gmail_connections WHERE user_id = ?", [user.id]);
    expect(row).toMatchObject({ gmail_address: "mock.user@gmail.com", status: "connected" });
    expect(row!.granted_scopes).toContain("gmail.metadata");
    expect(row!.refresh_token_enc).not.toMatch(/mock-refresh/);
    expect(decrypt(row!.refresh_token_enc, config().encryptionKey())).toMatch(/^mock-refresh-/);
    const profile = await agent.get("/api/profile").expect(200);
    expect(profile.body.gmail).toMatchObject({ status: "connected", address: "mock.user@gmail.com", allScopes: true });
    expect(JSON.stringify(profile.body)).not.toContain("mock-refresh");
  });

  it("a missing permission → needs_reconnect, and automation can't be turned on", async () => {
    const { agent } = await registerUser();
    await uploadResume(agent).expect(200);
    await savePreferences(agent).expect(200);
    mockGmail.nextScopes = ["openid", "email", GMAIL_COMPOSE]; // gmail.metadata left unticked
    expect(await connectGmail(agent)).toBe("http://localhost:3055/setup?gmail=scope");
    const profile = await agent.get("/api/profile").expect(200);
    expect(profile.body.gmail.status).toBe("needs_reconnect");
    expect(profile.body.automation.missing).toContain("Reconnect Gmail and allow all permissions");
    await agent.put("/api/automation").send({ enabled: true }).expect(400);
    mockGmail.nextScopes = ["openid", "email", GMAIL_COMPOSE, "https://www.googleapis.com/auth/gmail.metadata"];
    expect(await connectGmail(agent)).toBe("http://localhost:3055/setup?gmail=connected");
    await agent.put("/api/automation").send({ enabled: true }).expect(200);
  });

  it("rejects a state issued to another user or without the nonce cookie", async () => {
    const a = await registerUser();
    const b = await registerUser();
    const start = await a.agent.get("/api/gmail/connect").expect(200);
    const url = new URL(start.body.url);
    const stolen = await b.agent.get(`${url.pathname}${url.search}`).expect(302);
    expect(stolen.headers.location).toBe("http://localhost:3055/setup?gmail=session");
    const forged = await a.agent.get(`/api/gmail/callback?code=mock-auth-code&state=forged`).expect(302);
    expect(forged.headers.location).toBe("http://localhost:3055/setup?gmail=expired");
    const denied = await a.agent.get(`/api/gmail/callback?error=access_denied`).expect(302);
    expect(denied.headers.location).toBe("http://localhost:3055/setup?gmail=denied");
    expect(await queryOne("SELECT * FROM gmail_connections")).toBeNull();
  });

  it("disconnect revokes and deletes the token, cancels scheduled sends (kept as drafts) and turns automation off", async () => {
    setIst("2026-11-01T20:00");
    const { agent, user, token } = await readyUser();
    setIst("2026-11-02T09:00");
    await runDueUsers();
    const scheduled = await query<{ gmail_draft_id: string }>("SELECT gmail_draft_id FROM run_items WHERE user_id = ? AND send_state = 'scheduled'", [user.id]);
    expect(scheduled.length).toBeGreaterThan(0);
    await agent.post("/api/gmail/disconnect").expect(200);
    expect(mockGmail.revoked.has(token)).toBe(true);
    const row = await queryOne<{ refresh_token_enc: string | null; status: string }>("SELECT * FROM gmail_connections WHERE user_id = ?", [user.id]);
    expect(row).toMatchObject({ refresh_token_enc: null, status: "disconnected" });
    expect(await query("SELECT id FROM run_items WHERE user_id = ? AND send_state = 'scheduled'", [user.id])).toHaveLength(0);
    for (const s of scheduled) expect(mockGmail.drafts.has(s.gmail_draft_id)).toBe(true);
    const profile = await agent.get("/api/profile").expect(200);
    expect(profile.body.automation.enabled).toBe(false);
  });
});

describe("account", () => {
  it("changes the name", async () => {
    const { agent } = await registerUser();
    await agent.patch("/api/account").send({ name: "Priya S." }).expect(200);
    expect((await agent.get("/api/auth/me")).body.user.name).toBe("Priya S.");
    await agent.patch("/api/account").send({ name: "" }).expect(400);
  });

  it("deletes the account, resume file, Google token and every row (scheduled sends never go out)", async () => {
    setIst("2026-11-01T20:00");
    const { agent, user, password, token } = await readyUser();
    setIst("2026-11-02T09:00");
    await runDueUsers();
    const publicId = (await publicIdOf(user.id))!;
    await agent.delete("/api/account").send({ password: "wrong" }).expect(400);
    await agent.delete("/api/account").send({ password }).expect(200);
    await agent.get("/api/auth/me").expect(401);
    expect(await mockStorage.exists(publicId)).toBe(false);
    expect(mockGmail.revoked.has(token)).toBe(true);
    for (const table of ["users", "profiles", "gmail_connections", "runs", "run_items", "followups", "seen_jobs", "contacted_companies", "contacted_emails", "excluded_companies"]) {
      const col = table === "users" ? "id" : "user_id";
      expect(await queryOne(`SELECT 1 FROM ${table} WHERE ${col} = ?`, [user.id]), table).toBeNull();
    }
    expect(mockGmail.sendCalls).toBe(0);
  });

  it("re-registering the same email starts completely fresh", async () => {
    const email = `again-${Date.now()}@example.org`;
    setIst("2026-11-01T20:00");
    const first = await readyUser({ email });
    setIst("2026-11-02T09:00");
    await runDueUsers();
    await first.agent.delete("/api/account").send({ password: first.password }).expect(200);
    await first.agent.get("/api/profile").expect(401);

    const again = await registerUser(newAgent(), { email });
    expect(again.user.id).not.toBe(first.user.id);
    const profile = await again.agent.get("/api/profile").expect(200);
    expect(profile.body.complete).toEqual({ resume: false, preferences: false, gmail: false });
    expect(profile.body.resume).toBeNull();
    expect(profile.body.excludedCompanies).toEqual([]);
    expect(profile.body.automation.enabled).toBe(false);
    expect((await again.agent.get("/api/runs").expect(200)).body.runs).toEqual([]);
  });

  it("a new account starts with an incomplete profile and automation off", async () => {
    const res = await (await registerUser(newAgent())).agent.get("/api/profile").expect(200);
    expect(res.body.complete).toEqual({ resume: false, preferences: false, gmail: false });
    expect(res.body.gmail.status).toBe("not_connected");
    expect(res.body.automation).toMatchObject({ enabled: false });
    expect(res.body.preferences.runTime).toBe("09:00");
  });
});
