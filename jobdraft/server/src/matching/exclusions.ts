// "Never contact a company the user has worked for." Matching is deliberately
// generous: name variants, suffixes, typos, and the email/URL domain.

// Words that don't identify a company. Removed before comparing.
const SUFFIXES = new Set([
  "pvt", "private", "ltd", "limited", "llp", "inc", "india", "technologies", "technology", "solutions", "software",
  "services", "labs", "systems", "group", "co", "corp", "corporation", "company", "the", "and",
]);

function basicNormalize(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Mograsys Technologies Pvt. Ltd." → "mograsys". Falls back to the full name if only suffixes remain. */
export function exclusionKey(name: string): string {
  const base = basicNormalize(name);
  const core = base
    .split(" ")
    .filter((t) => t && !SUFFIXES.has(t))
    .join(" ");
  return (core || base).slice(0, 190);
}

/** Jaro-Winkler similarity in [0, 1]. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatch = new Array<boolean>(a.length).fill(false);
  const bMatch = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
      if (!bMatch[j] && a[i] === b[j]) {
        aMatch[i] = bMatch[j] = true;
        matches++;
        break;
      }
    }
  }
  if (!matches) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatch[i]) continue;
    while (!bMatch[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** True when two company names refer to the same employer. */
export function sameCompany(a: string, b: string): boolean {
  const ka = exclusionKey(a);
  const kb = exclusionKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  if (ka.replace(/ /g, "") === kb.replace(/ /g, "")) return true;
  const ta = ka.split(" ");
  const tb = kb.split(" ");
  const [short, long] = ta.length <= tb.length ? [ta, new Set(tb)] : [tb, new Set(ta)];
  if (short.join("").length >= 2 && short.every((t) => long.has(t))) return true;
  return jaroWinkler(ka, kb) >= 0.9;
}

/** Host part of an email address or URL, lowercased ("hr@mograsys.com" → "mograsys.com"). */
export function hostOf(emailOrUrl: string): string {
  const s = emailOrUrl.trim().toLowerCase();
  if (s.includes("@") && !s.includes("/")) return s.split("@").pop() ?? "";
  try {
    return new URL(s.startsWith("http") ? s : `https://${s}`).hostname;
  } catch {
    return "";
  }
}

/** "careers.mograsys.in" contains the excluded key "mograsys" (keys under 4 letters are ignored). */
export function domainContainsKey(emailOrUrl: string, key: string): boolean {
  const compact = key.replace(/ /g, "");
  if (compact.length < 4) return false;
  const host = hostOf(emailOrUrl).replace(/-/g, "");
  return !!host && host.includes(compact);
}

export interface ExcludedCompany {
  company_name: string;
  company_key: string;
}

export interface ExclusionTarget {
  company: string;
  realEmployer?: string | null;
  email?: string | null;
  url?: string | null;
}

/** The excluded company this posting belongs to, or null. */
export function findExcluded(target: ExclusionTarget, excluded: ExcludedCompany[]): { company: string; via: "company" | "real_employer" | "email" | "url" } | null {
  for (const ex of excluded) {
    if (sameCompany(target.company, ex.company_name)) return { company: ex.company_name, via: "company" };
    if (target.realEmployer && sameCompany(target.realEmployer, ex.company_name)) return { company: ex.company_name, via: "real_employer" };
    if (target.email && domainContainsKey(target.email, ex.company_key)) return { company: ex.company_name, via: "email" };
    if (target.url && domainContainsKey(target.url, ex.company_key)) return { company: ex.company_name, via: "url" };
  }
  return null;
}
