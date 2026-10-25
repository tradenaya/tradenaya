// JSearch (RapidAPI) v5. Request and response shape verified against a real
// response: jobs are in data.jobs, the next-page token is data.cursor.
import { config } from "../config/env.js";
import { sha1 } from "../lib/crypto.js";
import { inrToLpa } from "../matching/parse.js";
import { stripHtml } from "../matching/text.js";
import { SourceHttpError } from "./errors.js";
import type { JSearchQuery } from "./queries.js";
import type { Job } from "./types.js";

export interface JSearchApplyOption {
  publisher?: string;
  apply_link?: string;
  is_direct?: boolean;
}

export interface JSearchJob {
  job_id?: string;
  job_uid?: string;
  job_title?: string;
  employer_name?: string;
  employer_website?: string | null;
  job_publisher?: string;
  job_apply_link?: string;
  apply_options?: JSearchApplyOption[];
  job_description?: string;
  job_is_remote?: boolean;
  job_city?: string | null;
  job_state?: string | null;
  job_country?: string | null;
  job_location?: string | null;
  job_posted_at_datetime_utc?: string | null;
  job_posted_at_timestamp?: number | null;
  job_min_salary?: number | null;
  job_max_salary?: number | null;
  job_salary_period?: string | null;
}

export interface JSearchResponse {
  status?: string;
  request_id?: string;
  data?: { jobs?: JSearchJob[]; cursor?: string | null };
  error?: { message?: string } | string;
}

export const JSEARCH_HOST = "jsearch.p.rapidapi.com";

/**
 * Query string for one search. country=in and date_posted=week are ALWAYS sent:
 * the defaults (us, all) return old, wrong-country postings.
 */
export function jsearchParams(q: Pick<JSearchQuery, "query">, cursor?: string | null): URLSearchParams {
  const params = new URLSearchParams({ query: q.query, country: "in", date_posted: "week", num_pages: "1", language: "en" });
  if (cursor) params.set("cursor", cursor);
  return params;
}

/** India only: job_country "IN", or a remote job open to India. */
export function isIndiaJob(r: JSearchJob): boolean {
  const country = (r.job_country ?? "").trim().toUpperCase();
  if (country === "IN") return true;
  if (!r.job_is_remote) return false;
  return !country || /\bindia\b/i.test(`${r.job_location ?? ""} ${r.job_title ?? ""} ${(r.job_description ?? "").slice(0, 3000)}`);
}

/** A direct apply link when there is one, else the main apply link. */
export function preferredApplyLink(r: JSearchJob): string | null {
  const direct = (r.apply_options ?? []).find((o) => o?.is_direct && o.apply_link)?.apply_link;
  return direct || r.job_apply_link || (r.apply_options ?? []).find((o) => o?.apply_link)?.apply_link || null;
}

/** ISO date, falling back to the unix timestamp; null = unknown (kept). */
export function postedAtOf(r: JSearchJob): string | null {
  if (r.job_posted_at_datetime_utc) {
    const t = Date.parse(r.job_posted_at_datetime_utc);
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }
  if (typeof r.job_posted_at_timestamp === "number" && r.job_posted_at_timestamp > 0) return new Date(r.job_posted_at_timestamp * 1000).toISOString();
  return null;
}

function toLpa(amount: number | null | undefined, period: string | null | undefined): number | null {
  if (!amount || !Number.isFinite(amount)) return null;
  const p = (period ?? "YEAR").toUpperCase();
  const yearly = p === "MONTH" ? amount * 12 : p === "HOUR" ? amount * 2080 : p === "YEAR" ? amount : null;
  return yearly ? inrToLpa(yearly) : null;
}

export function normalizeJSearch(r: JSearchJob): Job | null {
  const id = r.job_uid || r.job_id;
  const title = (r.job_title ?? "").trim();
  const company = (r.employer_name ?? "").trim();
  const url = preferredApplyLink(r);
  if (!id || !title || !company || !url) return null;
  const indian = (r.job_country ?? "").toUpperCase() === "IN";
  const location = r.job_location || [r.job_city, r.job_state].filter(Boolean).join(", ") || (r.job_is_remote ? "Remote" : r.job_country || "");
  return {
    key: `jsearch:${id.length > 80 ? sha1(id) : id}`,
    source: "jsearch",
    title,
    company,
    location,
    isRemote: !!r.job_is_remote,
    description: stripHtml(r.job_description ?? ""),
    url,
    postedAt: postedAtOf(r),
    // Amounts are only meaningful as rupees for Indian postings.
    salaryMinLpa: indian ? toLpa(r.job_min_salary, r.job_salary_period) : null,
    salaryMaxLpa: indian ? toLpa(r.job_max_salary, r.job_salary_period) : null,
    employerWebsite: r.employer_website ?? null,
  };
}

export interface JSearchPage {
  jobs: Job[];
  /** Postings in the response before the India filter. */
  total: number;
  /** Dropped because they were not in India. */
  notIndia: number;
  cursor: string | null;
}

/** Parses a v5 response body: status "OK", jobs in data.jobs, paging token in data.cursor. */
export function parseJSearchResponse(body: JSearchResponse, variant?: JSearchQuery["variant"]): JSearchPage {
  if (body?.status !== "OK") {
    const msg = typeof body?.error === "string" ? body.error : body?.error?.message;
    throw new SourceHttpError("jsearch", 200, `JSearch status ${body?.status ?? "missing"}${msg ? `: ${msg}` : ""}`);
  }
  const raw = Array.isArray(body.data?.jobs) ? body.data!.jobs! : [];
  const seen = new Set<string>();
  const jobs: Job[] = [];
  let notIndia = 0;
  for (const r of raw) {
    if (!isIndiaJob(r)) {
      notIndia++;
      continue;
    }
    const job = normalizeJSearch(r);
    if (!job || seen.has(job.key)) continue;
    seen.add(job.key);
    jobs.push(variant ? { ...job, variant } : job);
  }
  return { jobs, total: raw.length, notIndia, cursor: body.data?.cursor || null };
}

/** One page of results for one query (each page is one API call). */
export async function fetchJSearchPage(q: JSearchQuery, cursor?: string | null): Promise<JSearchPage> {
  // "/search" was retired by JSearch ("Endpoint '/search' does not exist"); v5 lives at /search-v2.
  const res = await fetch(`https://${JSEARCH_HOST}/search-v2?${jsearchParams(q, cursor)}`, {
    headers: { "X-RapidAPI-Key": config().rapidApiKey, "X-RapidAPI-Host": JSEARCH_HOST },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new SourceHttpError("jsearch", res.status, `JSearch error ${res.status}`);
  return parseJSearchResponse((await res.json()) as JSearchResponse, q.variant);
}
