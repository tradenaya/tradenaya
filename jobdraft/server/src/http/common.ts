import type { NextFunction, Request, RequestHandler, Response } from "express";
import jwt from "jsonwebtoken";
import multer from "multer";
import { z, type ZodType } from "zod";
import { config } from "../config/env.js";
import { queryOne } from "../db/pool.js";
import { HttpError } from "../lib/errors.js";
import { errInfo, log } from "../lib/logger.js";

export const SESSION_COOKIE = "jd_session";
const SESSION_DAYS = 7;
const AUDIENCE = "jobdraft-web";

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  role: "user" | "admin";
  status: "pending" | "active" | "inactive";
}

/**
 * `user` is whose JobDraft this request acts on. `actor` is set only while an
 * admin uses JobDraft as that user ("act" claim): the admin who is acting.
 */
export type AuthedRequest = Request & { user: SessionUser; actor?: SessionUser };

/** An admin acting as a user gets a short session; normal sessions last 7 days. */
export const IMPERSONATION_MINUTES = 60;

export function signSession(userId: number, actorId?: number): string {
  return jwt.sign(actorId ? { act: actorId } : {}, config().jwtSecret, {
    subject: String(userId),
    expiresIn: actorId ? `${IMPERSONATION_MINUTES}m` : `${SESSION_DAYS}d`,
    audience: AUDIENCE,
    issuer: "jobdraft",
    algorithm: "HS256",
  });
}

export function sessionCookieOptions(actorId?: number) {
  return {
    httpOnly: true,
    secure: config().cookieSecure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: actorId ? IMPERSONATION_MINUTES * 60 * 1000 : SESSION_DAYS * 24 * 3600 * 1000,
  };
}

export function setSessionCookie(res: Response, userId: number, actorId?: number) {
  res.cookie(SESSION_COOKIE, signSession(userId, actorId), sessionCookieOptions(actorId));
}

export function clearSessionCookie(res: Response) {
  const { maxAge: _maxAge, ...opts } = sessionCookieOptions();
  res.clearCookie(SESSION_COOKIE, opts);
}

export function sessionFromCookie(req: Request): { userId: number; actorId?: number } | null {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token || typeof token !== "string") return null;
  try {
    const payload = jwt.verify(token, config().jwtSecret, { audience: AUDIENCE, issuer: "jobdraft", algorithms: ["HS256"] }) as jwt.JwtPayload;
    const id = Number(payload.sub);
    if (!Number.isInteger(id) || id <= 0) return null;
    const act = payload.act === undefined ? undefined : Number(payload.act);
    if (act !== undefined && (!Number.isInteger(act) || act <= 0)) return null;
    return { userId: id, ...(act ? { actorId: act } : {}) };
  } catch {
    return null;
  }
}

export function userIdFromCookie(req: Request): number | null {
  return sessionFromCookie(req)?.userId ?? null;
}

const loadSessionUser = (id: number) => queryOne<SessionUser>("SELECT id, name, email, role, status FROM users WHERE id = ?", [id]);

export const INACTIVE_MESSAGE = "This account is inactive. Please ask the JobDraft admin to activate it.";
export const PENDING_MESSAGE = "Your account is waiting for the admin's approval. You can log in as soon as it's approved.";

/** Why this account can't sign in, or null. */
export function statusBlock(status: string): HttpError | null {
  if (status === "pending") return new HttpError(403, PENDING_MESSAGE, "account_pending");
  if (status !== "active") return new HttpError(403, INACTIVE_MESSAGE, "account_inactive");
  return null;
}

/**
 * Role and status are read from the database on every request (never trusted
 * from the cookie), so deactivation and admin revocation take effect at once.
 * An "act as user" session is valid only while its admin is still an active admin.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    const session = sessionFromCookie(req);
    if (!session) throw new HttpError(401, "Please log in.");
    const user = await loadSessionUser(session.userId);
    if (!user) throw new HttpError(401, "Please log in.");
    if (session.actorId) {
      const actor = await loadSessionUser(session.actorId);
      if (!actor || actor.role !== "admin" || actor.status !== "active") throw new HttpError(401, "Please log in.");
      (req as AuthedRequest).actor = actor;
    } else {
      const blocked = statusBlock(user.status);
      if (blocked) throw blocked;
    }
    (req as AuthedRequest).user = user;
    next();
  } catch (err) {
    next(err);
  }
};

/** Admin pages: a real (not acting-as-user) session of an active admin. */
export const requireAdmin: RequestHandler = (req, res, next) => {
  requireAuth(req, res, (err?: unknown) => {
    if (err) return next(err);
    const r = req as AuthedRequest;
    if (r.actor) return next(new HttpError(403, "Return to your admin account first.", "acting_as_user"));
    if (r.user.role !== "admin") return next(new HttpError(403, "Admins only."));
    next();
  });
};

export const actorOf = (req: Request) => (req as AuthedRequest).actor;

export const userOf = (req: Request) => (req as AuthedRequest).user;

/** Parses with zod; a failure becomes a 400 with per-field messages. */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_";
    if (!fields[key]) fields[key] = issue.message;
  }
  throw new HttpError(400, "Please check the highlighted fields.", "validation", fields);
}

export const idParam = z.object({ id: z.coerce.number().int().positive() });

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;
/** Express 5 forwards rejected promises, but this keeps handlers explicit and typed. */
export const h =
  (fn: AsyncHandler): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, code: err.code, fields: err.fields });
    return;
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === "LIMIT_FILE_SIZE" ? "The file is larger than 5 MB." : "Please upload one PDF file.";
    res.status(400).json({ error: message });
    return;
  }
  const status = (err as { status?: number; type?: string }).status;
  if (status === 400 || (err as { type?: string }).type === "entity.parse.failed") {
    res.status(400).json({ error: "Invalid request." });
    return;
  }
  if (status === 413) {
    res.status(413).json({ error: "Request too large." });
    return;
  }
  log.error("unhandled_error", { method: req.method, path: req.path, error: errInfo(err) });
  res.status(500).json({ error: "Something went wrong. Please try again." });
}
