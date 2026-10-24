import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { closePool, queryOne } from "../../src/db/pool.js";
import { AiKeyRejectedError } from "../../src/ai/index.js";
import { setKeyVerifierForTests } from "../../src/ai/user-key.js";
import { config } from "../../src/config/env.js";
import { decrypt } from "../../src/lib/crypto.js";
import { newAgent, registerUser, resetDb, TEST_GEMINI_KEY } from "../helpers.js";

beforeEach(resetDb);
afterAll(closePool);

describe("auth", () => {
  it("registers, sets an httpOnly SameSite=Lax cookie and hashes with bcrypt cost 12", async () => {
    const agent = newAgent();
    const res = await agent.post("/api/auth/register").send({ name: " Asha ", email: "Asha@Example.org", password: "longenough", geminiKey: TEST_GEMINI_KEY }).expect(201);
    expect(res.body.user).toMatchObject({ name: "Asha", email: "asha@example.org" });
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toMatch(/jd_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const row = await queryOne<{ password_hash: string }>("SELECT password_hash FROM users WHERE email = 'asha@example.org'");
    expect(row!.password_hash).toMatch(/^\$2[aby]\$12\$/);
    const me = await agent.get("/api/auth/me").expect(200);
    expect(me.body.user.email).toBe("asha@example.org");
  });

  it("validates input with field messages", async () => {
    const res = await request(createApp()).post("/api/auth/register").send({ name: "", email: "nope", password: "short" }).expect(400);
    expect(Object.keys(res.body.fields).sort()).toEqual(["email", "geminiKey", "name", "password"]);
  });

  it("rejects duplicate emails", async () => {
    await registerUser(newAgent(), { email: "dup@example.org" });
    const res = await newAgent().post("/api/auth/register").send({ name: "B", email: "dup@example.org", password: "password123", geminiKey: TEST_GEMINI_KEY }).expect(409);
    expect(res.body.error).toMatch(/already exists/);
  });

  it("logs in and out; wrong password gives a generic error", async () => {
    const { password, user } = await registerUser();
    const agent = newAgent();
    const bad = await agent.post("/api/auth/login").send({ email: user.email, password: "wrong-password" }).expect(401);
    expect(bad.body.error).toBe("Invalid email or password.");
    const unknown = await agent.post("/api/auth/login").send({ email: "nobody@example.org", password: "whatever1" }).expect(401);
    expect(unknown.body.error).toBe(bad.body.error);
    await agent.post("/api/auth/login").send({ email: user.email.toUpperCase(), password }).expect(200);
    await agent.get("/api/auth/me").expect(200);
    await agent.post("/api/auth/logout").expect(200);
    await agent.get("/api/auth/me").expect(401);
  });

  it("guards every private endpoint", async () => {
    const app = request(createApp());
    for (const [method, path] of [
      ["get", "/api/profile"],
      ["put", "/api/profile/preferences"],
      ["post", "/api/profile/resume"],
      ["get", "/api/profile/resume/file"],
      ["get", "/api/dashboard"],
      ["get", "/api/runs"],
      ["post", "/api/runs"],
      ["get", "/api/runs/1"],
      ["post", "/api/runs/refresh"],
      ["post", "/api/runs/1/cancel-all"],
      ["post", "/api/items/1/cancel"],
      ["post", "/api/items/1/stop-followups"],
      ["post", "/api/followups/1/cancel"],
      ["put", "/api/automation"],
      ["get", "/api/profile/next-run?run_time=09:00"],
      ["get", "/api/gmail/connect"],
      ["post", "/api/gmail/disconnect"],
      ["patch", "/api/account"],
      ["delete", "/api/account"],
      ["get", "/api/status"],
    ] as const) {
      const res = await app[method](path);
      expect(res.status, `${method} ${path}`).toBe(401);
    }
    // Forged token
    await app.get("/api/auth/me").set("Cookie", "jd_session=eyJhbGciOiJIUzI1NiJ9.e30.abc").expect(401);
  });

  it("sets security headers and restricts CORS to CLIENT_URL", async () => {
    const app = request(createApp());
    const ok = await app.get("/api/health").set("Origin", "http://localhost:3055").expect(200);
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:3055");
    expect(ok.headers["access-control-allow-credentials"]).toBe("true");
    expect(ok.headers["x-content-type-options"]).toBe("nosniff");
    const evil = await app.get("/api/health").set("Origin", "https://evil.example");
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rate-limits login attempts", async () => {
    const prev = process.env.AUTH_RATE_LIMIT_MAX;
    process.env.AUTH_RATE_LIMIT_MAX = "3";
    try {
      const app = request(createApp());
      for (let i = 0; i < 3; i++) await app.post("/api/auth/login").send({ email: "x@example.org", password: "whatever1" }).expect(401);
      const res = await app.post("/api/auth/login").send({ email: "x@example.org", password: "whatever1" }).expect(429);
      expect(res.body.error).toMatch(/Too many attempts/);
    } finally {
      process.env.AUTH_RATE_LIMIT_MAX = prev;
    }
  });

  it("mounts the e2e clock helper only in test + mock mode", async () => {
    const { agent } = await registerUser();
    await agent.post("/api/__test/tick").send({ minutes: 1 }).expect(200);
    process.env.MOCK_EXTERNAL = "false";
    setKeyVerifierForTests(async () => undefined); // no real call to Google
    try {
      const prod = request.agent(createApp());
      const login = await prod.post("/api/auth/register").send({ name: "P", email: `p-${Date.now()}@example.org`, password: "password123", geminiKey: TEST_GEMINI_KEY }).expect(201);
      expect(login.body.user).toBeTruthy();
      await prod.post("/api/__test/tick").send({ minutes: 1 }).expect(404);
    } finally {
      process.env.MOCK_EXTERNAL = "true";
      setKeyVerifierForTests(null);
    }
  });

  it("never leaks internals on malformed JSON", async () => {
    const res = await request(createApp()).post("/api/auth/login").set("Content-Type", "application/json").send("{bad json").expect(400);
    expect(res.body).toEqual({ error: "Invalid request." });
  });
});

describe("each user's own Gemini API key", () => {
  afterEach(() => setKeyVerifierForTests(null));
  const body = (over: Record<string, unknown> = {}) => ({ name: "K", email: `k-${Date.now()}@example.org`, password: "password123", geminiKey: TEST_GEMINI_KEY, ...over });

  it("is required at registration, and must look like a key", async () => {
    const missing = await newAgent().post("/api/auth/register").send(body({ geminiKey: undefined })).expect(400);
    expect(missing.body.fields.geminiKey).toBe("Paste your Gemini API key.");
    const short = await newAgent().post("/api/auth/register").send(body({ geminiKey: "abc" })).expect(400);
    expect(short.body.fields.geminiKey).toMatch(/doesn't look like a Gemini API key/);
  });

  it("is checked with Google first: a rejected key creates no account", async () => {
    setKeyVerifierForTests(async () => {
      throw new AiKeyRejectedError();
    });
    const b = body();
    const res = await newAgent().post("/api/auth/register").send(b).expect(400);
    expect(res.body.fields).toEqual({ geminiKey: "Google rejected this key." });
    expect(await queryOne("SELECT id FROM users WHERE email = ?", [b.email])).toBeNull();
  });

  it("is stored encrypted, shown only by its last 4 characters, and can be replaced or removed", async () => {
    const { agent, user } = await registerUser();
    const row = await queryOne<{ gemini_key_enc: string; gemini_key_hint: string; gemini_key_status: string }>(
      "SELECT gemini_key_enc, gemini_key_hint, gemini_key_status FROM profiles WHERE user_id = ?",
      [user.id],
    );
    expect(row!.gemini_key_enc).not.toContain(TEST_GEMINI_KEY);
    expect(decrypt(row!.gemini_key_enc, config().encryptionKey())).toBe(TEST_GEMINI_KEY);
    expect(row).toMatchObject({ gemini_key_hint: TEST_GEMINI_KEY.slice(-4), gemini_key_status: "valid" });
    const p = (await agent.get("/api/profile").expect(200)).body;
    expect(p.geminiKey).toMatchObject({ saved: true, hint: TEST_GEMINI_KEY.slice(-4), status: "valid", getKeyUrl: "https://aistudio.google.com/apikey" });
    expect(JSON.stringify(p)).not.toContain(TEST_GEMINI_KEY);

    const next = "AIzaAnotherKey_abcdefghijklmnopqrstuvwxyz";
    const replaced = await agent.put("/api/profile/gemini-key").send({ key: next }).expect(200);
    expect(replaced.body.geminiKey.hint).toBe(next.slice(-4));
    setKeyVerifierForTests(async () => {
      throw new AiKeyRejectedError();
    });
    const bad = await agent.put("/api/profile/gemini-key").send({ key: "AIzaRejected_abcdefghijklmnopqrstuvwxyz0" }).expect(400);
    expect(bad.body.fields).toEqual({ key: "Google rejected this key." });
    expect((await agent.get("/api/profile").expect(200)).body.geminiKey.hint).toBe(next.slice(-4)); // unchanged

    const removed = await agent.delete("/api/profile/gemini-key").expect(200);
    expect(removed.body.geminiKey).toMatchObject({ saved: false, hint: null });
    expect(removed.body.automation.missing).toContain("Add your Gemini API key");
  });
});
