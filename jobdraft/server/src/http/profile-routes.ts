import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { config } from "../config/env.js";
import { execute, queryOne } from "../db/pool.js";
import { clock } from "../lib/clock.js";
import { HttpError } from "../lib/errors.js";
import { istDate, nextRunAt, normalizeRunTime } from "../lib/time.js";
import { MAX_RESUME_BYTES } from "../resume/pdf.js";
import { checkGeminiKey, GEMINI_KEY_URL, geminiKeySchema, removeGeminiKey, saveGeminiKey } from "../ai/user-key.js";
import { editableResume, resumeEditSchema, saveResumeEdits } from "../resume/edit.js";
import { clearResumeJob, resumeJob, startResumeJob } from "../resume/jobs.js";
import { readResumeFile } from "../resume/service.js";
import {
  hasAllScopes,
  hasScheduledRunAt,
  listExcluded,
  loadProfile,
  missingForAutomation,
  nextRunFor,
  resumeCompanies,
  saveExclusions,
  settingsChangedAt,
} from "../runs/profile.js";
import { setAutomation, setSendMode } from "../runs/runner.js";
import { DEFAULT_SEND_MODE, SEND_MODE_VALUES, type SendMode } from "../runs/safety.js";
import { storage } from "../storage/index.js";
import { h, parse, requireAuth, userOf } from "./common.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_RESUME_BYTES, files: 1, fields: 5 } });

const label = (max: number, what: string) => z.string().trim().min(2, `${what} is too short.`).max(max, `${what} is too long.`);
const unique = (a: string[]) => new Set(a.map((s) => s.toLowerCase())).size === a.length;

/** "HH:MM" in 15-minute steps (any time of day), India time. */
export const runTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):(00|15|30|45)$/, "Pick a time in 15-minute steps, e.g. 09:00 or 14:30.");

export const preferencesSchema = z.object({
  target_roles: z.array(label(80, "Role")).min(1, "Add at least one role.").max(8, "Up to 8 roles.").refine(unique, "Roles must be different."),
  locations: z.array(label(100, "Location")).min(1, "Pick at least one location.").max(5, "Up to 5 locations.").refine(unique, "Locations must be different."),
  expected_salary_lpa: z.coerce.number({ error: "Enter a number." }).min(1, "Minimum is 1 LPA.").max(200, "Maximum is 200 LPA."),
  run_time: runTimeSchema.default("09:00"),
  // Optional: only replaces the skip list when sent (the Setup form always sends it).
  excluded_companies: z.array(z.string().trim().min(1).max(150, "Company name is too long.")).max(50, "Up to 50 companies.").optional(),
});

