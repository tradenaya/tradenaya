import { normalize } from "./text.js";

// Words that describe level, not the job itself — ignored when matching titles.
const LEVEL_WORDS = new Set([
  "senior", "sr", "junior", "jr", "lead", "principal", "staff", "associate", "assistant", "trainee", "intern",
  "internship", "fresher", "entry", "level", "mid", "i", "ii", "iii", "iv", "1", "2", "3", "head", "chief",
]);
const STOP_WORDS = new Set(["and", "or", "the", "a", "an", "of", "for", "in", "at", "with", "to", "-", "/", "&", "+"]);

// Spelling variants and near-synonyms collapse to one canonical token.
const CANON: Record<string, string> = {
  developer: "dev", engineer: "dev", programmer: "dev", engg: "dev", eng: "dev", sde: "dev", swe: "dev", coder: "dev",
  development: "dev", engineering: "dev",
  mgr: "manager", manager: "manager", management: "manager",
  frontend: "frontend", "front-end": "frontend", ui: "frontend",
  backend: "backend", "back-end": "backend",
  fullstack: "fullstack", "full-stack": "fullstack",
  "react.js": "react", reactjs: "react", "node.js": "node", nodejs: "node", node: "node",
  "vue.js": "vue", vuejs: "vue", "next.js": "next", nextjs: "next", js: "javascript", ts: "typescript",
  golang: "go", "c#": "csharp", net: "dotnet", dotnet: "dotnet",
  analyst: "analyst", analytics: "analyst", analysis: "analyst",
  ml: "machinelearning", ai: "ai", qa: "qa", tester: "qa", testing: "qa", sdet: "qa",
  devops: "devops", sre: "devops", hr: "hr", ux: "ux", designer: "designer", design: "designer",
  admin: "administrator", administrator: "administrator", exec: "executive", executive: "executive",
  mktg: "marketing", marketing: "marketing", sales: "sales", bd: "businessdevelopment",
};

// Multi-word phrases joined before tokenising.
const PHRASES: [RegExp, string][] = [
  [/\bfront\s*end\b/g, "frontend"],
  [/\bback\s*end\b/g, "backend"],
  [/\bfull\s*stack\b/g, "fullstack"],
  [/\bmachine learning\b/g, "machinelearning"],
  [/\bdata science\b/g, "datascience"],
  [/\bdata scientist\b/g, "datascience"],
  [/\bproduct owner\b/g, "product manager"],
  [/\bbusiness development\b/g, "businessdevelopment"],
  [/\bsoftware development engineer\b/g, "software dev"],
  [/\bweb developer\b/g, "web dev"],
  [/\bvice president\b/g, "vp"],
  [/\bentry level\b/g, "entry"],
];

export function titleTokens(title: string): string[] {
  let t = normalize(title).replace(/\(.*?\)/g, " ");
  for (const [re, rep] of PHRASES) t = t.replace(re, rep);
  const out: string[] = [];
  for (const raw of t.split(/[\s/,|]+/)) {
    const word = raw.replace(/^[.]+|[.]+$/g, "");
    if (!word || STOP_WORDS.has(word) || LEVEL_WORDS.has(word)) continue;
    const canon = CANON[word] ?? word;
    if (!out.includes(canon)) out.push(canon);
  }
  return out;
}

// Generic role words: matching only these isn't enough ("Sales Manager" ≠ "Product Manager").
const GENERIC = new Set(["dev", "manager", "executive", "specialist", "officer", "consultant", "analyst", "designer", "administrator"]);

/** Fuzzy, token-based match of a posting title against one target role. */
export function titleMatchesRole(jobTitle: string, role: string): boolean {
  const want = titleTokens(role);
  const have = new Set(titleTokens(jobTitle));
  if (want.length === 0 || have.size === 0) return false;
  const hits = want.filter((w) => have.has(w));
  const specificWant = want.filter((w) => !GENERIC.has(w));
  const specificHits = hits.filter((w) => !GENERIC.has(w));
  if (specificWant.length > 0 && specificHits.length === 0) return false;
  // Require most of the role's words: 1/1, 2/2, 2/3, 3/4 …
  return hits.length / want.length >= 0.66;
}

export function titleMatchesAny(jobTitle: string, roles: string[]): boolean {
  return roles.some((r) => titleMatchesRole(jobTitle, r));
}

const SENIOR_RE = /\b(senior|sr\.?|principal|staff)\b/i;
const LEAD_RE = /\b(lead|team lead|tech lead)\b/i;
const EXEC_RE = /\b(director|head|vp|vice president|chief|cxo|cto|ceo|cfo|coo|avp|svp|evp)\b/i;
const INTERN_RE = /\b(intern|internship|trainee|apprentice)\b/i;
const JUNIOR_RE = /\b(junior|jr\.?|fresher|freshers|entry[- ]level|graduate trainee)\b/i;

/** Returns a reason when the title's seniority clearly doesn't fit the user's experience. */
export function seniorityMismatch(title: string, years: number): string | null {
  if (INTERN_RE.test(title) && years >= 1) return "internship";
  if (EXEC_RE.test(title) && years < 8) return "too senior (executive)";
  if (SENIOR_RE.test(title) && years < 5) return "too senior";
  if (LEAD_RE.test(title) && years < 3) return "too senior (lead)";
  if (JUNIOR_RE.test(title) && years >= 5) return "too junior";
  return null;
}
