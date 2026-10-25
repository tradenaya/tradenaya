import bcrypt from "bcrypt";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { config } from "../config/env.js";
import { execute, isDuplicateKey, queryOne } from "../db/pool.js";
import { checkGeminiKey, geminiKeySchema, saveGeminiKey } from "../ai/user-key.js";
import { HttpError } from "../lib/errors.js";
import { log } from "../lib/logger.js";
import { signupApprovalRequired } from "../lib/settings.js";
import { actorOf, clearSessionCookie, h, parse, PENDING_MESSAGE, requireAuth, setSessionCookie, statusBlock, userOf } from "./common.js";

const BCRYPT_COST = 12;
// Compared against when the email doesn't exist, so login timing doesn't reveal accounts.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= bcrypt.hash("jobdraft-timing-equaliser", BCRYPT_COST));

const email = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.").max(254));
export const registerSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(100, "Name is too long."),
  email,
  // bcrypt only uses the first 72 bytes.
  password: z.string().min(8, "Password must be at least 8 characters.").max(72, "Password must be at most 72 characters."),
  // Each user brings their own key (the server has none): used for their resume, job checks and emails.
  geminiKey: geminiKeySchema,
});
const loginSchema = z.object({ email, password: z.string().min(1, "Enter your password.").max(200) });

/**
 * Creates an account (sign-up, or an admin creating one on someone's behalf).
 * The Gemini key is checked with Google first. Always role "user": admin rights
 * are only granted from the server shell.
 */
export async function createUser(body: z.infer<typeof registerSchema>, status: "pending" | "active" = "active"): Promise<{ id: number; name: string; email: string }> {
  await checkGeminiKey(body.geminiKey);
  const hash = await bcrypt.hash(body.password, BCRYPT_COST);
  let userId: number;
  try {
    const result = await execute("INSERT INTO users (name, email, password_hash, status) VALUES (?, ?, ?, ?)", [body.name, body.email, hash, status]);
    userId = result.insertId;
  } catch (err) {
    if (isDuplicateKey(err)) throw new HttpError(409, "An account with this email already exists. Try logging in.", "email_taken", { email: "Already registered." });
    throw err;
  }
  await execute("INSERT IGNORE INTO profiles (user_id) VALUES (?)", [userId]);
  await saveGeminiKey(userId, body.geminiKey);
  return { id: userId, name: body.name, email: body.email };
}

/** What the browser may know about the signed-in user. */
export const publicUser = (u: { id: number; name: string; email: string; role?: string }) => ({ id: u.id, name: u.name, email: u.email, isAdmin: u.role === "admin" });

export function authRouter() {
  const r = Router();
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config().authRateLimitMax,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many attempts. Please wait a few minutes and try again." },
  });

  r.post(
    "/register",
    limiter,
    h(async (req, res) => {
      const body = parse(registerSchema, req.body);
      // While sign-ups need approval (Google app in Testing mode), the account waits and no session is created.
      if (await signupApprovalRequired()) {
        const user = await createUser(body, "pending");
        log.info("user_registered_pending", { userId: user.id });
        res.status(201).json({ pending: true, message: PENDING_MESSAGE });
        return;
      }
      const user = await createUser(body);
      setSessionCookie(res, user.id);
      log.info("user_registered", { userId: user.id });
      res.status(201).json({ user: publicUser(user) });
    }),
  );

  r.post(
    "/login",
    limiter,
    h(async (req, res) => {
      const body = parse(loginSchema, req.body);
      const user = await queryOne<{ id: number; name: string; email: string; password_hash: string; role: string; status: string }>(
        "SELECT id, name, email, password_hash, role, status FROM users WHERE email = ?",
        [body.email],
      );
      const ok = await bcrypt.compare(body.password, user?.password_hash ?? (await getDummyHash()));
      if (!user || !ok) throw new HttpError(401, "Invalid email or password.");
      // Only after the password is right, so this doesn't reveal which emails exist.
      const blocked = statusBlock(user.status);
      if (blocked) throw blocked;
      setSessionCookie(res, user.id);
      res.json({ user: publicUser(user) });
    }),
  );

  r.post("/logout", (_req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  // While an admin uses JobDraft as this user, "actor" says who is acting (for the banner).
  r.get("/me", requireAuth, (req, res) => {
    const actor = actorOf(req);
    res.json({ user: publicUser(userOf(req)), actor: actor ? { id: actor.id, name: actor.name, email: actor.email } : null });
  });

  return r;
}
