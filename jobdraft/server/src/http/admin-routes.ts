// Admin API (/api/admin). Admin rights come only from the server shell
// (npm run admin -- grant <email>) and are re-checked from the database on every
// request. Every action is written to admin_audit. Admin accounts can't be
// changed from here (only from the shell), and an admin can't act on themselves.
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { execute, query, queryOne } from "../db/pool.js";
import { clock } from "../lib/clock.js";
import { HttpError } from "../lib/errors.js";
import { log } from "../lib/logger.js";
import { config } from "../config/env.js";
import { setSignupApproval, signupApprovalRequired } from "../lib/settings.js";
import { sendAccessEmail } from "../runs/access-email.js";
import { loadProfile } from "../runs/profile.js";
import { cancelAllScheduled } from "../runs/send-queue.js";
import { deleteUserCompletely } from "./account-routes.js";
import { createUser, registerSchema } from "./auth-routes.js";
import { actorOf, h, idParam, parse, requireAdmin, requireAuth, setSessionCookie, userOf } from "./common.js";

export async function audit(adminId: number | null, action: string, target?: { id: number; email: string } | null, detail?: string) {
  await execute("INSERT INTO admin_audit (admin_id, action, target_user_id, target_email, detail) VALUES (?, ?, ?, ?, ?)", [
    adminId,
    action,
    target?.id ?? null,
    target?.email ?? null,
    detail?.slice(0, 300) ?? null,
  ]);
}

interface TargetRow {
  id: number;
  name: string;
  email: string;
  role: "user" | "admin";
  status: "pending" | "active" | "inactive";
}

/** The user an action is about: must exist, must not be the admin themselves or another admin. */
async function targetOf(adminId: number, id: number): Promise<TargetRow> {
  const t = await queryOne<TargetRow>("SELECT id, name, email, role, status FROM users WHERE id = ?", [id]);
  if (!t) throw new HttpError(404, "User not found.");
  if (t.id === adminId) throw new HttpError(400, "You can't do this to your own account here.");
  if (t.role === "admin") throw new HttpError(400, "Admin accounts can only be changed from the server (npm run admin).");
  return t;
}

interface UserStatsRow extends TargetRow {
  created_at: Date;
  status_changed_at: Date | null;
  automation_enabled: number | null;
  send_mode: string | null;
  has_resume: number;
  has_key: number;
  gemini_key_status: string | null;
  gmail_status: string | null;
  runs: number | null;
  last_run_at: Date | null;
  drafts: number | null;
  auto_sends: number | null;
  sent: number | null;
  link_only: number | null;
  replies: number | null;
}

const n = (v: number | string | null | undefined) => Number(v ?? 0);

/** For the approvals card: the switch, the Google test-users page, and whether the admin can send emails. */
async function approvalInfo(adminId: number) {
  const project = config().googleCloudProject;
  const admin = await loadProfile(adminId);
  return {
    required: await signupApprovalRequired(),
    googleTestUsersUrl: `https://console.cloud.google.com/auth/audience${project ? `?project=${encodeURIComponent(project)}` : ""}`,
    adminGmail: admin?.gmailStatus === "connected" ? admin.gmailAddress : null,
  };
}

