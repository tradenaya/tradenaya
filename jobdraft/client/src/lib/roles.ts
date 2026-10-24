import type { ResumeSummary } from "./types";

/** Adjacent roles for people in product / project / delivery / analysis / customer-facing work. */
export const ADJACENT_MANAGEMENT_ROLES = [
  "Associate Project Manager",
  "Project Coordinator",
  "Business Analyst",
  "Implementation Consultant",
  "Technical Account Manager",
  "Customer Success Manager",
  "Scrum Master",
  "Delivery Manager",
];

const ADJACENT_ENGINEERING_ROLES = ["Software Developer", "Full Stack Developer", "Backend Developer", "Frontend Developer", "Application Developer"];

const MANAGEMENT_RE = /\b(product|project|program|delivery|scrum|agile|business analyst|analyst|implementation|customer success|account manager|consultant|coordinator|team lead|manager|owner)\b/i;
const ENGINEERING_RE = /\b(developer|engineer|programmer|sde|swe|full ?stack|front ?end|back ?end)\b/i;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Extra role tags worth adding, based on the resume (current title, past roles,
 * suggestions) and the roles already chosen. Excludes anything already listed.
 */
export function relatedRoles(resume: Pick<ResumeSummary, "currentTitle" | "roles" | "suggestedTargetRoles"> | null, selected: string[], alreadySuggested: string[] = []): string[] {
  const text = [resume?.currentTitle ?? "", ...(resume?.roles ?? []).map((r) => r.title), ...(resume?.suggestedTargetRoles ?? []), ...selected].join(" | ");
  const management = MANAGEMENT_RE.test(text);
  const engineering = ENGINEERING_RE.test(text);
  const pool = management || !engineering ? ADJACENT_MANAGEMENT_ROLES : ADJACENT_ENGINEERING_ROLES;
  const taken = new Set([...selected, ...alreadySuggested].map(norm));
  return pool.filter((r) => !taken.has(norm(r)));
}