/** Everything the Setup and Dashboard screens need. Never includes tokens or raw resume text. */
export async function profilePayload(userId: number) {
  const p = await loadProfile(userId);
  const g = await queryOne<{ connected_at: Date | null; last_error: string | null; send_paused_until: Date | null }>(
    "SELECT connected_at, last_error, send_paused_until FROM gmail_connections WHERE user_id = ?",
    [userId],
  );
  const uploaded = await queryOne<{ resume_uploaded_at: Date | null }>("SELECT resume_uploaded_at FROM profiles WHERE user_id = ?", [userId]);
  const data = p?.resume ?? null;
  const resume =
    p?.resumePublicId && data
      ? {
          fileName: p.resumeFileName,
          uploadedAt: uploaded?.resume_uploaded_at ?? null,
          experienceYears: p.experienceYears,
          fullName: data.full_name,
          email: data.email,
          phone: data.phone,
          linkedin: data.linkedin,
          location: data.location,
          currentTitle: data.current_title,
          companies: resumeCompanies(data),
          roles: data.roles.slice(0, 3).map((r) => ({ title: r.title, company: r.company, start: r.start, end: r.end })),
          skills: data.skills.slice(0, 15),
          education: data.education.slice(0, 3),
          suggestedTargetRoles: data.suggested_target_roles,
        }
      : null;
  const status = p?.gmailStatus ?? null;
  const excluded = await listExcluded(userId);
  const now = clock.now();
  return {
    resume,
    preferences: {
      targetRoles: p?.targetRoles ?? [],
      locations: p?.locations ?? [],
      expectedSalaryLpa: p?.expectedSalaryLpa ?? null,
      runTime: p?.runTime ?? "09:00",
      saved: (p?.targetRoles.length ?? 0) > 0,
    },
    excludedCompanies: excluded.map((e) => ({ name: e.company_name, source: e.source })),
    automation: {
      enabled: !!p?.automationEnabled,
      changedAt: p?.automationChangedAt ?? null,
      /** Kept while automation is OFF; only applies while it is ON. */
      sendMode: p?.sendMode ?? DEFAULT_SEND_MODE,
      sendModeChangedAt: p?.sendModeChangedAt ?? null,
      missing: missingForAutomation(p),
    },
    nextRunAt: p ? await nextRunFor(p, now) : null,
    gmail: {
      status: status ?? "not_connected",
      address: status && status !== "disconnected" ? (p?.gmailAddress ?? null) : null,
      connectedAt: g?.connected_at ?? null,
      lastError: status === "error" || status === "needs_reconnect" ? (g?.last_error ?? null) : null,
      allScopes: p ? hasAllScopes(p) : false,
      sendPausedUntil: g?.send_paused_until && new Date(g.send_paused_until) > now ? g.send_paused_until : null,
    },
    // Never the key itself: whether one is saved, its last 4 characters and whether Google accepts it.
    geminiKey: {
      saved: !!p?.geminiKeyEnc,
      hint: p?.geminiKeyHint ?? null,
      status: p?.geminiKeyStatus ?? null,
      updatedAt: p?.geminiKeyUpdatedAt ?? null,
      getKeyUrl: GEMINI_KEY_URL,
    },
    complete: {
      geminiKey: !!p?.geminiKeyEnc && p.geminiKeyStatus !== "invalid",
      resume: !!resume,
      preferences: (p?.targetRoles.length ?? 0) > 0 && (p?.locations.length ?? 0) > 0 && p?.expectedSalaryLpa != null,
      gmail: status === "connected" && (p ? hasAllScopes(p) : false),
    },
  };
}

