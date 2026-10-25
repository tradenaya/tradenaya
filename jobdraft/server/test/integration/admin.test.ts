import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, execute, query, queryOne } from "../../src/db/pool.js";
import { mockGmail } from "../../src/gmail/index.js";
import { runDueUsers } from "../../src/runs/runner.js";
import { newAgent, readyUser, registerUser, resetDb, setIst, TEST_GEMINI_KEY } from "../helpers.js";

beforeEach(async () => {
  await resetDb();
  await execute("DELETE FROM admin_audit");
});
afterAll(closePool);

/** What the server-shell command does (npm run admin -- grant <email>). */
async function makeAdmin() {
  const ctx = await registerUser();
  await execute("UPDATE users SET role = 'admin' WHERE id = ?", [ctx.user.id]);
  return ctx;
}

describe("who can be admin", () => {
  it("nobody can become admin from the website: sign-up ignores a role field", async () => {
    const { agent, user } = await registerUser(newAgent(), { role: "admin" } as never);
    expect((await queryOne<{ role: string }>("SELECT role FROM users WHERE id = ?", [user.id]))!.role).toBe("user");
    await agent.get("/api/admin/overview").expect(403);
    await newAgent().get("/api/admin/overview").expect(401);
  });

  it("admin rights are read from the database on every request: revoking takes effect at once", async () => {
    const { agent, user } = await makeAdmin();
    expect((await agent.get("/api/auth/me").expect(200)).body.user.isAdmin).toBe(true);
    await agent.get("/api/admin/overview").expect(200);
    await execute("UPDATE users SET role = 'user' WHERE id = ?", [user.id]);
    await agent.get("/api/admin/overview").expect(403);
  });
});

describe("admin panel", () => {
  it("lists every user with their numbers and totals", async () => {
    setIst("2026-11-01T20:00");
    const { agent } = await makeAdmin();
    const u = await readyUser();
    setIst("2026-11-02T09:00");
    await runDueUsers();
    const res = await agent.get("/api/admin/overview").expect(200);
    const row = res.body.users.find((x: { id: number }) => x.id === u.user.id);
    const items = await query<{ type: string }>("SELECT type FROM run_items WHERE user_id = ?", [u.user.id]);
    expect(row).toMatchObject({ email: u.user.email, status: "active", automation: true, runs: 1, setup: { resume: true, geminiKey: true, gmail: true } });
    expect(row.drafts + row.autoSends).toBe(items.filter((i) => i.type !== "link_only").length);
    expect(row.linkOnly).toBe(items.filter((i) => i.type === "link_only").length);
    expect(res.body.totals).toMatchObject({ users: 2, active: 2, runs: 1 });
  });

  it("creates an account on someone's behalf (a normal user, Gemini key checked)", async () => {
    const { agent } = await makeAdmin();
    const res = await agent.post("/api/admin/users").send({ name: "Ravi", email: "ravi@example.org", password: "password123", geminiKey: TEST_GEMINI_KEY }).expect(201);
    expect((await queryOne<{ role: string }>("SELECT role FROM users WHERE id = ?", [res.body.user.id]))!.role).toBe("user");
    await newAgent().post("/api/auth/login").send({ email: "ravi@example.org", password: "password123" }).expect(200);
    await agent.post("/api/admin/users").send({ name: "X", email: "bad", password: "short" }).expect(400);
  });

  it("deactivate: no login, current sessions stop, no runs; reactivate restores everything", async () => {
    setIst("2026-11-01T20:00");
    const { agent } = await makeAdmin();
    const u = await readyUser();
    await agent.post(`/api/admin/users/${u.user.id}/status`).send({ active: false }).expect(200);
    const me = await u.agent.get("/api/auth/me").expect(403);
    expect(me.body).toMatchObject({ code: "account_inactive", error: "This account is inactive. Please ask the JobDraft admin to activate it." });
    const login = await newAgent().post("/api/auth/login").send({ email: u.user.email, password: u.password }).expect(403);
    expect(login.body.code).toBe("account_inactive");
    setIst("2026-11-02T09:00");
    expect((await runDueUsers()).claimed).toBe(0);
    await agent.post(`/api/admin/users/${u.user.id}/status`).send({ active: true }).expect(200);
    await u.agent.get("/api/auth/me").expect(200);
    expect((await agent.get("/api/admin/overview").expect(200)).body.users.find((x: { id: number }) => x.id === u.user.id).status).toBe("active");
  });

  it("deletes an account completely", async () => {
    const { agent } = await makeAdmin();
    const u = await readyUser();
    await agent.delete(`/api/admin/users/${u.user.id}`).expect(200);
    expect(await queryOne("SELECT id FROM users WHERE id = ?", [u.user.id])).toBeNull();
    expect(await queryOne("SELECT user_id FROM profiles WHERE user_id = ?", [u.user.id])).toBeNull();
  });

  it("can't change itself or other admins from the website", async () => {
    const { agent, user } = await makeAdmin();
    const other = await makeAdmin();
    await agent.post(`/api/admin/users/${user.id}/status`).send({ active: false }).expect(400);
    await agent.delete(`/api/admin/users/${other.user.id}`).expect(400);
    await agent.post(`/api/admin/users/${other.user.id}/impersonate`).expect(400);
  });
});

