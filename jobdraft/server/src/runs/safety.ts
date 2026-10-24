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

/** Machine-sounding words with a plain swap that keeps the sentence grammatical. */
const PLAIN_WORDS: [RegExp, string][] = [
  [/\butili[sz](e|es|ed|ing)\b/gi, "us$1"],
  [/\bleverag(e|es|ed|ing)\b/gi, "us$1"],
  [/\bspearhead(ed|ing)?\b/gi, "led"],
  [/\bseamlessly\b/gi, "smoothly"],
  [/\bseamless\b/gi, "smooth"],
  [/\bcutting[- ]edge\b/gi, "modern"],
  [/\bmeticulous(ly)?\b/gi, "careful$1"],
  [/\b(a )?(plethora|myriad) of\b/gi, "many"],
  [/(^|[.!?]\s+|\n)(furthermore|moreover|additionally),\s*/gi, "$1Also, "],
];

/** Sentences that only show up in AI-written emails: dropped whole. */
const AI_SENTENCE_RE = /\b(hope (this|my) (email|message|note) finds you|delve|tapestry|testament to|i am thrilled|i'?m thrilled|in today'?s (fast[- ]paced|competitive|ever[- ]changing))/i;

/**
 * Makes the model's text read like a person typed it: no dashes used as
 * punctuation (a giveaway), straight quotes, plain words, no stock AI lines.
 * Hyphenated words (full-stack, Node.js-based) are left alone.
 */