export function profileRouter() {
  const r = Router();
  r.use(requireAuth);

  r.get("/", h(async (req, res) => res.json(await profilePayload(userOf(req).id))));

  r.post(
    "/resume",
    upload.single("resume"),
    h(async (req, res) => {
      if (!req.file) throw new HttpError(400, "Please choose a PDF file.", "validation", { resume: "Choose a PDF file." });
      const userId = userOf(req).id;
      // Quick checks answer straight away; the AI read may continue in the background.
      const text = await readResumeFile(userId, req.file);
      // Reading needs the user's own AI key.
      if (!(await loadProfile(userId))?.geminiKeyEnc) throw new HttpError(400, "Add your Gemini API key first (Setup → Gemini API key), then upload your resume.", "gemini_key");
      storage(); // "not configured" now, not after the AI call
      const finished = await startResumeJob(userId, req.file, text);
      if (!finished) {
        res.status(202).json({ status: "reading" });
        return;
      }
      const job = resumeJob(userId)!;
      clearResumeJob(userId);
      if (job.status === "failed") throw new HttpError(job.httpStatus ?? 500, job.error ?? "Reading the resume failed.");
      res.json(await profilePayload(userId));
    }),
  );

  // Polled by the page while a resume is read in the background (and on page load, to pick up a read in progress).
  r.get(
    "/resume/status",
    h(async (req, res) => {
      const userId = userOf(req).id;
      const job = resumeJob(userId);
      if (!job) {
        res.json({ status: "none" });
        return;
      }
      if (job.status === "reading") {
        res.json({ status: "reading", fileName: job.fileName, seconds: Math.floor((Date.now() - job.startedAt) / 1000) });
        return;
      }
      clearResumeJob(userId); // a finished read is reported once
      if (job.status === "failed") res.json({ status: "failed", error: job.error });
      else res.json({ status: "done", profile: await profilePayload(userId) });
    }),
  );

  // The user's own Gemini API key: checked with Google, then stored encrypted.
  r.put(
    "/gemini-key",
    h(async (req, res) => {
      const { key } = parse(z.object({ key: geminiKeySchema }), req.body);
      await checkGeminiKey(key, "key");
      await saveGeminiKey(userOf(req).id, key);
      res.json(await profilePayload(userOf(req).id));
    }),
  );

  r.delete(
    "/gemini-key",
    h(async (req, res) => {
      await removeGeminiKey(userOf(req).id);
      res.json(await profilePayload(userOf(req).id));
    }),
  );

  // Everything the AI read from the resume, for the "Edit details" form.
  r.get(
    "/resume/details",
    h(async (req, res) => {
      const p = await loadProfile(userOf(req).id);
      if (!p?.resume || !p.resumePublicId) throw new HttpError(404, "Upload your resume first.");
      res.json(editableResume(p.resume));
    }),
  );

  // The user's corrections to what was read; the PDF itself is not changed.
  r.put(
    "/resume/details",
    h(async (req, res) => {
      const body = parse(resumeEditSchema, req.body);
      await saveResumeEdits(userOf(req).id, body);
      res.json(await profilePayload(userOf(req).id));
    }),
  );

  // The owner's resume: a short-lived signed Cloudinary URL (or streamed in mock mode).
  r.get(
    "/resume/file",
    h(async (req, res) => {
      const row = await queryOne<{ resume_public_id: string | null; resume_file_name: string | null }>(
        "SELECT resume_public_id, resume_file_name FROM profiles WHERE user_id = ?",
        [userOf(req).id],
      );
      if (!row?.resume_public_id) throw new HttpError(404, "No resume uploaded yet.");
      const store = storage();
      const url = await store.signedUrl(row.resume_public_id, row.resume_file_name ?? "resume.pdf");
      res.setHeader("Cache-Control", "no-store");
      if (url && !config().mockExternal) {
        res.redirect(302, url);
        return;
      }
      const buf = await store.download(row.resume_public_id);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${(row.resume_file_name ?? "resume.pdf").replace(/[^\x20-\x7e]|"/g, "_")}"`);
      res.send(buf);
    }),
  );

  r.put(
    "/preferences",
    h(async (req, res) => {
      const body = parse(preferencesSchema, req.body);
      const userId = userOf(req).id;
      const current = await loadProfile(userId);
      const timeChanged = !current || current.runTime !== body.run_time;
      await execute(
        `INSERT INTO profiles (user_id, target_roles, locations, expected_salary_lpa, run_time, run_time_changed_at)
         VALUES (?, CAST(? AS JSON), CAST(? AS JSON), ?, ?, ?)
         ON DUPLICATE KEY UPDATE target_roles = VALUES(target_roles), locations = VALUES(locations),
           expected_salary_lpa = VALUES(expected_salary_lpa), run_time = VALUES(run_time),
           run_time_changed_at = IF(?, VALUES(run_time_changed_at), run_time_changed_at)`,
        [userId, JSON.stringify(body.target_roles), JSON.stringify(body.locations), body.expected_salary_lpa, `${body.run_time}:00`, clock.now(), timeChanged],
      );
      if (body.excluded_companies) await saveExclusions(userId, body.excluded_companies);
      res.json(await profilePayload(userId));
    }),
  );

  /**
   * "Next run" hint while the user edits the time, computed by the scheduler's
   * own function. Saving a new time (or turning automation on) counts as a
   * change made now, so it never triggers an immediate run.
   */
  r.get(
    "/next-run",
    h(async (req, res) => {
      const { run_time } = parse(z.object({ run_time: runTimeSchema }), req.query);
      const userId = userOf(req).id;
      const p = await loadProfile(userId);
      const now = clock.now();
      const changes = !p || p.runTime !== normalizeRunTime(run_time) || !p.automationEnabled;
      const at = nextRunAt({
        now,
        runTime: run_time,
        automationEnabled: true,
        slotRanToday: await hasScheduledRunAt(userId, istDate(now), normalizeRunTime(run_time)),
        settingsChangedAt: changes ? now : p ? settingsChangedAt(p) : null,
      });
      res.json({ at, automationEnabled: !!p?.automationEnabled });
    }),
  );

  return r;
}

export function automationRouter() {
  const r = Router();
  r.use(requireAuth);
  r.put(
    "/",
    h(async (req, res) => {
      const { enabled } = parse(z.object({ enabled: z.boolean() }), req.body);
      await setAutomation(userOf(req).id, enabled);
      res.json(await profilePayload(userOf(req).id));
    }),
  );
  // Sending mode: only while automation is ON (the saved value is kept while it's OFF).
  r.put(
    "/send-mode",
    h(async (req, res) => {
      const { mode } = parse(z.object({ mode: z.enum(SEND_MODE_VALUES as [SendMode, ...SendMode[]], { error: "Choose a sending mode." }) }), req.body);
      await setSendMode(userOf(req).id, mode);
      res.json(await profilePayload(userOf(req).id));
    }),
  );
  return r;
}
