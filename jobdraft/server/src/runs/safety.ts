import type { JobCheck, ResumeData } from "../ai/schemas.js";
import type { Job } from "../jobs/types.js";
import { verifyApplicationEmail } from "../matching/emails.js";
import { findExcluded, type ExcludedCompany } from "../matching/exclusions.js";
import { asksExpectedCtc } from "../matching/parse.js";
import { companyCoreName, wordCount } from "../matching/text.js";

export type DraftDecision =
  | { kind: "draft"; to: string; subject: string; body: string; confidence: number }
  | { kind: "link_only"; reason: string }
  | { kind: "skip"; reason: string };

const PLACEHOLDER_RE = /[[\]{}<>]/;
const SALARY_SENTENCE_RE = /\b(ctc|salary|compensation|lpa|lakhs?|notice period|package)\b/i;
const SIGNOFF_RE = /\n\s*(regards|best regards|kind regards|warm regards|sincerely|yours sincerely|yours faithfully|thanks and regards|thanks & regards|best|cheers)[,!.]?\s*(\n[\s\S]*)?$/i;
const HYPE_RE = /\b(rock ?star|ninja|guru|wizard|world[- ]class|game[- ]changer|unicorn|superstar|10x|best[- ]in[- ]class|crushing it|synerg(y|ies)|disruptive|revolutionary)\b/i;
const EMOJI_RE = /\p{Extended_Pictographic}/u;
const NO_PRESSURE_RE = /\b(haven'?t heard back|still waiting|as i said|just checking again|kindly respond|urgent(ly)?|asap)\b/i;

const clean = (s: string) => s.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

/** Signature built in code from the extracted resume, never from the model. */
export function buildSignature(resume: ResumeData): string {
  const lines = ["Regards,", resume.full_name, resume.phone, resume.email, resume.linkedin].map((l) => l.trim()).filter(Boolean);
  return lines.join("\n");
}

function removeSalarySentences(body: string): string {
  return body
    .split("\n")
    .map((para) =>
      para
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => !SALARY_SENTENCE_RE.test(sentence))
        .join(" "),
    )
    .join("\n");
}

function mentionsTitle(body: string, title: string): boolean {
  const b = body.toLowerCase();
  const t = title.toLowerCase().trim();
  if (b.includes(t)) return true;
  // "React Developer (Remote)" / "Backend Engineer - Payments" → core title is enough.
  const core = t.replace(/\(.*?\)/g, "").split(/\s+[-–|]\s+/)[0]!.trim();
  return core.length > 2 && b.includes(core);
}

/** Claims like "8 years of experience" must not exceed the computed experience. */
function overstatesExperience(body: string, years: number): boolean {
  for (const m of body.matchAll(/(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)/gi)) {
    if (Number(m[1]) > Math.ceil(years) + 0.01) return true;
  }
  return false;
}

/** Hype words, emojis or SHOUTING. Acronyms from the resume's skills (AWS, MySQL) are fine. */
export function styleProblem(text: string, allowedWords: string[] = []): string | null {
  if (EMOJI_RE.test(text)) return "emoji";
  if (HYPE_RE.test(text)) return "hype words";
  const allowed = new Set(allowedWords.flatMap((w) => w.toUpperCase().split(/[^A-Z0-9]+/)));
  for (const word of text.match(/\b[A-Z]{5,}\b/g) ?? []) if (!allowed.has(word)) return "ALL CAPS";
  if (/!{2,}/.test(text)) return "exclamation marks";
  return null;
}

export interface DecideArgs {
  check: JobCheck;
  job: Job;
  resume: ResumeData;
  expectedSalaryLpa: number;
  experienceYears: number;
  excluded: ExcludedCompany[];
}

/**
 * Hard checks applied regardless of what the model said. A suitable job that
 * fails any check becomes "link_only" (the user can apply via the link).
 * Postings from excluded companies (past/current employers) are skipped entirely.
 */
export function decideDraft(args: DecideArgs): DraftDecision {
  const { check, job, resume, expectedSalaryLpa, experienceYears, excluded } = args;
  const ex = findExcluded({ company: job.company, realEmployer: check.real_employer_name, email: check.application_email, url: job.url }, excluded);
  if (ex) return { kind: "skip", reason: `excluded company (${ex.company})` };
  if (!check.suitable) return { kind: "skip", reason: "not suitable" };
  if (check.scam_or_spam_signals) return { kind: "skip", reason: "scam or spam signals" };
  if (check.is_staffing_agency) return { kind: "skip", reason: "staffing agency" };

  const postingText = `${job.title}\n${job.company}\n${job.description}`;
  const email = verifyApplicationEmail(check.application_email, postingText);
  if (!email.ok) return { kind: "link_only", reason: email.reason };

  const subject = check.subject.replace(/[\r\n]+/g, " ").trim();
  if (!subject) return { kind: "link_only", reason: "empty subject" };
  if (PLACEHOLDER_RE.test(subject)) return { kind: "link_only", reason: "placeholder in subject" };

  let body = clean(check.body).replace(SIGNOFF_RE, "");
  if (PLACEHOLDER_RE.test(body)) return { kind: "link_only", reason: "placeholder in body" };
  body = clean(removeSalarySentences(body));
  if (!/^(dear|hello|hi)\b/i.test(body)) body = `Dear Hiring Team,\n\n${body}`;

  const company = companyCoreName(job.company).toLowerCase();
  if (!body.toLowerCase().includes(company)) return { kind: "link_only", reason: "body does not name the company" };
  if (!mentionsTitle(body, job.title)) return { kind: "link_only", reason: "body does not name the role" };
  const words = wordCount(body);
  if (words < 90 || words > 230) return { kind: "link_only", reason: `body length ${words} words` };
  if (overstatesExperience(body, experienceYears)) return { kind: "link_only", reason: "overstated experience" };
  const style = styleProblem(`${subject}\n${body}`, [...resume.skills, job.title, job.company]);
  if (style) return { kind: "link_only", reason: `style: ${style}` };

  if (asksExpectedCtc(postingText) && expectedSalaryLpa > 0) {
    body += `\n\nAs requested, my expected CTC is ${formatLpa(expectedSalaryLpa)} LPA.`;
  }
  body += `\n\n${buildSignature(resume)}`;
  return { kind: "draft", to: email.email, subject: subject.slice(0, 200), body, confidence: check.confidence };
}

