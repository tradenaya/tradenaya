const EMAIL_RE = /[A-Za-z0-9](?:[A-Za-z0-9._%+-]{0,62}[A-Za-z0-9_%+-])?@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}/g;
const STRICT_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._%+-]{0,62}[A-Za-z0-9_%+-])?@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}$/;

/** Every distinct email address in the text, lowercased, in order of appearance. */
export function extractEmails(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(EMAIL_RE)) {
    const email = m[0].toLowerCase();
    if (!out.includes(email)) out.push(email);
  }
  return out;
}

export function isValidEmailFormat(email: string): boolean {
  return email.length <= 254 && STRICT_RE.test(email) && !email.includes("..");
}

const BLOCKED_LOCAL = /^(no-?reply|do-?not-?reply|donotreply|noreply\d*|mailer-daemon|postmaster|bounce|bounces|test|testing|example|sample|user|someone|email|abc|xyz)$/i;
const BLOCKED_DOMAIN = /(^|\.)(example\.(com|org|net|in)|example|test|invalid|localhost|local|domain\.com|email\.com|yourcompany\.com|company\.com|test\.com)$/i;

/** noreply / example / test addresses — never draft to these. */
export function isDisallowedEmail(email: string): boolean {
  const [local = "", domain = ""] = email.toLowerCase().split("@");
  if (BLOCKED_LOCAL.test(local) || local.includes("noreply") || local.includes("no-reply")) return true;
  if (BLOCKED_DOMAIN.test(domain) || domain.split(".").includes("example") || domain.split(".").includes("test")) return true;
  return false;
}

export type EmailCheck = { ok: true; email: string } | { ok: false; reason: string };

/** The model's email must appear verbatim in the posting and be a real, reply-able address. */
export function verifyApplicationEmail(candidate: string | null | undefined, postingText: string): EmailCheck {
  const email = (candidate ?? "").trim().toLowerCase();
  if (!email) return { ok: false, reason: "no application email in posting" };
  if (!isValidEmailFormat(email)) return { ok: false, reason: "invalid email format" };
  if (isDisallowedEmail(email)) return { ok: false, reason: "noreply/example/test address" };
  if (!extractEmails(postingText).includes(email)) return { ok: false, reason: "email not found verbatim in posting" };
  return { ok: true, email };
}