export function adminRouter() {
  const r = Router();
  // "Return to admin" is called from the acting-as-user session, so it only needs a valid session.
  r.post(
    "/impersonate/stop",
    requireAuth,
    h(async (req, res) => {
      const actor = actorOf(req);
      if (!actor) throw new HttpError(400, "You're not using JobDraft as another user.");
      setSessionCookie(res, actor.id);
      await audit(actor.id, "impersonate_stop", { id: userOf(req).id, email: userOf(req).email });
      res.json({ ok: true });
    }),
  );

  r.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many admin requests. Please wait a few minutes." } }));
  r.use(requireAdmin);

  // Everyone, with their numbers. Totals are summed from the same rows.
  r.get(
    "/overview",
    h(async (req, res) => {
      const rows = await query<UserStatsRow>(
        `SELECT u.id, u.name, u.email, u.role, u.status, u.created_at, u.status_changed_at,
                p.automation_enabled, p.send_mode, p.resume_public_id IS NOT NULL AS has_resume, p.gemini_key_enc IS NOT NULL AS has_key, p.gemini_key_status,
                g.status AS gmail_status,
                rs.runs, rs.last_run_at,
                its.drafts, its.auto_sends, its.sent, its.link_only, its.replies
         FROM users u
         LEFT JOIN profiles p ON p.user_id = u.id
         LEFT JOIN gmail_connections g ON g.user_id = u.id
         LEFT JOIN (SELECT user_id, COUNT(*) AS runs, MAX(started_at) AS last_run_at FROM runs GROUP BY user_id) rs ON rs.user_id = u.id
         LEFT JOIN (
           SELECT user_id, SUM(type = 'draft') AS drafts, SUM(type = 'auto_send') AS auto_sends, SUM(send_state = 'sent') AS sent,
                  SUM(type = 'link_only') AS link_only, SUM(reply_state = 'replied') AS replies
           FROM run_items GROUP BY user_id
         ) its ON its.user_id = u.id
         ORDER BY u.created_at DESC, u.id DESC`,
      );
      const users = rows.map((u) => ({
        id: Number(u.id),
        name: u.name,
        email: u.email,
        isAdmin: u.role === "admin",
        status: u.status,
        createdAt: u.created_at,
        statusChangedAt: u.status_changed_at,
        automation: !!u.automation_enabled,
        sendMode: u.send_mode ?? "smart",
        setup: { resume: !!u.has_resume, geminiKey: !!u.has_key && u.gemini_key_status !== "invalid", gmail: u.gmail_status === "connected" },
        runs: n(u.runs),
        lastRunAt: u.last_run_at,
        drafts: n(u.drafts),
        autoSends: n(u.auto_sends),
        sent: n(u.sent),
        linkOnly: n(u.link_only),
        replies: n(u.replies),
      }));
      const sum = (k: "drafts" | "autoSends" | "sent" | "linkOnly" | "replies" | "runs") => users.reduce((a, u) => a + u[k], 0);
      res.json({
        totals: {
          users: users.length,
          active: users.filter((u) => u.status === "active").length,
          pending: users.filter((u) => u.status === "pending").length,
          inactive: users.filter((u) => u.status === "inactive").length,
          automationOn: users.filter((u) => u.automation && u.status === "active").length,
          runs: sum("runs"),
          drafts: sum("drafts"),
          autoSends: sum("autoSends"),
          sent: sum("sent"),
          linkOnly: sum("linkOnly"),
          replies: sum("replies"),
        },
        users,
        approval: await approvalInfo(userOf(req).id),
      });
    }),
  );

  // New sign-ups need approval (while the Google app is in Testing mode), or not.
  r.put(
    "/settings",
    h(async (req, res) => {
      const { signupApproval } = parse(z.object({ signupApproval: z.boolean() }), req.body);
      await setSignupApproval(signupApproval);
      await audit(userOf(req).id, signupApproval ? "approval_on" : "approval_off");
      res.json({ approval: await approvalInfo(userOf(req).id) });
    }),
  );

  // Approve a pending sign-up (after adding their email to the Google test users), optionally emailing them.
  r.post(
    "/users/:id/approve",
    h(async (req, res) => {
      const { id } = parse(idParam, req.params);
      const { notify } = parse(z.object({ notify: z.boolean().default(true) }), req.body ?? {});
      const admin = userOf(req);
      const t = await targetOf(admin.id, id);
      if (t.status !== "pending") throw new HttpError(400, "This account isn't waiting for approval.");
      // Only flips if still pending, so a double click can't approve twice.
      const done = await execute("UPDATE users SET status = 'active', status_changed_at = ? WHERE id = ? AND status = 'pending'", [clock.now(), id]);
      if (done.affectedRows !== 1) throw new HttpError(409, "This account was just approved or removed.");
      await audit(admin.id, "user_approve", t);
      const email = notify ? await sendAccessEmail(admin.id, t) : ({ sent: false, reason: "Not sent (you chose to tell them yourself)." } as const);
      if (email.sent) await audit(admin.id, "access_email_sent", t);
      res.json({ ok: true, email });
    }),
  );

  // Reject a pending sign-up: the account is deleted (they can register again later).
  r.post(
    "/users/:id/reject",
    h(async (req, res) => {
      const { id } = parse(idParam, req.params);
      const admin = userOf(req);
      const t = await targetOf(admin.id, id);
      if (t.status !== "pending") throw new HttpError(400, "Only sign-ups waiting for approval can be rejected. Use Delete instead.");
      await deleteUserCompletely(id);
      await audit(admin.id, "user_reject", t);
      res.json({ ok: true });
    }),
  );

  // Create an account on someone's behalf (same checks as sign-up, always a normal user).
  r.post(
    "/users",
    h(async (req, res) => {
      const body = parse(registerSchema, req.body);
      const user = await createUser(body);
      await audit(userOf(req).id, "user_create", user);
      log.info("admin_user_created", { adminId: userOf(req).id, userId: user.id });
      res.status(201).json({ user: { id: user.id, name: user.name, email: user.email } });
    }),
  );

  // Deactivate (no login, no runs, scheduled sends cancelled and kept as drafts) or reactivate.
  r.post(
    "/users/:id/status",
    h(async (req, res) => {
      const { id } = parse(idParam, req.params);
      const { active } = parse(z.object({ active: z.boolean() }), req.body);
      const admin = userOf(req);
      const t = await targetOf(admin.id, id);
      if (t.status === "pending") throw new HttpError(400, "Approve or reject this sign-up first.");
      const status = active ? "active" : "inactive";
      if (t.status !== status) {
        await execute("UPDATE users SET status = ?, status_changed_at = ? WHERE id = ?", [status, clock.now(), id]);
        if (!active) await cancelAllScheduled(id, "Account deactivated by the admin — kept as a draft");
        await audit(admin.id, active ? "user_activate" : "user_deactivate", t);
      }
      res.json({ ok: true, status });
    }),
  );

  // Delete completely: resume file, Google access, every row.
  r.delete(
    "/users/:id",
    h(async (req, res) => {
      const { id } = parse(idParam, req.params);
      const admin = userOf(req);
      const t = await targetOf(admin.id, id);
      await deleteUserCompletely(id);
      await audit(admin.id, "user_delete", t);
      res.json({ ok: true });
    }),
  );

  // Use JobDraft as this user: a 1-hour session that remembers the admin ("Return to admin").
  r.post(
    "/users/:id/impersonate",
    h(async (req, res) => {
      const { id } = parse(idParam, req.params);
      const admin = userOf(req);
      const t = await targetOf(admin.id, id);
      setSessionCookie(res, t.id, admin.id);
      await audit(admin.id, "impersonate_start", t);
      log.info("admin_impersonate", { adminId: admin.id, userId: t.id });
      res.json({ ok: true });
    }),
  );

  // The last 100 admin actions.
  r.get(
    "/audit",
    h(async (_req, res) => {
      const rows = await query<{ id: number; action: string; target_email: string | null; detail: string | null; created_at: Date; admin_email: string | null }>(
        `SELECT a.id, a.action, a.target_email, a.detail, a.created_at, u.email AS admin_email
         FROM admin_audit a LEFT JOIN users u ON u.id = a.admin_id ORDER BY a.id DESC LIMIT 100`,
      );
      res.json({ entries: rows.map((e) => ({ id: Number(e.id), action: e.action, target: e.target_email, detail: e.detail, at: e.created_at, admin: e.admin_email })) });
    }),
  );

  return r;
}