describe("use JobDraft as a user", () => {
  it("acts as the user with a banner identity, can't reach admin pages or delete the account meanwhile, and returns to admin", async () => {
    const { agent, user: admin } = await makeAdmin();
    const u = await readyUser();
    await agent.post(`/api/admin/users/${u.user.id}/impersonate`).expect(200);
    const me = await agent.get("/api/auth/me").expect(200);
    expect(me.body.user).toMatchObject({ id: u.user.id, isAdmin: false });
    expect(me.body.actor).toMatchObject({ id: admin.id });
    // Their JobDraft, as them.
    expect((await agent.get("/api/profile").expect(200)).body.resume.fullName).toBe("Priya Sharma");
    // Not admin pages, not account deletion.
    expect((await agent.get("/api/admin/overview").expect(403)).body.code).toBe("acting_as_user");
    expect((await agent.delete("/api/account").send({ password: u.password }).expect(403)).body.code).toBe("acting_as_user");
    // If the admin loses admin rights, the acting session ends.
    await execute("UPDATE users SET role = 'user' WHERE id = ?", [admin.id]);
    await agent.get("/api/profile").expect(401);
    await execute("UPDATE users SET role = 'admin' WHERE id = ?", [admin.id]);
    await agent.post("/api/admin/impersonate/stop").expect(200);
    const back = await agent.get("/api/auth/me").expect(200);
    expect(back.body).toMatchObject({ user: { id: admin.id, isAdmin: true }, actor: null });
  });

  it("every admin action is in the audit log", async () => {
    const { agent } = await makeAdmin();
    const u = await readyUser();
    await agent.post(`/api/admin/users/${u.user.id}/status`).send({ active: false }).expect(200);
    await agent.post(`/api/admin/users/${u.user.id}/status`).send({ active: true }).expect(200);
    await agent.post(`/api/admin/users/${u.user.id}/impersonate`).expect(200);
    await agent.post("/api/admin/impersonate/stop").expect(200);
    const log = (await agent.get("/api/admin/audit").expect(200)).body.entries.map((e: { action: string }) => e.action);
    expect(log).toEqual(["impersonate_stop", "impersonate_start", "user_activate", "user_deactivate"]);
  });
});

