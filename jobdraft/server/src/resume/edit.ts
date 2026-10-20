import { z } from "zod";
import { resumeDataSchema, type ResumeData } from "../ai/schemas.js";
import { execute } from "../db/pool.js";
import { HttpError } from "../lib/errors.js";
import { exclusionKey } from "../matching/exclusions.js";
import { loadProfile, resumeCompanies } from "../runs/profile.js";
import { computeExperienceYears, parseResumeDate } from "./experience.js";

const text = (max: number, what: string) => z.string().trim().max(max, `${what} is too long.`);
const date = (what: string) =>
  text(40, what).refine((v) => !v || parseResumeDate(v) !== null, "Use a date like 2024-06, Jun 2024 or 2024.");

/** What the user can correct after the AI read the resume. Projects and role suggestions are kept as read. */
export const resumeEditSchema = z.object({
  full_name: text(120, "Name").min(1, "Enter your name."),
  email: text(254, "Email").refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email address."),
  phone: text(40, "Phone").refine((v) => !v || /^[+\d][\d\s()-]{5,}$/.test(v), "Enter a valid phone number."),
  linkedin: text(300, "LinkedIn").refine((v) => !v || /^(https?:\/\/)?([\w-]+\.)?linkedin\.com\//i.test(v), "Enter a LinkedIn profile link."),
  location: text(150, "Location"),
  current_title: text(150, "Current title"),
  roles: z
    .array(
      z
        .object({
          title: text(150, "Job title").min(1, "Enter the job title."),
          company: text(150, "Company"),
          start: date("Start date"),
          end: date("End date"),
          is_current: z.boolean(),
          bullets: z.array(text(500, "Highlight")).max(15, "Up to 15 highlights per role."),
        })
        .transform((r) => ({ ...r, end: r.is_current ? "Present" : r.end, bullets: r.bullets.filter(Boolean) })),
    )
    .max(25, "Up to 25 roles."),
  skills: z
    .array(text(80, "Skill").min(1))
    .max(80, "Up to 80 skills.")
    .refine((a) => new Set(a.map((s) => s.toLowerCase())).size === a.length, "Skills must be different."),
  education: z
    .array(z.object({ degree: text(200, "Degree"), institution: text(200, "Institution"), year: text(40, "Year") }))
    .max(10, "Up to 10 entries.")
    .transform((a) => a.filter((e) => e.degree || e.institution || e.year)),
});

export type ResumeEdit = z.infer<typeof resumeEditSchema>;

/** The full editable data (the profile summary only carries the first few roles and skills). */
export function editableResume(data: ResumeData): ResumeEdit {
  const { full_name, email, phone, linkedin, location, current_title, roles, skills, education } = data;
  return { full_name, email, phone, linkedin, location, current_title, roles, skills, education };
}

/**
 * Saves the user's corrections, recomputes total experience from the role
 * dates, and keeps "companies to skip" in step: companies removed from the
 * roles are dropped from the resume-sourced skip list, new ones are added,
 * unchanged ones are left alone (so a company the user removed stays removed).
 */
export async function saveResumeEdits(userId: number, edit: ResumeEdit): Promise<void> {
  const profile = await loadProfile(userId);
  if (!profile?.resume || !profile.resumePublicId) throw new HttpError(404, "Upload your resume first.");
  const before = profile.resume;
  const next = resumeDataSchema.parse({ ...before, ...edit });
  const years = computeExperienceYears(next.roles);
  await execute("UPDATE profiles SET resume_data = CAST(? AS JSON), total_experience_years = ? WHERE user_id = ?", [JSON.stringify(next), years, userId]);

  const oldKeys = new Set(resumeCompanies(before).map(exclusionKey));
  const newCompanies = resumeCompanies(next);
  const newKeys = new Set(newCompanies.map(exclusionKey));
  for (const key of oldKeys) {
    if (!newKeys.has(key)) await execute("DELETE FROM excluded_companies WHERE user_id = ? AND source = 'resume' AND company_key = ?", [userId, key]);
  }
  for (const name of newCompanies) {
    const key = exclusionKey(name);
    if (!oldKeys.has(key)) {
      await execute("INSERT IGNORE INTO excluded_companies (user_id, company_name, company_key, source) VALUES (?, ?, ?, 'resume')", [userId, name.slice(0, 255), key]);
    }
  }
}
