import type { ResumeData } from "../ai/schemas.js";
import { config } from "../config/env.js";
import { execute, json, query, queryOne } from "../db/pool.js";
import { REQUIRED_SCOPES } from "../gmail/types.js";
import { clock } from "../lib/clock.js";
import { decrypt } from "../lib/crypto.js";
import { istDate, istInstant, nextRunAt, normalizeRunTime } from "../lib/time.js";
import { exclusionKey, type ExcludedCompany } from "../matching/exclusions.js";
import { DEFAULT_SEND_MODE, type SendMode } from "./safety.js";

export type GmailStatus = "connected" | "disconnected" | "error" | "needs_reconnect";

export interface RunnableProfile {
  userId: number;
  /** An admin can deactivate an account: no runs, sends or follow-ups. */
  userStatus: "active" | "inactive";
  resume: ResumeData | null;
  resumePublicId: string | null;
  resumeFileName: string;
  experienceYears: number;
  targetRoles: string[];
  locations: string[];
  expectedSalaryLpa: number | null;
  runTime: string;
  runTimeChangedAt: Date | null;
  automationEnabled: boolean;
  automationChangedAt: Date | null;
  /** Only applies while automation is ON. */
  sendMode: SendMode;
  sendModeChangedAt: Date | null;
  /** The user's own Gemini API key, encrypted (see ai/user-key.ts). */
  geminiKeyEnc: string | null;
  geminiKeyHint: string | null;
  geminiKeyStatus: "valid" | "invalid" | null;
  geminiKeyUpdatedAt: Date | null;
  gmailAddress: string | null;
  gmailStatus: GmailStatus | null;
  grantedScopes: string[];
  refreshTokenEnc: string | null;
  sendPausedUntil: Date | null;
}

interface Row {
  user_id: number;
  user_status: "active" | "inactive" | null;
  resume_public_id: string | null;
  resume_file_name: string | null;
  resume_data: unknown;
  total_experience_years: string | number | null;
  target_roles: unknown;
  locations: unknown;
  expected_salary_lpa: string | number | null;
  run_time: string | null;
  run_time_changed_at: Date | null;
  automation_enabled: number;
  automation_changed_at: Date | null;
  send_mode: SendMode | null;
  send_mode_changed_at: Date | null;
  gemini_key_enc: string | null;
  gemini_key_hint: string | null;
  gemini_key_status: "valid" | "invalid" | null;
  gemini_key_updated_at: Date | null;
  gmail_address: string | null;
  gmail_status: GmailStatus | null;
  granted_scopes: string | null;
  refresh_token_enc: string | null;
  send_paused_until: Date | null;
}

const SELECT = `
  SELECT p.*, u.status AS user_status, g.gmail_address, g.status AS gmail_status, g.granted_scopes, g.refresh_token_enc, g.send_paused_until
  FROM profiles p
  JOIN users u ON u.id = p.user_id
  LEFT JOIN gmail_connections g ON g.user_id = p.user_id`;

function toProfile(row: Row): RunnableProfile {
  return {
    userId: row.user_id,
    userStatus: row.user_status ?? "active",
    resume: json<ResumeData | null>(row.resume_data, null),
    resumePublicId: row.resume_public_id,
    resumeFileName: row.resume_file_name || "resume.pdf",
    experienceYears: Number(row.total_experience_years ?? 0),
    targetRoles: json<string[]>(row.target_roles, []),
    locations: json<string[]>(row.locations, []),
    expectedSalaryLpa: row.expected_salary_lpa === null ? null : Number(row.expected_salary_lpa),
    runTime: normalizeRunTime(row.run_time),
    runTimeChangedAt: row.run_time_changed_at,
    automationEnabled: !!row.automation_enabled,
    automationChangedAt: row.automation_changed_at,
    sendMode: row.send_mode ?? DEFAULT_SEND_MODE,
    sendModeChangedAt: row.send_mode_changed_at,
    geminiKeyEnc: row.gemini_key_enc,
    geminiKeyHint: row.gemini_key_hint,
    geminiKeyStatus: row.gemini_key_status,
    geminiKeyUpdatedAt: row.gemini_key_updated_at,
    gmailAddress: row.gmail_address,
    gmailStatus: row.gmail_status,
    grantedScopes: (row.granted_scopes ?? "").split(" ").filter(Boolean),
    refreshTokenEnc: row.refresh_token_enc,
    sendPausedUntil: row.send_paused_until,
  };
}

export async function loadProfile(userId: number): Promise<RunnableProfile | null> {
  const row = await queryOne<Row>(`${SELECT} WHERE p.user_id = ?`, [userId]);
  return row ? toProfile(row) : null;
}

/**
 * Every profile with automation ON, whatever the Gmail state. The scheduler
 * starts from this list so a user whose Gmail broke is reported (a "couldn't
 * run" card in History), never silently skipped.
 */
export async function automationOnProfiles(): Promise<RunnableProfile[]> {
  const rows = await query<Row>(`${SELECT} WHERE p.automation_enabled = 1 AND u.status = 'active' ORDER BY p.user_id`);
  return rows.map(toProfile);
}

/** Profiles with automation ON and a usable Gmail connection. */
export async function automationProfiles(): Promise<RunnableProfile[]> {
  const rows = await query<Row>(`${SELECT} WHERE p.automation_enabled = 1 AND u.status = 'active' AND g.status = 'connected' AND g.refresh_token_enc IS NOT NULL ORDER BY p.user_id`);
  return rows.map(toProfile);
}

