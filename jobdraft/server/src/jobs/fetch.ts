// Collects postings for one run from every configured source. Results are
// cached per (source, query, location) and shared by all users; free-tier call
// limits are counted in api_usage; every query and error is reported for the
// run funnel.
import { config, features } from "../config/env.js";
import { execute, json, query } from "../db/pool.js";
import { clock, HOUR } from "../lib/clock.js";
import { errInfo, log } from "../lib/logger.js";
import { istDate } from "../lib/time.js";
import { isRemoteLocation } from "../matching/locations.js";
import { normalize } from "../matching/text.js";
import { MAX_QUERY_REPORTS, type QueryReport, type SourceReport } from "../runs/funnel.js";
import { fetchAdzuna, keepForQuery } from "./adzuna.js";
import { sleep } from "../lib/errors.js";
import { SourceHttpError, isQuotaStatus } from "./errors.js";
import { fetchJSearchPage } from "./jsearch.js";
import { mockJobsFor } from "./mock.js";
import { adzunaLabel, adzunaQueries, jsearchCombos, type JSearchQuery } from "./queries.js";
import type { Job, SearchPair, SourceName } from "./types.js";
import { markOwnKeyExhausted, ownKeyBudget, reserveOwnCall, reserveSharedCall, sharedBudget, type OwnKeyBudget, type SharedBudget } from "./jsearch-budget.js";
import { classifyRapidApiRefusal, setJSearchKeyStatus } from "./jsearch-key.js";
import { markExhausted, reserveCall } from "./usage.js";

/** How long cached postings are reused (across users). */
export const CACHE_TTL_MS: Record<SourceName, number> = { adzuna: 6 * HOUR, mock: 6 * HOUR, jsearch: 12 * HOUR };
/** A second JSearch page is fetched only when the first had this many relevant postings. */
export const JSEARCH_SECOND_PAGE_MIN_RELEVANT = 5;

const queryKey = (p: SearchPair) => normalize(p.role).slice(0, 190);
const locationKey = (p: SearchPair) => (isRemoteLocation(p.location) ? "remote" : normalize(p.location).slice(0, 190));
export const pairKey = (p: SearchPair) => `${queryKey(p)}||${locationKey(p)}`;

export function uniquePairs(pairs: SearchPair[]): SearchPair[] {
  const map = new Map<string, SearchPair>();
  for (const p of pairs) if (!map.has(pairKey(p))) map.set(pairKey(p), p);
  return [...map.values()];
}

async function readCache(source: SourceName, q: string, loc: string, now: Date): Promise<Job[] | null> {
  const [row] = await query<{ payload: unknown }>("SELECT payload FROM job_cache WHERE source = ? AND query = ? AND location = ? AND fetched_at > ?", [
    source,
    q.slice(0, 190),
    loc.slice(0, 190),
    new Date(now.getTime() - CACHE_TTL_MS[source]),
  ]);
  return row ? json<Job[]>(row.payload, []) : null;
}

async function writeCache(source: SourceName, q: string, loc: string, jobs: Job[], now: Date) {
  await execute(
    `INSERT INTO job_cache (source, query, location, payload, fetched_at) VALUES (?, ?, ?, CAST(? AS JSON), ?)
     ON DUPLICATE KEY UPDATE payload = VALUES(payload), fetched_at = VALUES(fetched_at)`,
    [source, q.slice(0, 190), loc.slice(0, 190), JSON.stringify(jobs), now],
  );
}

function report(source: SourceName, configured: boolean): SourceReport {
  return { source, configured, calls: 0, cached: 0, fetched: 0, errors: [] };
}

function recordError(rep: SourceReport, err: unknown) {
  const status = err instanceof SourceHttpError ? err.status : undefined;
  const message = err instanceof Error ? err.message : String(err);
  if (rep.errors.length < 5) rep.errors.push({ ...(status && status !== 200 ? { status } : {}), message: message.slice(0, 200) });
  log.warn("job_source_error", { source: rep.source, status, error: errInfo(err) });
}

/** A user's own RapidAPI key for JSearch (see jsearch-key.ts). */
export interface OwnJSearchKey {
  key: string;
  savedAt: Date | null;
}

export interface CollectOptions {
  now?: Date;
  /** Used to decide whether a second JSearch page is worth a call. */
  isRelevant?: (job: Job) => boolean;
  /** The user this run is for: their share of the shared JSearch searches. */
  userId?: number;
  /** Their own key, used first; the shared key only if it stops working. */
  ownJSearchKey?: OwnJSearchKey | null;
}

export interface CollectResult {
  /** Unique postings (by source key). */
  jobs: Job[];
  sources: SourceReport[];
  queries: QueryReport[];
}

