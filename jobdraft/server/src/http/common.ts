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
}

export type AuthedRequest = Request & { user: SessionUser };

export function signSession(userId: number): string {
  return jwt.sign({}, config().jwtSecret, { subject: String(userId), expiresIn: `${SESSION_DAYS}d`, audience: AUDIENCE, issuer: "jobdraft", algorithm: "HS256" });
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: config().cookieSecure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_DAYS * 24 * 3600 * 1000,
  };
}

export function setSessionCookie(res: Response, userId: number) {
  res.cookie(SESSION_COOKIE, signSession(userId), sessionCookieOptions());
}

export function clearSessionCookie(res: Response) {
  const { maxAge: _maxAge, ...opts } = sessionCookieOptions();
  res.clearCookie(SESSION_COOKIE, opts);
}

export function userIdFromCookie(req: Request): number | null {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token || typeof token !== "string") return null;
  try {
    const payload = jwt.verify(token, config().jwtSecret, { audience: AUDIENCE, issuer: "jobdraft", algorithms: ["HS256"] }) as jwt.JwtPayload;
    const id = Number(payload.sub);
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    const id = userIdFromCookie(req);
    if (!id) throw new HttpError(401, "Please log in.");
    const user = await queryOne<SessionUser>("SELECT id, name, email FROM users WHERE id = ?", [id]);
    if (!user) throw new HttpError(401, "Please log in.");
    (req as AuthedRequest).user = user;
    next();
  } catch (err) {
    next(err);
  }
};

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
