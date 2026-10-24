import { config } from "../config/env.js";
import { sha1 } from "../lib/crypto.js";
import { inrToLpa } from "../matching/parse.js";
import { stripHtml } from "../matching/text.js";
import { SourceHttpError } from "./errors.js";
import type { AdzunaQuery } from "./queries.js";
import type { Job } from "./types.js";

interface AdzunaResult {
  id?: string | number;
  title?: string;
  description?: string;
  redirect_url?: string;
  created?: string;
  salary_min?: number;
  salary_max?: number;
  salary_is_predicted?: string | number;
  company?: { display_name?: string };
  location?: { display_name?: string; area?: string[] };
}

const REMOTE_TEXT_RE = /\b(remote|work from home|work-from-home|wfh)\b/i;

export function normalizeAdzuna(r: AdzunaResult): Job | null {
  const title = stripHtml(r.title ?? "").trim();
  const company = (r.company?.display_name ?? "").trim();
  if (!r.id || !title || !company || !r.redirect_url) return null;
  const description = stripHtml(r.description ?? "");
  const location = r.location?.display_name || (r.location?.area ?? []).slice(-2).join(", ");
  // Adzuna "predicted" salaries are estimates — don't filter on them.
  const predicted = String(r.salary_is_predicted ?? "0") === "1";
  return {
    key: `adzuna:${String(r.id).length > 80 ? sha1(String(r.id)) : r.id}`,
    source: "adzuna",
    title,
    company,
    location,
    isRemote: REMOTE_TEXT_RE.test(`${title} ${location} ${description}`),
    description,
    url: r.redirect_url,
    postedAt: r.created ?? null,
    salaryMinLpa: predicted ? null : inrToLpa(r.salary_min),
    salaryMaxLpa: predicted ? null : inrToLpa(r.salary_max),
  };
}

/** Query string for one Adzuna search: role words in the title, newest first, last 7 days, 50 per page. */
export function adzunaParams(q: AdzunaQuery, creds = config().adzuna): URLSearchParams {
  const params = new URLSearchParams({
    app_id: creds.appId,
    app_key: creds.appKey,
    results_per_page: "50",
    max_days_old: "7",
    sort_by: "date",
    title_only: q.titleOnly,
    "content-type": "application/json",
  });
  if (q.what) params.set("what", q.what);
  if (q.where) params.set("where", q.where);
  return params;
}

/** Remote searches keep only postings that actually say remote / work from home / WFH. */
export function keepForQuery(job: Job, q: Pick<AdzunaQuery, "remoteOnly">): boolean {
  return !q.remoteOnly || REMOTE_TEXT_RE.test(`${job.title} ${job.location} ${job.description}`);
}

/** Adzuna India, one page. Descriptions are excerpts, so most results end up "apply via link". */
export async function fetchAdzuna(q: AdzunaQuery): Promise<Job[]> {
  const res = await fetch(`https://api.adzuna.com/v1/api/jobs/in/search/1?${adzunaParams(q)}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new SourceHttpError("adzuna", res.status, `Adzuna error ${res.status}`);
  const body = (await res.json()) as { results?: AdzunaResult[] };
  return (body.results ?? [])
    .map(normalizeAdzuna)
    .filter((j): j is Job => j !== null)
    .map((j) => ({ ...j, variant: q.variant }));
}