export function humanize(text: string): string {
  let s = text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/(\d)(?:\s*[–—]\s*|[ \t]+-[ \t]+)(\d)/g, "$1 to $2")
    .replace(/[ \t]*[–—][ \t]*/g, ", ")
    .replace(/[ \t]+-[ \t]+/g, ", ")
    .replace(/;[ \t]*/g, ". ");
  for (const [re, plain] of PLAIN_WORDS) s = s.replace(re, plain);
  s = s
    .split("\n")
    .map((para) =>
      para
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => !AI_SENTENCE_RE.test(sentence))
        .join(" "),
    )
    .join("\n");
  return s
    .replace(/,\s*,/g, ",")
    .replace(/,\s*([.!?])/g, "$1")
    .replace(/([.!?] )([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase())
    .replace(/[ \t]{2,}/g, " ");
}

/**
 * Greeting on its own line, then the text. Models sometimes return everything
 * as one block; then the closing line ("My resume is attached…", "Thanks…")
 * also gets its own paragraph so it reads like a normal email.
 */
export function layoutEmail(body: string): string {
  let b = body.trim();
  const greeting = /^((?:dear|hello|hi)\b[^,\n]{0,80},)[ \t]*(?=\S)/i.exec(b);
  if (greeting) b = `${greeting[1]}\n\n${b.slice(greeting[0].length)}`;
  else if (!/^(dear|hello|hi)\b/i.test(b)) b = `Dear Hiring Team,\n\n${b}`;
  const [head, ...rest] = b.split(/\n\n+/);
  if (rest.length === 1 && !rest[0]!.includes("\n")) {
    const closing = /\s+((?:my resume is attached|i have attached|i've attached|thanks|thank you|happy to (?:talk|chat|share))\b[\s\S]*)$/i.exec(rest[0]!);
    if (closing && closing.index > 0) b = `${head}\n\n${rest[0]!.slice(0, closing.index).trim()}\n\n${closing[1]!.trim()}`;
  }
  return b;
}

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

  const subject = humanize(check.subject.replace(/[\r\n]+/g, " "))
    .replace(/\s*\|\s*/g, ", ")
    .replace(/[\s.,]+$/, "")
    .trim();
  if (!subject) return { kind: "link_only", reason: "empty subject" };
  if (PLACEHOLDER_RE.test(subject)) return { kind: "link_only", reason: "placeholder in subject" };

  let body = clean(humanize(check.body)).replace(SIGNOFF_RE, "");
  if (PLACEHOLDER_RE.test(body)) return { kind: "link_only", reason: "placeholder in body" };
  body = clean(removeSalarySentences(body));
  body = layoutEmail(body);

  const company = companyCoreName(job.company).toLowerCase();
  if (!body.toLowerCase().includes(company)) return { kind: "link_only", reason: "body does not name the company" };
  if (!mentionsTitle(body, job.title)) return { kind: "link_only", reason: "body does not name the role" };
  const words = wordCount(body);
  if (words < 55 || words > 190) return { kind: "link_only", reason: `body length ${words} words` };
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

/** Fixed anti-spam sending policy, the same in every sending mode. */
export const SEND_POLICY = {
  /** Smart send's thresholds (kept here for older callers; see SEND_MODES). */
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

/** The user's sending mode (profiles.send_mode). Only applies while automation is ON. */
export type SendMode = "drafts_only" | "smart" | "send_all" | "send_all_instant";
export const SEND_MODE_VALUES: SendMode[] = ["drafts_only", "smart", "send_all", "send_all_instant"];
export const DEFAULT_SEND_MODE: SendMode = "smart";
/** Reason recorded when a send is stopped because the user switched to drafts only. */
export const DRAFTS_ONLY_REASON = "mode changed to drafts only";

export interface SendModePolicy {
  /** Anything auto-sent at all? */
  autoSend: boolean;
  /** Minimum confidence to auto-send (0 = every suitable, safe email). */
  minConfidence: number;
  maxAutoSendsPerRun: number;
  /** Per user per IST day; items beyond it stay drafts. */
  maxAutoSendsPerDay: number;
  /** Minutes to cancel before an auto-send (and an auto follow-up) goes out. */
  cancelWindowMinutes: number;
}

export const SEND_MODES: Record<SendMode, SendModePolicy> = {
  drafts_only: { autoSend: false, minConfidence: 101, maxAutoSendsPerRun: 0, maxAutoSendsPerDay: 0, cancelWindowMinutes: 30 },
  smart: { autoSend: true, minConfidence: 85, maxAutoSendsPerRun: 5, maxAutoSendsPerDay: 8, cancelWindowMinutes: 30 },
  send_all: { autoSend: true, minConfidence: 0, maxAutoSendsPerRun: SEND_POLICY.maxNewEmailsPerRun, maxAutoSendsPerDay: 15, cancelWindowMinutes: 30 },
  send_all_instant: { autoSend: true, minConfidence: 0, maxAutoSendsPerRun: SEND_POLICY.maxNewEmailsPerRun, maxAutoSendsPerDay: 15, cancelWindowMinutes: 0 },
};

export interface AutoSendInput {
  confidence: number;
  scam: boolean;
  agency: boolean;
  automationOn: boolean;
  gmailConnected: boolean;
  autoSendsThisRun: number;
  autoSendsToday: number;
  /** Defaults to smart send. */
  mode?: SendMode;
}

/**
 * Whether an email that passed every hard check is auto-sent or kept as a draft.
 * In every mode: never for scam- or agency-flagged items, never while automation
 * is off or Gmail is unusable, and never beyond the mode's daily/run caps.
 */
export function classifyAutoSend(i: AutoSendInput): "auto_send" | "draft" {
  const policy = SEND_MODES[i.mode ?? DEFAULT_SEND_MODE];
  if (!policy.autoSend || i.scam || i.agency) return "draft";
  if (i.confidence < policy.minConfidence) return "draft";
  if (!i.automationOn || !i.gmailConnected) return "draft";
  if (i.autoSendsThisRun >= policy.maxAutoSendsPerRun || i.autoSendsToday >= policy.maxAutoSendsPerDay) return "draft";
  return "auto_send";
}

/** Word limits for follow-ups (spec range, with a small tolerance for the model). */
export const FOLLOWUP_WORDS: Record<1 | 2, [number, number]> = { 1: [50, 105], 2: [32, 85] };

/** Same fact/style rules as first emails, plus "no pressure". Returns the body with the code-built signature, or a problem. */
export function prepareFollowUpBody(args: { body: string; sequence: 1 | 2; company: string; jobTitle: string; resume: ResumeData }): { ok: true; body: string } | { ok: false; reason: string } {
  let body = clean(humanize(args.body)).replace(SIGNOFF_RE, "");
  if (PLACEHOLDER_RE.test(body)) return { ok: false, reason: "placeholder" };
  body = clean(removeSalarySentences(body));
  body = layoutEmail(body);
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
      ? `Dear Hiring Team,\n\nI applied for the ${args.jobTitle} role at ${args.company} last week and wanted to check if you had a chance to look at my application. I'm still very interested${strength ? `, and my work with ${strength}${title ? ` as ${/^[aeiou]/i.test(title) ? "an" : "a"} ${title}` : ""} is a good fit for the role` : ""}. Is there a next step I can prepare for? Thanks for your time.`
      : `Dear Hiring Team,\n\nI'm writing one last time about my application for the ${args.jobTitle} role at ${args.company}. I'm still interested and happy to share anything else that helps. Thanks for your time and consideration.`;
  return `${text}\n\n${buildSignature(args.resume)}`;
}