class Collector {
  readonly jobs = new Map<string, Job>();
  readonly queries: QueryReport[] = [];
  add(list: Job[]) {
    for (const j of list) if (!this.jobs.has(j.key)) this.jobs.set(j.key, j);
  }
  log(q: QueryReport) {
    if (this.queries.length < MAX_QUERY_REPORTS) this.queries.push(q);
  }
}

type MockSource = (pair: SearchPair, runDate: string) => Job[] | Promise<Job[]>;
let mockSource: MockSource | null = null;
/** Tests can make the demo source return nothing or fail. */
export function setMockJobsForTests(fn: MockSource | null) {
  mockSource = fn;
}

async function collectMock(pairs: SearchPair[], now: Date, c: Collector): Promise<SourceReport> {
  const rep = report("mock", true);
  for (const pair of pairs) {
    let jobs = await readCache("mock", queryKey(pair), locationKey(pair), now);
    const fromCache = !!jobs;
    let error: string | undefined;
    if (jobs) rep.cached++;
    else {
      rep.calls++;
      try {
        jobs = (await (mockSource ?? mockJobsFor)(pair, istDate(now))).map((j) => ({ ...j, variant: "plain" as const }));
        await writeCache("mock", queryKey(pair), locationKey(pair), jobs, now);
      } catch (err) {
        recordError(rep, err);
        error = err instanceof Error ? err.message : "error";
        jobs = [];
      }
    }
    rep.fetched += jobs.length;
    c.add(jobs);
    c.log({ source: "mock", variant: "plain", role: pair.role, location: pair.location, query: pair.role, fetched: jobs.length, fromCache, error });
  }
  return rep;
}

/**
 * Adzuna answers 503 when called too fast (it limits calls per minute), so real
 * calls are spaced out and a 503/429 is retried once after a pause. Tests run
 * without pauses.
 */
export const ADZUNA_PACING = { gapMs: process.env.NODE_ENV === "test" ? 0 : 2600, retryMs: process.env.NODE_ENV === "test" ? 0 : 10_000, stopAfterBusy: 3 };
const isBusy = (err: unknown) => err instanceof SourceHttpError && (err.status === 503 || err.status === 429);
/** Pause before retrying a search whose connection dropped. */
export const NETWORK_RETRY_MS = process.env.NODE_ENV === "test" ? 0 : 3000;

/**
 * The connection dropped or timed out ("fetch failed", a reset, a DNS hiccup):
 * no answer from the source at all, so one retry usually works.
 */
export function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error) || err instanceof SourceHttpError) return false;
  return err.name === "TimeoutError" || err.name === "AbortError" || /fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket|network/i.test(err.message);
}

/**
 * One query per (role, city); remote = keyword searches. A busy answer or a
 * dropped connection is retried once. Stops at the daily cap, on rejected keys,
 * or when Adzuna keeps saying "busy".
 */
async function collectAdzuna(pairs: SearchPair[], now: Date, c: Collector): Promise<SourceReport> {
  const rep = report("adzuna", true);
  const cap = config().adzunaDailyCap;
  let skippedForCap = 0;
  let stopped: string | null = null;
  let lastCallAt = 0;
  let busyInARow = 0;
  const paced = async <T>(fn: () => Promise<T>): Promise<T> => {
    const wait = lastCallAt + ADZUNA_PACING.gapMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
    return fn();
  };
  for (const q of adzunaQueries(pairs)) {
    const cq = normalize(adzunaLabel(q));
    const cl = q.where ? normalize(q.where) : "india";
    let jobs = await readCache("adzuna", cq, cl, now);
    const fromCache = !!jobs;
    let error: string | undefined;
    if (jobs) rep.cached++;
    else {
      if (stopped) {
        skippedForCap++;
        continue;
      }
      if (!(await reserveCall("adzuna", cap, now))) {
        stopped = `Daily limit reached (${cap} calls/day across all users)`;
        skippedForCap++;
        continue;
      }
      rep.calls++;
      try {
        try {
          jobs = await paced(() => fetchAdzuna(q));
        } catch (err) {
          if (isBusy(err)) await sleep(ADZUNA_PACING.retryMs); // busy: one retry after a pause
          else if (isNetworkError(err)) await sleep(NETWORK_RETRY_MS); // connection dropped: one retry
          else throw err;
          jobs = await paced(() => fetchAdzuna(q));
        }
        busyInARow = 0;
        await writeCache("adzuna", cq, cl, jobs, now);
      } catch (err) {
        recordError(rep, err);
        error = err instanceof Error ? err.message : "error";
        jobs = [];
        if (err instanceof SourceHttpError && (err.status === 401 || err.status === 403)) stopped = `Keys rejected (HTTP ${err.status})`;
        else if (isBusy(err) && ++busyInARow >= ADZUNA_PACING.stopAfterBusy) stopped = "Adzuna is busy (HTTP 503), the remaining searches run next time";
      }
    }
    const kept = jobs.filter((j) => keepForQuery(j, q));
    rep.fetched += kept.length;
    c.add(kept);
    c.log({ source: "adzuna", variant: q.variant, role: q.role, location: q.location, query: adzunaLabel(q), where: q.where, fetched: kept.length, fromCache, error });
  }
  if (stopped) rep.note = skippedForCap ? `${stopped}; ${skippedForCap} searches skipped` : stopped;
  return rep;
}

