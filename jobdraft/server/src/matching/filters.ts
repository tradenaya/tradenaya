import type { Job } from "../jobs/types.js";
import { industryProblem } from "./industry.js";
import { locationMatches } from "./locations.js";
import { parseMinExperience, parseSalaryLpa } from "./parse.js";
import { companyKey, normalize } from "./text.js";
import { seniorityMismatch, titleMatchesAny } from "./titles.js";

const AGENCY_RE =
  /\b(consultancy|consultancies|consultants?|placements?|staffing|recruit(?:ment|ments|ers?|ing)|manpower|hr services|hr solutions|hr consult\w*|talent (?:acquisition|solutions|search)|head ?hunt\w*|outsourcing services|job (?:portal|agency)|executive search|employment (?:agency|services))\b/i;

// Product/IT companies whose legal name happens to contain an agency keyword.
const AGENCY_ALLOWLIST = [/tata consultancy services/i, /\btcs\b/i];

export function isStaffingAgencyName(company: string): boolean {
  if (AGENCY_ALLOWLIST.some((re) => re.test(company))) return false;
  return AGENCY_RE.test(company);
}

export interface FilterContext {
  targetRoles: string[];
  locations: string[];
  experienceYears: number;
  expectedSalaryLpa: number;
  seenJobKeys: Set<string>;
  /** company keys drafted to within the last 60 days */
  recentCompanyKeys: Set<string>;
}

export interface Rejection {
  job: Job;
  reason: string;
}

export function jobSalaryMaxLpa(job: Job): number | null {
  if (job.salaryMaxLpa) return job.salaryMaxLpa;
  if (job.salaryMinLpa) return job.salaryMinLpa;
  return parseSalaryLpa(`${job.title}\n${job.description}`)?.maxLpa ?? null;
}

/** Cheap rule checks, run before any AI call. Order of checks = order of reasons. */
export function rejectReason(job: Job, ctx: FilterContext): string | null {
  if (ctx.seenJobKeys.has(job.key)) return "already seen";
  if (!job.company.trim() || !job.title.trim()) return "missing company or title";
  if (!locationMatches(job, ctx.locations)) return "location";
  if (!titleMatchesAny(job.title, ctx.targetRoles)) return "title";
  const industry = industryProblem(job);
  if (industry) return industry;
  const seniority = seniorityMismatch(job.title, ctx.experienceYears);
  if (seniority) return seniority;
  // Stated minimum may be up to 2 years above the user's; unstated is kept.
  const minExp = parseMinExperience(`${job.title}\n${job.description}`);
  if (minExp !== null && minExp > ctx.experienceYears + 2) return "experience required too high";
  const maxLpa = jobSalaryMaxLpa(job);
  if (maxLpa !== null && maxLpa < ctx.expectedSalaryLpa) return "salary below expectation";
  if (isStaffingAgencyName(job.company)) return "staffing agency";
  if (ctx.recentCompanyKeys.has(companyKey(job.company))) return "company contacted recently";
  return null;
}

export function dedupeKey(job: Job): string {
  return `${companyKey(job.company)}|${normalize(job.title)}`;
}

export function applyRuleFilter(jobs: Job[], ctx: FilterContext): { passed: Job[]; rejected: Rejection[] } {
  const passed: Job[] = [];
  const rejected: Rejection[] = [];
  const seen = new Set<string>();
  for (const job of jobs) {
    const reason = rejectReason(job, ctx);
    if (reason) {
      rejected.push({ job, reason });
      continue;
    }
    const key = dedupeKey(job);
    if (seen.has(key)) {
      rejected.push({ job, reason: "duplicate" });
      continue;
    }
    seen.add(key);
    passed.push(job);
  }
  // Newest first; unknown dates last.
  passed.sort((a, b) => (Date.parse(b.postedAt ?? "") || 0) - (Date.parse(a.postedAt ?? "") || 0));
  return { passed, rejected };
}