function formatLpa(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

/** Fixed anti-spam sending policy (not configurable). */
export const SEND_POLICY = {
  autoSendMinConfidence: 85,
  maxAutoSendsPerRun: 5,
  maxAutoSendsPerDay: 8,
  cancelWindowMinutes: 30,
  minGapMinutes: 2,
  maxGapMinutes: 4,
  maxSendAttempts: 3,
  retryGapMinutes: 15,
  pauseHoursOnRateLimit: 24,
  maxNewEmailsPerRun: 10,
  maxLinkOnlyPerRun: 15,
};

export interface AutoSendInput {
  confidence: number;
  scam: boolean;
  agency: boolean;
  automationOn: boolean;
  gmailConnected: boolean;
  autoSendsThisRun: number;
  autoSendsToday: number;
}

/** An item is auto-sent only if it is a strong match and every limit allows it; otherwise it stays a draft. */
export function classifyAutoSend(i: AutoSendInput): "auto_send" | "draft" {
  if (i.confidence < SEND_POLICY.autoSendMinConfidence || i.scam || i.agency) return "draft";
  if (!i.automationOn || !i.gmailConnected) return "draft";
  if (i.autoSendsThisRun >= SEND_POLICY.maxAutoSendsPerRun || i.autoSendsToday >= SEND_POLICY.maxAutoSendsPerDay) return "draft";
  return "auto_send";
}

/** Word limits for follow-ups (spec range, with a small tolerance for the model). */
export const FOLLOWUP_WORDS: Record<1 | 2, [number, number]> = { 1: [50, 105], 2: [32, 85] };

/** Same fact/style rules as first emails, plus "no pressure". Returns the body with the code-built signature, or a problem. */
export function prepareFollowUpBody(args: { body: string; sequence: 1 | 2; company: string; jobTitle: string; resume: ResumeData }): { ok: true; body: string } | { ok: false; reason: string } {
  let body = clean(args.body).replace(SIGNOFF_RE, "");
  if (PLACEHOLDER_RE.test(body)) return { ok: false, reason: "placeholder" };
  body = clean(removeSalarySentences(body));
  if (!/^(dear|hello|hi)\b/i.test(body)) body = `Dear Hiring Team,\n\n${body}`;
  if (!body.toLowerCase().includes(companyCoreName(args.company).toLowerCase())) return { ok: false, reason: "company not named" };
  if (!mentionsTitle(body, args.jobTitle)) return { ok: false, reason: "role not named" };
  const [min, max] = FOLLOWUP_WORDS[args.sequence];
  const words = wordCount(body);
  if (words < min || words > max) return { ok: false, reason: `length ${words} words` };
  if (NO_PRESSURE_RE.test(body)) return { ok: false, reason: "pressure language" };
  const style = styleProblem(body, [...args.resume.skills, args.jobTitle, args.company]);
  if (style) return { ok: false, reason: `style: ${style}` };
  return { ok: true, body: `${body}\n\n${buildSignature(args.resume)}` };
}

/** Plain, factual fallback when the model's follow-up fails the checks twice. */
export function templateFollowUp(args: { sequence: 1 | 2; company: string; jobTitle: string; resume: ResumeData }): string {
  const strength = args.resume.skills.slice(0, 2).join(" and ");
  const title = args.resume.current_title;
  const text =
    args.sequence === 1
      ? `Dear Hiring Team,\n\nI am writing to follow up on my application for the ${args.jobTitle} role at ${args.company}, sent last week. I remain keen on the position${strength ? `, and my work with ${strength}` : ""}${title ? ` as ${/^[aeiou]/i.test(title) ? "an" : "a"} ${title}` : ""} fits the role well. Have you had a chance to review my application, or is there a next step I could prepare for? Thank you for your time.`
      : `Dear Hiring Team,\n\nI would like to close the loop on my application for the ${args.jobTitle} role at ${args.company}. I am still interested and happy to share anything else that would help. Thank you for your time and consideration.`;
  return `${text}\n\n${buildSignature(args.resume)}`;
}
