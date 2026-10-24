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

/**
 * Role families: titles that name the same job in different words ("Product
 * Owner" = "Product Manager", "Technical Program Manager" = "Project Manager").
 * Matched on the normalised title; a posting and a target role in the same
 * family match even when their words differ.
 */
const FAMILIES: [string, RegExp][] = [
  ["product", /\b(product (manager|owner|management|lead)|associate pm|apm)\b/],
  ["project", /\b(project (manager|management|lead|leader|coordinator|associate)|program(me)? manager|technical program manager|tpm|pmo|project management office)\b/],
  ["delivery", /\b(delivery (manager|lead|owner|head)|engagement manager|service delivery)\b/],
  ["business_analyst", /\b(business (systems )?analyst|ba|functional (analyst|consultant)|requirements analyst|business analysis)\b/],
  ["implementation", /\b(implementation (consultant|specialist|manager|engineer|analyst|lead|executive)|onboarding (specialist|manager|consultant)|deployment (specialist|consultant))\b/],
  ["customer_success", /\b(customer success|client success|csm|technical account manager|tam|customer experience manager)\b/],
  ["scrum", /\b(scrum master|agile coach|agile (project|delivery) (manager|lead))\b/],
  ["team_lead", /\b(team (lead|leader)|tech lead|technical lead)\b/],
];

export function roleFamilies(title: string): Set<string> {
  const t = normalize(title);
  const out = new Set(FAMILIES.filter(([, re]) => re.test(t)).map(([name]) => name));
  // A bare "PM" means product manager — unless the title is a project/program title ("Project Manager (PM)").
  if (/\bpm\b/.test(t) && !out.has("project")) out.add("product");
  return out;
}

/** Clearly non-software domains in a title ("Civil Project Manager", "Product Manager - Ruminant (veterinary)"). */
const NON_SOFTWARE_TITLE_RE =
  /\b(civil|mechanical|construction|structural|electrical|hvac|mep|interiors?|fit out|real estate|facility|facilities|pharma|pharmaceuticals?|veterinary|ruminant|animal health|poultry|dairy|livestock|clinical|medical devices?|hospital|manufacturing|plant|factory|fmcg|textiles?|apparel|garments?|hospitality|hotel|restaurant|mining|oil|epc|solar)\b/;

export function nonSoftwareTitleWord(title: string): string | null {
  return NON_SOFTWARE_TITLE_RE.exec(normalize(title))?.[1] ?? null;
}

/** Fuzzy match of a posting title against one target role: same role family, or most of the role's words. */
export function titleMatchesRole(jobTitle: string, role: string): boolean {
  // A non-software domain in the posting title that the role doesn't ask for never matches.
  const domain = nonSoftwareTitleWord(jobTitle);
  if (domain && !normalize(role).includes(domain)) return false;
  const wantFamilies = roleFamilies(role);
  if (wantFamilies.size) {
    const have = roleFamilies(jobTitle);
    if ([...wantFamilies].some((f) => have.has(f))) return true;
  }
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

// Director/head/VP/principal-level titles. "Senior", "Lead" and "Senior Associate" are NOT
// excluded here: the posting's stated minimum experience decides those (filters.ts).
const EXEC_RE = /\b(director|head|vp|vice president|chief|cxo|cto|ceo|cfo|coo|avp|svp|evp|principal)\b/i;
const INTERN_RE = /\b(intern|internship|trainee|apprentice)\b/i;
const JUNIOR_RE = /\b(junior|jr\.?|fresher|freshers|entry[- ]level|graduate trainee)\b/i;
/** Below this many years, director/head/VP/principal titles are skipped. */
export const EXEC_MIN_YEARS = 5;

/** Returns a reason when the title's seniority clearly doesn't fit the user's experience. */
export function seniorityMismatch(title: string, years: number): string | null {
  if (INTERN_RE.test(title) && years >= 1) return "internship";
  if (EXEC_RE.test(title) && years < EXEC_MIN_YEARS) return "too senior (director/head/VP/principal)";
  if (JUNIOR_RE.test(title) && years >= 5) return "too junior";
  return null;
}