describe("sign-up approval (Google app in Testing mode)", () => {
  const signUp = (email: string) => newAgent().post("/api/auth/register").send({ name: "Friend", email, password: "friend-pass-1", geminiKey: TEST_GEMINI_KEY });

  it("while approval is on, a new account waits: no session, login says to wait, admin approves (emailing from the admin's Gmail)", async () => {
    // The admin has connected Gmail, so the approval email goes out from it.
    const admin = await readyUser({ automation: false });
    await execute("UPDATE users SET role = 'admin' WHERE id = ?", [admin.user.id]);
    await admin.agent.put("/api/admin/settings").send({ signupApproval: true }).expect(200);

    const friend = newAgent();
    const reg = await friend.post("/api/auth/register").send({ name: "Friend", email: "friend@example.org", password: "friend-pass-1", geminiKey: TEST_GEMINI_KEY }).expect(201);
    expect(reg.body).toMatchObject({ pending: true });
    expect(reg.headers["set-cookie"]).toBeUndefined(); // not logged in
    const login = await newAgent().post("/api/auth/login").send({ email: "friend@example.org", password: "friend-pass-1" }).expect(403);
    expect(login.body).toMatchObject({ code: "account_pending" });
    expect(login.body.error).toMatch(/waiting for the admin's approval/);

    const o = (await admin.agent.get("/api/admin/overview").expect(200)).body;
    const pending = o.users.find((u: { email: string }) => u.email === "friend@example.org");
    expect(pending.status).toBe("pending");
    expect(o.totals.pending).toBe(1);
    expect(o.approval).toMatchObject({ required: true, adminGmail: "mock.user@gmail.com" });
    expect(o.approval.googleTestUsersUrl).toMatch(/^https:\/\/console\.cloud\.google\.com\/auth\/audience/);
    // Deactivate/activate don't apply to a pending sign-up.
    await admin.agent.post(`/api/admin/users/${pending.id}/status`).send({ active: true }).expect(400);

    const sentBefore = mockGmail.sentCount();
    const approve = await admin.agent.post(`/api/admin/users/${pending.id}/approve`).send({ notify: true }).expect(200);
    expect(approve.body.email).toMatchObject({ sent: true, from: "mock.user@gmail.com" });
    expect(mockGmail.sentCount()).toBe(sentBefore + 1);
    await newAgent().post("/api/auth/login").send({ email: "friend@example.org", password: "friend-pass-1" }).expect(200);
    // A second click can't approve twice.
    await admin.agent.post(`/api/admin/users/${pending.id}/approve`).send({ notify: true }).expect(400);
    const log = (await admin.agent.get("/api/admin/audit").expect(200)).body.entries.map((e: { action: string }) => e.action);
    expect(log.slice(0, 3)).toEqual(["access_email_sent", "user_approve", "approval_on"]);
  });

  it("without the admin's Gmail connected, approval still works and says the email wasn't sent", async () => {
    const { agent } = await makeAdmin();
    await agent.put("/api/admin/settings").send({ signupApproval: true }).expect(200);
    await signUp("noemail@example.org").expect(201);
    const id = (await queryOne<{ id: number }>("SELECT id FROM users WHERE email = 'noemail@example.org'"))!.id;
    const res = await agent.post(`/api/admin/users/${id}/approve`).send({ notify: true }).expect(200);
    expect(res.body.email).toMatchObject({ sent: false });
    expect(res.body.email.reason).toMatch(/Connect your Gmail/);
  });

  it("reject deletes the pending sign-up; only pending ones can be rejected", async () => {
    const { agent } = await makeAdmin();
    await agent.put("/api/admin/settings").send({ signupApproval: true }).expect(200);
    await signUp("nope@example.org").expect(201);
    const id = (await queryOne<{ id: number }>("SELECT id FROM users WHERE email = 'nope@example.org'"))!.id;
    await agent.post(`/api/admin/users/${id}/reject`).expect(200);
    expect(await queryOne("SELECT id FROM users WHERE id = ?", [id])).toBeNull();
    await agent.put("/api/admin/settings").send({ signupApproval: false }).expect(200);
    const active = await registerUser();
    await agent.post(`/api/admin/users/${active.user.id}/reject`).expect(400);
  });

  it("with approval off, sign-ups log in at once; only admins can change the switch", async () => {
    const { agent } = await makeAdmin();
    await agent.put("/api/admin/settings").send({ signupApproval: false }).expect(200);
    const res = await signUp("instant@example.org").expect(201);
    expect(res.body.user.email).toBe("instant@example.org");
    const normal = await registerUser();
    await normal.agent.put("/api/admin/settings").send({ signupApproval: false }).expect(403);
  });
});
