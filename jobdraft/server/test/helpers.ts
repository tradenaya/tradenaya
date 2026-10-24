import { DateTime } from "luxon";
import { PDFDocument, StandardFonts } from "pdf-lib";
import request from "supertest";
import { createApp } from "../src/app.js";
import { config } from "../src/config/env.js";
import { execute, query, queryOne } from "../src/db/pool.js";
import { mockGmail } from "../src/gmail/index.js";
import { clock, MINUTE } from "../src/lib/clock.js";
import { decrypt } from "../src/lib/crypto.js";
import { processSendQueue } from "../src/runs/send-queue.js";

export const RESUME_LINES = [
  "Priya Sharma",
  "Bengaluru, Karnataka, India",
  "priya.sharma@gmail.com | +91 98765 43210 | https://www.linkedin.com/in/priyasharma",
  "EXPERIENCE",
  "Software Engineer | Acme Retail Tech | 2021-03 - Present",
  "- Built React and Node.js features for a checkout used by two million shoppers",
  "- Reduced page load time by 35 percent through code splitting and caching",
  "Associate Software Engineer | Blue Ocean Systems | 2019-07 - 2021-02",
  "- Developed REST APIs with Node.js and MySQL for the logistics team",
  "SKILLS",
  "JavaScript, TypeScript, React, Node.js, MySQL, AWS, Docker",
  "PROJECTS",
  "Order Tracker: real-time order tracking dashboard built with React and WebSockets",
  "EDUCATION",
  "B.Tech Computer Science | VIT Vellore | 2019",
];

export async function makePdf(lines: string[] = RESUME_LINES): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  lines.forEach((line, i) => page.drawText(line, { x: 40, y: 800 - i * 18, size: 10, font }));
  return Buffer.from(await doc.save());
}

/** Freeze the clock at an IST wall-clock time, e.g. "2026-11-02T09:00". */
export function setIst(iso: string): Date {
  const d = DateTime.fromISO(iso, { zone: "Asia/Kolkata" }).toJSDate();
  clock.set(d);
  return d;
}

export const istFmt = (d: Date | string | null) => (d ? DateTime.fromJSDate(new Date(d), { zone: "Asia/Kolkata" }).toFormat("yyyy-MM-dd HH:mm") : null);

const TABLES = [
  "followups", "run_items", "runs", "seen_jobs", "contacted_companies", "contacted_emails", "excluded_companies", "gmail_connections", "profiles",
  "job_cache", "job_locks", "api_usage", "search_rotation", "users",
];

export async function resetDb() {
  await execute("SET FOREIGN_KEY_CHECKS = 0");
  for (const t of TABLES) await execute(`DELETE FROM ${t}`);
  await execute("SET FOREIGN_KEY_CHECKS = 1");
  mockGmail.reset();
  clock.reset();
}

export function newAgent() {
  return request.agent(createApp());
}
export type Agent = ReturnType<typeof newAgent>;

/** A well-formed (fake) Gemini key: in mock mode keys are not checked with Google. */
export const TEST_GEMINI_KEY = "AIzaTestKey_0123456789abcdefghijklmnop";

let counter = 0;
export async function registerUser(agent = newAgent(), overrides: Partial<{ name: string; email: string; password: string; geminiKey: string }> = {}) {
  counter++;
  const body = { name: "Priya Sharma", email: `user${counter}-${Date.now()}@example.org`, password: "correct-horse-1", geminiKey: TEST_GEMINI_KEY, ...overrides };
  const res = await agent.post("/api/auth/register").send(body).expect(201);
  return { agent, user: res.body.user as { id: number; name: string; email: string }, password: body.password };
}

const DEFAULT_PDF = await makePdf();

export function uploadResume(agent: Agent, pdf: Buffer = DEFAULT_PDF, name = "Priya Sharma Resume.pdf") {
  return agent.post("/api/profile/resume").attach("resume", pdf, { filename: name, contentType: "application/pdf" });
}

export const DEFAULT_PREFS = {
  target_roles: ["Software Engineer", "Backend Developer"],
  locations: ["Bengaluru, Karnataka"],
  expected_salary_lpa: 12,
  run_time: "09:00",
};

export function savePreferences(agent: Agent, overrides: Record<string, unknown> = {}) {
  return agent.put("/api/profile/preferences").send({ ...DEFAULT_PREFS, ...overrides });
}

/** Runs the mocked OAuth round trip; returns the callback redirect location. */
export async function connectGmail(agent: Agent) {
  const start = await agent.get("/api/gmail/connect").expect(200);
  const url = new URL(start.body.url);
  const cb = await agent.get(`${url.pathname}${url.search}`).expect(302);
  return cb.headers.location as string;
}

export async function tokenOf(userId: number): Promise<string> {
  const row = await queryOne<{ refresh_token_enc: string }>("SELECT refresh_token_enc FROM gmail_connections WHERE user_id = ?", [userId]);
  return decrypt(row!.refresh_token_enc, config().encryptionKey());
}

/** A fully set-up user. Automation ON unless told otherwise. */
export async function readyUser(opts: { prefs?: Record<string, unknown>; automation?: boolean; email?: string } = {}) {
  const ctx = await registerUser(newAgent(), opts.email ? { email: opts.email } : {});
  await uploadResume(ctx.agent).expect(200);
  await savePreferences(ctx.agent, opts.prefs ?? {}).expect(200);
  await connectGmail(ctx.agent);
  if (opts.automation !== false) await ctx.agent.put("/api/automation").send({ enabled: true }).expect(200);
  return { ...ctx, token: await tokenOf(ctx.user.id) };
}

export async function waitForRun(runId: number) {
  for (let i = 0; i < 400; i++) {
    const run = await queryOne<{ status: string }>("SELECT status FROM runs WHERE id = ?", [runId]);
    if (run && run.status !== "running") return run;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("run did not finish");
}

export interface ItemRow {
  id: number;
  run_id: number;
  type: string;
  company: string;
  to_email: string | null;
  send_state: string;
  send_at: Date | null;
  sent_at: Date | null;
  gmail_draft_id: string | null;
  gmail_thread_id: string | null;
  outcome: string;
  followup_mode: string;
  followup_count: number;
  followups_stopped: number;
  reply_state: string;
  skip_reason: string | null;
}

export const items = (userId: number, type?: string) =>
  query<ItemRow>(`SELECT * FROM run_items WHERE user_id = ? ${type ? "AND type = ?" : ""} ORDER BY id`, type ? [userId, type] : [userId]);

export interface FollowUpRow {
  id: number;
  run_item_id: number;
  sequence: number;
  mode: string;
  state: string;
  due_at: Date;
  send_at: Date | null;
  sent_at: Date | null;
  gmail_draft_id: string | null;
}

export const followups = (userId: number) => query<FollowUpRow>("SELECT * FROM followups WHERE user_id = ? ORDER BY run_item_id, sequence", [userId]);

/** Run the send queue every `stepMin` minutes over an IST time range (fixed 2-minute gap). */
export async function drainQueue(fromIst: string, toIst: string, stepMin = 2) {
  let t = DateTime.fromISO(fromIst, { zone: "Asia/Kolkata" }).toJSDate().getTime();
  const end = DateTime.fromISO(toIst, { zone: "Asia/Kolkata" }).toJSDate().getTime();
  let sent = 0;
  for (; t <= end; t += stepMin * MINUTE) {
    clock.set(t);
    sent += (await processSendQueue(new Date(t), () => 0)).sent;
  }
  return sent;
}
