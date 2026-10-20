import { config } from "../config/env.js";
import { sha1 } from "../lib/crypto.js";
import { cityOf, isRemoteLocation } from "../matching/locations.js";
import { inrToLpa } from "../matching/parse.js";
import { stripHtml } from "../matching/text.js";
import type { Job, SearchPair } from "./types.js";

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
    isRemote: /\bremote|work from home\b/i.test(`${title} ${location} ${description}`),
    description,
    url: r.redirect_url,
    postedAt: r.created ?? null,
    salaryMinLpa: predicted ? null : inrToLpa(r.salary_min),
    salaryMaxLpa: predicted ? null : inrToLpa(r.salary_max),
  };
}

/** Adzuna India: newest postings from the last 3 days for one (role, location). */
export async function fetchAdzuna(pair: SearchPair): Promise<Job[]> {
  const { adzuna } = config();
  const params = new URLSearchParams({
    app_id: adzuna.appId,
    app_key: adzuna.appKey,
    results_per_page: "50",
    max_days_old: "3",
    sort_by: "date",
    what: isRemoteLocation(pair.location) ? `${pair.role} remote` : pair.role,
    "content-type": "application/json",
  });
  if (!isRemoteLocation(pair.location)) params.set("where", cityOf(pair.location));
  const res = await fetch(`https://api.adzuna.com/v1/api/jobs/in/search/1?${params}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Adzuna HTTP ${res.status}`);
  const body = (await res.json()) as { results?: AdzunaResult[] };
  return (body.results ?? []).map(normalizeAdzuna).filter((j): j is Job => j !== null);
}
