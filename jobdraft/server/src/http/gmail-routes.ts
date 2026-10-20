import crypto from "node:crypto";
import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { config } from "../config/env.js";
import { execute, queryOne } from "../db/pool.js";
import { gmail, REQUIRED_SCOPES } from "../gmail/index.js";
import { clock } from "../lib/clock.js";
import { decrypt, encrypt, sha1 } from "../lib/crypto.js";
import { errInfo, log } from "../lib/logger.js";
import { cancelAllScheduled } from "../runs/send-queue.js";
import { h, requireAuth, userIdFromCookie, userOf } from "./common.js";

const STATE_AUDIENCE = "jobdraft-gmail-oauth";
const NONCE_COOKIE = "jd_oauth_nonce";

const callbackQuery = z.object({
  code: z.string().min(1).max(2048).optional(),
  state: z.string().min(1).max(4096).optional(),
  error: z.string().max(200).optional(),
});

function redirectToSetup(res: import("express").Response, result: string) {
  res.clearCookie(NONCE_COOKIE, { path: "/api/gmail" });
  res.redirect(302, `${config().clientUrl}/setup?gmail=${encodeURIComponent(result)}`);
}

/**
 * Revokes (best effort) and deletes the stored token, cancels scheduled sends
 * and follow-ups (they stay as Gmail drafts) and turns automation OFF.
 */
export async function disconnectGmail(userId: number): Promise<void> {
  const row = await queryOne<{ refresh_token_enc: string | null }>("SELECT refresh_token_enc FROM gmail_connections WHERE user_id = ?", [userId]);
  if (row?.refresh_token_enc) {
    try {
      await gmail().revoke(decrypt(row.refresh_token_enc, config().encryptionKey()));
    } catch (err) {
      log.warn("gmail_revoke_failed", { userId, error: errInfo(err) });
    }
  }
  await execute("UPDATE gmail_connections SET status = 'disconnected', refresh_token_enc = NULL, granted_scopes = NULL, last_error = NULL WHERE user_id = ?", [userId]);
  await cancelAllScheduled(userId, "Gmail was disconnected — kept as a draft");
  await execute("UPDATE profiles SET automation_enabled = 0, automation_changed_at = ? WHERE user_id = ? AND automation_enabled = 1", [clock.now(), userId]);
}

export function gmailRouter() {
  const r = Router();

  // Step 1: the client asks for Google's consent URL. The state is signed, bound
  // to this user, and paired with an httpOnly nonce cookie (CSRF protection).
  r.get(
    "/connect",
    requireAuth,
    h(async (req, res) => {
      const provider = gmail();
      const nonce = crypto.randomBytes(16).toString("hex");
      const state = jwt.sign({ n: sha1(nonce) }, config().jwtSecret, { subject: String(userOf(req).id), audience: STATE_AUDIENCE, expiresIn: "10m", algorithm: "HS256" });
      res.cookie(NONCE_COOKIE, nonce, { httpOnly: true, secure: config().cookieSecure, sameSite: "lax", path: "/api/gmail", maxAge: 10 * 60 * 1000 });
      res.json({ url: provider.authUrl(state) });
    }),
  );

  // Step 2: Google redirects the browser here.
  r.get(
    "/callback",
    h(async (req, res) => {
      const q = callbackQuery.safeParse(req.query);
      if (!q.success) return redirectToSetup(res, "error");
      if (q.data.error) return redirectToSetup(res, q.data.error === "access_denied" ? "denied" : "error");
      if (!q.data.code || !q.data.state) return redirectToSetup(res, "error");

      let stateUser: number;
      let stateNonceHash: string;
      try {
        const payload = jwt.verify(q.data.state, config().jwtSecret, { audience: STATE_AUDIENCE, algorithms: ["HS256"] }) as jwt.JwtPayload;
        stateUser = Number(payload.sub);
        stateNonceHash = String(payload.n ?? "");
      } catch {
        return redirectToSetup(res, "expired");
      }
      const sessionUser = userIdFromCookie(req);
      const nonce = req.cookies?.[NONCE_COOKIE];
      if (!sessionUser || sessionUser !== stateUser || typeof nonce !== "string" || sha1(nonce) !== stateNonceHash) {
        log.warn("gmail_state_mismatch", { userId: sessionUser ?? 0 });
        return redirectToSetup(res, "session");
      }

      try {
        const { refreshToken, email, scopes } = await gmail().exchangeCode(q.data.code);
        // Both Gmail permissions are needed; otherwise ask the user to reconnect and allow all.
        const complete = REQUIRED_SCOPES.every((s) => scopes.includes(s));
        const previous = await queryOne<{ refresh_token_enc: string | null }>("SELECT refresh_token_enc FROM gmail_connections WHERE user_id = ?", [stateUser]);
        const enc = encrypt(refreshToken, config().encryptionKey());
        const lastError = complete ? null : "Some Gmail permissions were not allowed. Please reconnect and tick every box.";
        await execute(
          `INSERT INTO gmail_connections (user_id, gmail_address, refresh_token_enc, granted_scopes, status, connected_at, last_error)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE gmail_address = VALUES(gmail_address), refresh_token_enc = VALUES(refresh_token_enc),
             granted_scopes = VALUES(granted_scopes), status = VALUES(status), connected_at = VALUES(connected_at), last_error = VALUES(last_error)`,
          [stateUser, email, enc, scopes.join(" ").slice(0, 1000), complete ? "connected" : "needs_reconnect", clock.now(), lastError],
        );
        if (!complete) await execute("UPDATE profiles SET automation_enabled = 0, automation_changed_at = ? WHERE user_id = ? AND automation_enabled = 1", [clock.now(), stateUser]);
        if (previous?.refresh_token_enc) {
          const old = decrypt(previous.refresh_token_enc, config().encryptionKey());
          if (old !== refreshToken) await gmail().revoke(old).catch(() => undefined);
        }
        log.info("gmail_connected", { userId: stateUser, complete });
        return redirectToSetup(res, complete ? "connected" : "scope");
      } catch (err) {
        log.warn("gmail_connect_failed", { userId: stateUser, error: errInfo(err) });
        return redirectToSetup(res, "error");
      }
    }),
  );

  r.post(
    "/disconnect",
    requireAuth,
    h(async (req, res) => {
      await disconnectGmail(userOf(req).id);
      res.json({ ok: true });
    }),
  );

  return r;
}
