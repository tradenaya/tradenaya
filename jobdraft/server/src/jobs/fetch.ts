import { config, features } from "../config/env.js";
import { execute, json, query } from "../db/pool.js";
import { clock, HOUR } from "../lib/clock.js";
import { errInfo, log } from "../lib/logger.js";
import { istDate } from "../lib/time.js";
import { isRemoteLocation } from "../matching/locations.js";
import { normalize } from "../matching/text.js";
import { fetchAdzuna } from "./adzuna.js";
import { fetchJSearch } from "./jsearch.js";
import { mockJobsFor } from "./mock.js";
import type { Job, SearchPair } from "./types.js";

export class NoJobSourcesError extends Error {
  constructor() {
    super("No job sources are configured (add Adzuna or JSearch keys).");
    this.name = "NoJobSourcesError";
  }
}

/** Cached postings are shared across users for this long. */
export const CACHE_TTL_MS = 6 * HOUR;

const queryKey = (p: SearchPair) => normalize(p.role).slice(0, 190);
const locationKey = (p: SearchPair) => (isRemoteLocation(p.location) ? "remote" : normalize(p.location).slice(0, 190));
export const pairKey = (p: SearchPair) => `${queryKey(p)}||${locationKey(p)}`;

export function uniquePairs(pairs: SearchPair[]): SearchPair[] {
  const map = new Map<string, SearchPair>();
  for (const p of pairs) if (!map.has(pairKey(p))) map.set(pairKey(p), p);
  return [...map.values()];
}

export interface FetchStats {
  pairs: number;
  fromCache: number;
  apiCalls: number;
  errors: number;
}

type Source = "adzuna" | "jsearch" | "mock";

async function fetchFrom(source: Source, pair: SearchPair, now: Date): Promise<Job[]> {
  if (source === "mock") return mockJobsFor(pair, istDate(now));
  if (source === "adzuna") return fetchAdzuna(pair);
  return fetchJSearch(pair);
}

/**
 * Postings for each (role, location) pair. job_cache rows younger than 6 hours
 * are reused — another user's run may already have fetched them — and only
 * missing or stale (source, query, location) entries are fetched.
 */
export async function fetchJobsForPairs(pairs: SearchPair[], now = clock.now()): Promise<{ jobs: Map<string, Job[]>; stats: FetchStats }> {
  const f = features();
  if (!f.mock && !f.adzuna && !f.jsearch) throw new NoJobSourcesError();
  const sources: Source[] = f.mock ? ["mock"] : [...(f.adzuna ? (["adzuna"] as const) : []), ...(f.jsearch ? (["jsearch"] as const) : [])];
  const result = new Map<string, Job[]>();
  const stats: FetchStats = { pairs: 0, fromCache: 0, apiCalls: 0, errors: 0 };
  let jsearchCalls = 0;
  const fresh = new Date(now.getTime() - CACHE_TTL_MS);

  for (const pair of uniquePairs(pairs)) {
    stats.pairs++;
    const jobs: Job[] = [];
    for (const source of sources) {
      const [cached] = await query<{ payload: unknown }>(
        "SELECT payload FROM job_cache WHERE source = ? AND query = ? AND location = ? AND fetched_at > ?",
        [source, queryKey(pair), locationKey(pair), fresh],
      );
      if (cached) {
        jobs.push(...json<Job[]>(cached.payload, []));
        stats.fromCache++;
        continue;
      }
      if (source === "jsearch" && jsearchCalls >= config().jsearchMaxCallsPerRun) continue;
      try {
        if (source === "jsearch") jsearchCalls++;
        stats.apiCalls++;
        const got = await fetchFrom(source, pair, now);
        jobs.push(...got);
        await execute(
          `INSERT INTO job_cache (source, query, location, payload, fetched_at) VALUES (?, ?, ?, CAST(? AS JSON), ?)
           ON DUPLICATE KEY UPDATE payload = VALUES(payload), fetched_at = VALUES(fetched_at)`,
          [source, queryKey(pair), locationKey(pair), JSON.stringify(got), now],
        );
      } catch (err) {
        stats.errors++;
        log.warn("job_source_error", { source, error: errInfo(err) });
      }
    }
    result.set(pairKey(pair), jobs);
  }
  return { jobs: result, stats };
}

export async function pruneJobCache(now = clock.now()): Promise<void> {
  await execute("DELETE FROM job_cache WHERE fetched_at < ?", [new Date(now.getTime() - 7 * 24 * HOUR)]);
}
