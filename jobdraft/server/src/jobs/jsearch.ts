import { config } from "../config/env.js";
import { sha1 } from "../lib/crypto.js";
import { cityOf, isRemoteLocation } from "../matching/locations.js";
import { inrToLpa } from "../matching/parse.js";
import { stripHtml } from "../matching/text.js";
import type { Job, SearchPair } from "./types.js";

interface JSearchResult {
  job_id?: string;
  job_title?: string;
  employer_name?: string;
  job_description?: string;
  job_apply_link?: string;
  job_google_link?: string;
  job_city?: string;
  job_state?: string;
  job_country?: string;
  job_location?: string;
  job_is_remote?: boolean;
  job_posted_at_datetime_utc?: string;
  job_posted_at_timestamp?: number;
  job_min_salary?: number | null;
  job_max_salary?: number | null;
  job_salary_period?: string | null;
  job_salary_currency?: string | null;
}

function toLpa(amount: number | null | undefined, period: string | null | undefined, currency: string | null | undefined): number | null {
  if (!amount || (currency && currency.toUpperCase() !== "INR")) return null;
  const p = (period ?? "YEAR").toUpperCase();
  const yearly = p === "MONTH" ? amount * 12 : p === "HOUR" ? amount * 2080 : p === "YEAR" ? amount : null;
  return yearly ? inrToLpa(yearly) : null;
}

export function normalizeJSearch(r: JSearchResult): Job | null {
  const title = (r.job_title ?? "").trim();
  const company = (r.employer_name ?? "").trim();
  const url = r.job_apply_link || r.job_google_link;
  if (!r.job_id || !title || !company || !url) return null;
  const location = r.job_location || [r.job_city, r.job_state].filter(Boolean).join(", ") || r.job_country || "";
  const posted = r.job_posted_at_datetime_utc || (r.job_posted_at_timestamp ? new Date(r.job_posted_at_timestamp * 1000).toISOString() : null);
  return {
    key: `jsearch:${r.job_id.length > 80 ? sha1(r.job_id) : r.job_id}`,
    source: "jsearch",
    title,
    company,
    location,
    isRemote: !!r.job_is_remote,
    description: stripHtml(r.job_description ?? ""),
    url,
    postedAt: posted,
    salaryMinLpa: toLpa(r.job_min_salary, r.job_salary_period, r.job_salary_currency),
    salaryMaxLpa: toLpa(r.job_max_salary, r.job_salary_period, r.job_salary_currency),
  };
}

/** JSearch (RapidAPI). One page per call — the free quota is small. */
export async function fetchJSearch(pair: SearchPair): Promise<Job[]> {
  const remote = isRemoteLocation(pair.location);
  const params = new URLSearchParams({
    query: remote ? `${pair.role} remote India` : `${pair.role} in ${cityOf(pair.location)}, India`,
    page: "1",
    num_pages: "1",
    country: "in",
    date_posted: "3days",
  });
  if (remote) params.set("work_from_home", "true");
  const res = await fetch(`https://jsearch.p.rapidapi.com/search?${params}`, {
    headers: { "X-RapidAPI-Key": config().rapidApiKey, "X-RapidAPI-Host": "jsearch.p.rapidapi.com" },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`JSearch HTTP ${res.status}`);
  const body = (await res.json()) as { data?: JSearchResult[] };
  return (body.data ?? []).map(normalizeJSearch).filter((j): j is Job => j !== null);
}