type Lane = { key: string; own: boolean };

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/**
 * JSearch has a small monthly quota, so: cached searches (12 h, shared by all
 * users) first, then never-searched / least recently searched (role, city,
 * variant) combinations, which rotates through all of them over the days.
 * Searches use the user's own key first (its own monthly quota spread over the
 * month); otherwise their share of today's shared searches. A second page only
 * when the first had enough relevant postings.
 */
async function collectJSearch(pairs: SearchPair[], now: Date, c: Collector, opts: CollectOptions): Promise<SourceReport> {
  const cfg = config();
  const sharedKey = cfg.rapidApiKey;
  const userId = opts.userId;
  const own = userId !== undefined ? (opts.ownJSearchKey ?? null) : null;
  const rep = report("jsearch", !!sharedKey || !!own);
  if (!rep.configured) {
    rep.note = "Not configured (add RAPIDAPI_KEY)";
    return rep;
  }
  const combos = jsearchCombos(pairs);
  const stale: JSearchQuery[] = [];
  for (const combo of combos) {
    const jobs = await readCache("jsearch", combo.comboKey, "in", now);
    if (!jobs) {
      stale.push(combo);
      continue;
    }
    rep.cached++;
    rep.fetched += jobs.length;
    c.add(jobs);
    c.log({ source: "jsearch", variant: combo.variant, role: combo.role, location: combo.location, query: combo.query, fetched: jobs.length, fromCache: true });
  }
  if (!stale.length) return rep;

  // Never searched first, then oldest; ties keep the priority order (email-friendly variants first).
  const lastRows = await query<{ combo_key: string; last_queried_at: Date }>(
    "SELECT combo_key, last_queried_at FROM search_rotation WHERE source = 'jsearch' AND combo_key IN (?)",
    [stale.map((s) => s.comboKey)],
  );
  const last = new Map(lastRows.map((r) => [r.combo_key, new Date(r.last_queried_at).getTime()]));
  const order = new Map(stale.map((s, i) => [s.comboKey, i]));
  stale.sort((a, b) => (last.get(a.comboKey) ?? 0) - (last.get(b.comboKey) ?? 0) || order.get(a.comboKey)! - order.get(b.comboKey)!);

  const perRun = cfg.jsearchMaxCallsPerRun;
  let runCalls = 0;
  let ownCalls = 0;
  const ownBudget: OwnKeyBudget | null = own ? await ownKeyBudget(userId!, own.savedAt, now) : null;
  // The own key "breaks" when RapidAPI refuses it; only then does its owner fall back to the shared searches.
  let ownBroken = !!ownBudget?.exhausted;
  let ownOn = !!ownBudget && !ownBroken;
  let ownStop: string | null = ownBroken ? "Your JSearch key has no searches left this month" : null;
  let shared: SharedBudget | null = null;
  let sharedStop: string | null = null;

  const take = async (): Promise<Lane | null> => {
    if (perRun > 0 && runCalls >= perRun) return null;
    let lane: Lane | null = null;
    if (ownOn && ownBudget) {
      if (await reserveOwnCall(userId!, ownBudget, now)) lane = { key: own!.key, own: true };
      else {
        ownOn = false;
        ownStop = `Your JSearch key: today's ${ownBudget.allowance} searches are used (its ${ownBudget.quota} a month are spread over the month)`;
      }
    }
    if (!lane && sharedKey && !sharedStop && (!ownBudget || ownBroken)) {
      shared ??= await sharedBudget(now, userId);
      const r = await reserveSharedCall(shared, now, userId);
      if (r === "ok") lane = { key: sharedKey, own: false };
      else
        sharedStop =
          r === "share"
            ? `Your share of today's free JSearch searches is used (${shared.share} of ${shared.pool}, shared by ${plural(shared.sharers, "user")})`
            : `Today's free JSearch searches are used (${shared.pool} a day, shared by all users)`;
    }
    if (!lane) return null;
    runCalls++;
    rep.calls++;
    if (lane.own) ownCalls++;
    return lane;
  };

  const fetchPage = async (combo: JSearchQuery, cursor: string | null, lane: Lane) => {
    try {
      return await fetchJSearchPage(combo, cursor, lane.key);
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      await sleep(NETWORK_RETRY_MS); // connection dropped: one retry
      return fetchJSearchPage(combo, cursor, lane.key);
    }
  };

  // RapidAPI doesn't count refused calls; the own key's count shows searches that ran.
  const refused = async (err: unknown, lane: Lane) => {
    if (!(err instanceof SourceHttpError)) return;
    if (lane.own) {
      if (isQuotaStatus(err.status)) {
        await markOwnKeyExhausted(userId!, now);
        ownStop = "Your JSearch key has used this month's free searches";
      } else {
        const status = classifyRapidApiRefusal(err.status, err.message);
        if (!status) return;
        await setJSearchKeyStatus(userId!, status);
        ownStop = status === "not_subscribed" ? "Your JSearch key isn't subscribed to the free plan yet (see Setup)" : "RapidAPI rejected your JSearch key (see Setup)";
      }
      ownOn = false;
      ownBroken = true;
      ownCalls--;
    } else if (isQuotaStatus(err.status)) {
      await markExhausted("jsearch", now);
      sharedStop = "Quota exhausted (HTTP 429), skipped until tomorrow";
    } else if (err.status === 401 || err.status === 403) {
      sharedStop = `Key rejected or not subscribed to JSearch (HTTP ${err.status})`;
    }
  };

  let deferred = 0;
  for (const combo of stale) {
    const lane = await take();
    if (!lane) {
      deferred++;
      continue;
    }
    let jobs: Job[] = [];
    let error: string | undefined;
    try {
      const first = await fetchPage(combo, null, lane);
      jobs = first.jobs;
      const relevant = opts.isRelevant ? jobs.filter(opts.isRelevant).length : jobs.length;
      const lane2 = first.cursor && relevant >= JSEARCH_SECOND_PAGE_MIN_RELEVANT ? await take() : null;
      if (first.cursor && lane2) {
        try {
          const second = await fetchPage(combo, first.cursor, lane2);
          const have = new Set(jobs.map((j) => j.key));
          jobs = [...jobs, ...second.jobs.filter((j) => !have.has(j.key))];
        } catch (err) {
          recordError(rep, err);
          await refused(err, lane2);
        }
      }
      await writeCache("jsearch", combo.comboKey, "in", jobs, now);
    } catch (err) {
      recordError(rep, err);
      error = err instanceof Error ? err.message : "error";
      await refused(err, lane);
    }
    await execute(
      "INSERT INTO search_rotation (source, combo_key, last_queried_at) VALUES ('jsearch', ?, ?) ON DUPLICATE KEY UPDATE last_queried_at = VALUES(last_queried_at)",
      [combo.comboKey, now],
    );
    rep.fetched += jobs.length;
    c.add(jobs);
    c.log({ source: "jsearch", variant: combo.variant, role: combo.role, location: combo.location, query: combo.query, fetched: jobs.length, fromCache: false, error });
  }
  const stops = [ownStop, sharedStop].filter((x): x is string => !!x);
  const parts = ownCalls ? [`${plural(ownCalls, "search", "searches")} with your own key`, ...stops] : stops;
  if (deferred) parts.push(stops.length ? `${deferred} searches left for later runs` : `${deferred} searches rotated to later runs (free quota)`);
  if (parts.length) rep.note = parts.join("; ");
  return rep;
}

export async function collectJobs(pairs: SearchPair[], opts: CollectOptions = {}): Promise<CollectResult> {
  const now = opts.now ?? clock.now();
  const f = features();
  const unique = uniquePairs(pairs);
  const c = new Collector();
  const sources: SourceReport[] = [];
  if (f.mock) {
    sources.push(await collectMock(unique, now, c));
  } else {
    sources.push(f.adzuna ? await collectAdzuna(unique, now, c) : { ...report("adzuna", false), note: "Not configured (add ADZUNA_APP_ID / ADZUNA_APP_KEY)" });
    sources.push(await collectJSearch(unique, now, c, opts));
  }
  return { jobs: [...c.jobs.values()], sources, queries: c.queries };
}

export async function pruneJobCache(now = clock.now()): Promise<void> {
  await execute("DELETE FROM job_cache WHERE fetched_at < ?", [new Date(now.getTime() - 7 * 24 * HOUR)]);
}