export function hasAllScopes(p: Pick<RunnableProfile, "grantedScopes">): boolean {
  return REQUIRED_SCOPES.every((s) => p.grantedScopes.includes(s));
}

export function gmailUsable(p: Pick<RunnableProfile, "gmailStatus" | "refreshTokenEnc" | "grantedScopes" | "gmailAddress">): boolean {
  return p.gmailStatus === "connected" && !!p.refreshTokenEnc && !!p.gmailAddress && hasAllScopes(p);
}

/** What still blocks automation (empty = can be turned on). */
export function missingForAutomation(p: RunnableProfile | null): string[] {
  const missing: string[] = [];
  if (!p?.geminiKeyEnc) missing.push("Add your Gemini API key");
  else if (p.geminiKeyStatus === "invalid") missing.push("Update your Gemini API key (Google rejected it)");
  if (!p?.resume || !p.resumePublicId) missing.push("Upload your resume");
  if (!p?.targetRoles.length) missing.push("Choose target roles");
  if (!p?.locations.length) missing.push("Pick locations");
  if (p?.expectedSalaryLpa == null) missing.push("Set your expected salary");
  if (!p?.runTime) missing.push("Set a daily run time");
  if (p?.gmailStatus === "needs_reconnect" || (p?.gmailStatus === "connected" && !hasAllScopes(p))) missing.push("Reconnect Gmail and allow all permissions");
  else if (p?.gmailStatus === "error") missing.push("Reconnect Gmail (access expired)");
  else if (!p || p.gmailStatus !== "connected" || !p.refreshTokenEnc) missing.push("Connect Gmail");
  return missing;
}

export function refreshTokenOf(profile: { refreshTokenEnc: string | null }): string | null {
  if (!profile.refreshTokenEnc) return null;
  return decrypt(profile.refreshTokenEnc, config().encryptionKey());
}

/** A scheduled run already happened on this IST date at this run time (each time slot runs at most once a day). */
export async function hasScheduledRunAt(userId: number, runDate: string, runTime: string): Promise<boolean> {
  return !!(await queryOne("SELECT id FROM runs WHERE user_id = ? AND `trigger` = 'scheduled' AND run_date = ? AND scheduled_for = ?", [
    userId,
    runDate,
    istInstant(runDate, runTime),
  ]));
}

export function settingsChangedAt(p: Pick<RunnableProfile, "runTimeChangedAt" | "automationChangedAt">): Date | null {
  const times = [p.runTimeChangedAt, p.automationChangedAt].filter((d): d is Date => !!d).map((d) => new Date(d).getTime());
  return times.length ? new Date(Math.max(...times)) : null;
}

/** Next scheduled run for this user — the same function the scheduler uses. */
export async function nextRunFor(p: RunnableProfile, now = clock.now()): Promise<Date | null> {
  return nextRunAt({
    now,
    runTime: p.runTime,
    automationEnabled: p.automationEnabled,
    slotRanToday: await hasScheduledRunAt(p.userId, istDate(now), p.runTime),
    settingsChangedAt: settingsChangedAt(p),
  });
}

// ── excluded companies ─────────────────────────────────────────────────────

export interface ExcludedRow extends ExcludedCompany {
  id: number;
  source: "resume" | "manual";
}

export async function listExcluded(userId: number): Promise<ExcludedRow[]> {
  return query<ExcludedRow>("SELECT id, company_name, company_key, source FROM excluded_companies WHERE user_id = ? ORDER BY source DESC, company_name", [userId]);
}

/** Every employer on the resume (including internships and the current one). */
export function resumeCompanies(resume: ResumeData): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of resume.roles) {
    const name = r.company.trim();
    const key = exclusionKey(name);
    if (name && key && !seen.has(key)) {
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

/** Replace the resume-sourced exclusions; manual ones are kept (and win on duplicates). */
export async function replaceResumeExclusions(userId: number, companies: string[]): Promise<void> {
  await execute("DELETE FROM excluded_companies WHERE user_id = ? AND source = 'resume'", [userId]);
  for (const name of companies) {
    await execute("INSERT IGNORE INTO excluded_companies (user_id, company_name, company_key, source) VALUES (?, ?, ?, 'resume')", [
      userId,
      name.slice(0, 255),
      exclusionKey(name),
    ]);
  }
}

/**
 * Save the "Companies to skip" list from Setup: anything not in the list is
 * removed (the UI confirms before removing a resume one); new names are manual.
 */
export async function saveExclusions(userId: number, names: string[]): Promise<void> {
  const wanted = new Map<string, string>();
  for (const n of names) {
    const key = exclusionKey(n);
    if (key && !wanted.has(key)) wanted.set(key, n.trim());
  }
  const existing = await listExcluded(userId);
  for (const row of existing) if (!wanted.has(row.company_key)) await execute("DELETE FROM excluded_companies WHERE id = ?", [row.id]);
  const have = new Set(existing.map((r) => r.company_key));
  for (const [key, name] of wanted) {
    if (!have.has(key)) {
      await execute("INSERT IGNORE INTO excluded_companies (user_id, company_name, company_key, source) VALUES (?, ?, ?, 'manual')", [userId, name.slice(0, 255), key]);
    }
  }
}
