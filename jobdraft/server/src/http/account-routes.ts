import bcrypt from "bcrypt";
import { Router } from "express";
import { z } from "zod";
import { execute, queryOne } from "../db/pool.js";
import { HttpError } from "../lib/errors.js";
import { errInfo, log } from "../lib/logger.js";
import { clearResumeJob } from "../resume/jobs.js";
import { storage } from "../storage/index.js";
import { actorOf, clearSessionCookie, h, parse, requireAuth, userOf } from "./common.js";
import { publicUser } from "./auth-routes.js";
import { disconnectGmail } from "./gmail-routes.js";

const nameSchema = z.object({ name: z.string().trim().min(1, "Enter your name.").max(100, "Name is too long.") });
const deleteSchema = z.object({ password: z.string().min(1, "Enter your password to confirm.").max(200) });

/** Deletes the stored resume, revokes Google access, then every row (FK cascades). */
export async function deleteUserCompletely(userId: number): Promise<void> {
  const profile = await queryOne<{ resume_public_id: string | null }>("SELECT resume_public_id FROM profiles WHERE user_id = ?", [userId]);
  if (profile?.resume_public_id) {
    try {
      await storage().remove(profile.resume_public_id);
    } catch (err) {
      log.warn("account_delete_resume_failed", { userId, error: errInfo(err) });
    }
  }
  await disconnectGmail(userId).catch((err) => log.warn("account_delete_revoke_failed", { userId, error: errInfo(err) }));
  await execute("DELETE FROM users WHERE id = ?", [userId]);
  // A resume still being read can't be saved any more (no user row); forget its status.
  clearResumeJob(userId);
  log.info("account_deleted", { userId });
}

export function accountRouter() {
  const r = Router();
  r.use(requireAuth);

  r.patch(
    "/",
    h(async (req, res) => {
      const { name } = parse(nameSchema, req.body);
      await execute("UPDATE users SET name = ? WHERE id = ?", [name, userOf(req).id]);
      res.json({ user: publicUser({ ...userOf(req), name }) });
    }),
  );

  r.delete(
    "/",
    h(async (req, res) => {
      if (actorOf(req)) throw new HttpError(403, "You're using JobDraft as this user. Delete the account from the admin page instead.", "acting_as_user");
      const { password } = parse(deleteSchema, req.body);
      const userId = userOf(req).id;
      const user = await queryOne<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", [userId]);
      if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        throw new HttpError(400, "That password is not correct.", "validation", { password: "Incorrect password." });
      }
      await deleteUserCompletely(userId);
      clearSessionCookie(res);
      res.json({ ok: true });
    }),
  );

  return r;
}
