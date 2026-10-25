// Real-source code paths (Adzuna, JSearch) with a stubbed fetch: no network,
// no real keys. MOCK_EXTERNAL is switched off only inside these tests.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closePool, query, queryOne } from "../../src/db/pool.js";
import { collectJobs } from "../../src/jobs/fetch.js";
import type { JSearchJob } from "../../src/jobs/jsearch.js";
import { HOUR } from "../../src/lib/clock.js";
import { resetDb, setIst } from "../helpers.js";

const ENV_KEYS = ["MOCK_EXTERNAL", "ADZUNA_APP_ID", "ADZUNA_APP_KEY", "RAPIDAPI_KEY", "ADZUNA_DAILY_CAP", "JSEARCH_DAILY_CAP", "JSEARCH_MAX_CALLS_PER_RUN"] as const;
let saved: Record<string, string | undefined> = {};

function setEnv(over: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  Object.assign(process.env, { MOCK_EXTERNAL: "false", ADZUNA_APP_ID: "test-id", ADZUNA_APP_KEY: "test-key", RAPIDAPI_KEY: "test-rapid", ...over });
  for (const [k, v] of Object.entries(over)) if (v === "") delete process.env[k];
}

interface Call {
  host: string;
  path: string;
  params: URLSearchParams;
}
let calls: Call[] = [];
let adzunaReply: (p: URLSearchParams) => { status: number; body: unknown } = () => ({ status: 200, body: { results: [] } });
let jsearchReply: (p: URLSearchParams) => { status: number; body: unknown } = () => ({ status: 200, body: { status: "OK", data: { jobs: [], cursor: null } } });

beforeEach(async () => {
  await resetDb();
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  calls = [];
  adzunaReply = () => ({ status: 200, body: { results: [] } });
  jsearchReply = () => ({ status: 200, body: { status: "OK", data: { jobs: [], cursor: null } } });
  vi.stubGlobal("fetch", async (input: string) => {
    const url = new URL(input);
    calls.push({ host: url.host, path: url.pathname, params: url.searchParams });
    const r = url.host.includes("adzuna") ? adzunaReply(url.searchParams) : jsearchReply(url.searchParams);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
afterAll(closePool);

const adzunaCalls = () => calls.filter((c) => c.host.includes("adzuna"));
const jsearchCalls = () => calls.filter((c) => c.host.includes("jsearch"));
const usage = (source: string) => queryOne<{ calls: number; exhausted: number }>("SELECT calls, exhausted FROM api_usage WHERE source = ?", [source]);

const PM_PAIRS = ["Pune, Maharashtra", "Mumbai, Maharashtra", "Remote (India)", "Hyderabad, Telangana", "Bengaluru, Karnataka"].map((location) => ({ role: "Product Manager", location }));

const jsJob = (i: number, over: Partial<JSearchJob> = {}): JSearchJob => ({
  job_id: `id-${i}`,
  job_uid: `uid-${i}`,
  job_title: "Product Manager",
  employer_name: `Startup ${i}`,
  job_apply_link: `https://startup${i}.in/jobs`,
  apply_options: [],
  job_description: "SaaS platform roadmap.",
  job_is_remote: false,
  job_country: "IN",
  job_location: "Pune, Maharashtra",
  job_posted_at_datetime_utc: null,
  job_posted_at_timestamp: null,
  ...over,
});

describe("Adzuna", () => {
  it("queries each main city and remote variants with 7 days / 50 / date, and caches for 6 hours", async () => {
    setEnv({ RAPIDAPI_KEY: "" });
    const now = setIst("2026-11-02T09:00");
    const res = await collectJobs(PM_PAIRS, { now });
    const wheres = adzunaCalls().map((c) => c.params.get("where"));
    expect(wheres).toEqual(["Pune", "Mumbai", null, null, "Hyderabad", "Bengaluru"]);
    for (const c of adzunaCalls()) expect([c.params.get("max_days_old"), c.params.get("results_per_page"), c.params.get("sort_by")]).toEqual(["7", "50", "date"]);
    expect(adzunaCalls().filter((c) => !c.params.get("where")).map((c) => c.params.get("what"))).toEqual(["remote", "work from home"]);
    for (const c of adzunaCalls()) expect(c.params.get("title_only")).toBe("Product Manager");
    expect(res.sources.find((s) => s.source === "adzuna")).toMatchObject({ calls: 6, cached: 0 });
    expect(res.sources.find((s) => s.source === "jsearch")).toMatchObject({ configured: false, note: "Not configured (add RAPIDAPI_KEY)" });
    expect((await usage("adzuna"))!.calls).toBe(6);

    // Another user's run 5 hours later: everything from the cache.
    calls = [];
    const again = await collectJobs(PM_PAIRS, { now: new Date(now.getTime() + 5 * HOUR) });
    expect(adzunaCalls()).toHaveLength(0);
    expect(again.sources[0]).toMatchObject({ calls: 0, cached: 6 });
  });

  it("stops at the daily cap and says so in the funnel", async () => {
    setEnv({ RAPIDAPI_KEY: "", ADZUNA_DAILY_CAP: "4" });
    const res = await collectJobs(PM_PAIRS, { now: setIst("2026-11-02T09:00") });
    expect(adzunaCalls()).toHaveLength(4);
    expect(res.sources[0]!.note).toBe("Daily limit reached (4 calls/day across all users); 2 searches skipped");
    expect((await usage("adzuna"))!.calls).toBe(4);
  });

  it("a busy Adzuna (503) is retried once; after 3 busy searches in a row the rest wait for the next run", async () => {
    setEnv({ RAPIDAPI_KEY: "" });
    let n = 0;
    adzunaReply = () => (++n === 1 ? { status: 503, body: {} } : n === 2 ? { status: 200, body: { results: [] } } : { status: 503, body: {} });
    const res = await collectJobs(PM_PAIRS, { now: setIst("2026-11-02T09:00") });
    // Search 1: 503 then OK on retry. Searches 2–4: 503 twice each → stop.
    expect(adzunaCalls()).toHaveLength(2 + 3 * 2);
    expect(res.sources[0]!.note).toBe("Adzuna is busy (HTTP 503), the remaining searches run next time; 2 searches skipped");
  });

  it("remote searches keep only remote / WFH postings; rejected keys stop further calls", async () => {
    setEnv({ RAPIDAPI_KEY: "" });
    adzunaReply = (p) =>
      p.get("where")
        ? { status: 401, body: { error: "unauthorised" } }
        : {
            status: 200,
            body: {
              results: [
                { id: 1, title: "Product Manager (Remote)", company: { display_name: "A" }, redirect_url: "https://a", location: { display_name: "India" } },
                { id: 2, title: "Product Manager", company: { display_name: "B" }, redirect_url: "https://b", location: { display_name: "Pune" }, description: "Office based" },
              ],
            },
          };
    const remoteFirst = [PM_PAIRS[2]!, PM_PAIRS[0]!, PM_PAIRS[1]!];
    const res = await collectJobs(remoteFirst, { now: setIst("2026-11-02T09:00") });
    expect(res.jobs.map((j) => j.key)).toEqual(["adzuna:1"]); // office posting dropped from the remote search
    expect(adzunaCalls()).toHaveLength(3); // 2 remote + the first city call, which returned 401
    expect(res.sources[0]).toMatchObject({ errors: [{ status: 401, message: "Adzuna error 401" }] });
    expect(res.sources[0]!.note).toMatch(/^Keys rejected \(HTTP 401\)/);
  });
});

describe("JSearch", () => {
  it("sends country=in and date_posted=week, maps data.jobs, and fetches page 2 only for 5+ relevant postings", async () => {
    setEnv({ ADZUNA_APP_ID: "", ADZUNA_APP_KEY: "", JSEARCH_MAX_CALLS_PER_RUN: "3" });
    jsearchReply = (p) =>
      p.get("cursor")
        ? { status: 200, body: { status: "OK", data: { jobs: [jsJob(9)], cursor: null } } }
        : { status: 200, body: { status: "OK", data: { jobs: [1, 2, 3, 4, 5].map((i) => jsJob(i)), cursor: "NEXT" } } };
    const res = await collectJobs([PM_PAIRS[0]!], { now: setIst("2026-11-02T09:00"), isRelevant: () => true });
    const [first, second] = jsearchCalls();
    expect(first!.path).toBe("/search-v2"); // "/search" no longer exists on RapidAPI
    expect(Object.fromEntries(first!.params)).toEqual({ query: "Product Manager in Pune, India", country: "in", date_posted: "week", num_pages: "1", language: "en" });
    expect(second!.params.get("cursor")).toBe("NEXT");
    expect(res.jobs.map((j) => j.key)).toContain("jsearch:uid-9");
    // 2 calls for the plain search (pages 1–2), the 3rd for the next variant (same 5 postings, deduplicated).
    expect(res.sources.find((s) => s.source === "jsearch")).toMatchObject({ calls: 3 });
    expect(jsearchCalls()[2]!.params.get("query")).toBe("Product Manager startup in Pune, India");
    expect(res.jobs).toHaveLength(6);
  });

  it("no page 2 when fewer than 5 postings are relevant", async () => {
    setEnv({ ADZUNA_APP_ID: "", ADZUNA_APP_KEY: "", JSEARCH_MAX_CALLS_PER_RUN: "1" });
    jsearchReply = () => ({ status: 200, body: { status: "OK", data: { jobs: [1, 2, 3, 4, 5].map((i) => jsJob(i)), cursor: "NEXT" } } });
    await collectJobs([PM_PAIRS[0]!], { now: setIst("2026-11-02T09:00"), isRelevant: (j) => j.key.endsWith("1") });
    expect(jsearchCalls().map((c) => c.params.get("cursor"))).toEqual([null]);
  });

  it("tracks usage, respects the daily cap, and rotates (role, city, variant) over runs", async () => {
    setEnv({ ADZUNA_APP_ID: "", ADZUNA_APP_KEY: "", JSEARCH_DAILY_CAP: "6", JSEARCH_MAX_CALLS_PER_RUN: "2" });
    const pairs = [PM_PAIRS[0]!, PM_PAIRS[1]!];
    const day1 = setIst("2026-11-02T09:00");
    const r1 = await collectJobs(pairs, { now: day1 });
    expect(jsearchCalls().map((c) => c.params.get("query"))).toEqual(["Product Manager in Pune, India", "Product Manager in Mumbai, India"]);
    expect(r1.sources[1]!.note).toBe("8 searches rotated to later runs (free quota)");

    // Same day, later run: the first two come from the 12-hour cache; the next two in the rotation are searched.
    calls = [];
    await collectJobs(pairs, { now: new Date(day1.getTime() + HOUR) });
    expect(jsearchCalls().map((c) => c.params.get("query"))).toEqual(["Product Manager startup in Pune, India", "Product Manager startup in Mumbai, India"]);

    calls = [];
    await collectJobs(pairs, { now: new Date(day1.getTime() + 2 * HOUR) });
    expect(jsearchCalls()).toHaveLength(2);
    expect((await usage("jsearch"))!.calls).toBe(6);

    // The daily cap (6) is reached: nothing more today, and the funnel says why.
    calls = [];
    const capped = await collectJobs(pairs, { now: new Date(day1.getTime() + 3 * HOUR) });
    expect(jsearchCalls()).toHaveLength(0);
    expect(capped.sources[1]!.note).toMatch(/^Daily cap reached \(6 calls\/day across all users\)/);

    // Next day: never-searched combinations first (walk-in), then the oldest.
    calls = [];
    await collectJobs(pairs, { now: setIst("2026-11-03T09:00") });
    expect(jsearchCalls().map((c) => c.params.get("query"))).toEqual(["Product Manager send resume Pune", "Product Manager send resume Mumbai"]);
  });

  it("skips gracefully when the key is missing", async () => {
    setEnv({ RAPIDAPI_KEY: "", ADZUNA_APP_ID: "", ADZUNA_APP_KEY: "" });
    const res = await collectJobs([PM_PAIRS[0]!], { now: setIst("2026-11-02T09:00") });
    expect(calls).toHaveLength(0);
    expect(res.jobs).toEqual([]);
    expect(res.sources.map((s) => [s.source, s.configured, s.note])).toEqual([
      ["adzuna", false, "Not configured (add ADZUNA_APP_ID / ADZUNA_APP_KEY)"],
      ["jsearch", false, "Not configured (add RAPIDAPI_KEY)"],
    ]);
  });

  it("an exhausted quota (HTTP 429) stops JSearch for the rest of the day", async () => {
    setEnv({ ADZUNA_APP_ID: "", ADZUNA_APP_KEY: "", JSEARCH_MAX_CALLS_PER_RUN: "4" });
    jsearchReply = () => ({ status: 429, body: { message: "You have exceeded the MONTHLY quota" } });
    const now = setIst("2026-11-02T09:00");
    const res = await collectJobs([PM_PAIRS[0]!], { now });
    expect(jsearchCalls()).toHaveLength(1);
    expect(res.sources[1]!.note).toMatch(/^Quota exhausted \(HTTP 429\), skipped until tomorrow/);
    expect((await usage("jsearch"))!.exhausted).toBe(1);
    calls = [];
    await collectJobs([PM_PAIRS[1]!], { now: new Date(now.getTime() + HOUR) });
    expect(jsearchCalls()).toHaveLength(0);
  });

  it("drops non-India postings and records which variant found each job", async () => {
    setEnv({ ADZUNA_APP_ID: "", ADZUNA_APP_KEY: "", JSEARCH_MAX_CALLS_PER_RUN: "1" });
    jsearchReply = () => ({ status: 200, body: { status: "OK", data: { jobs: [jsJob(1), jsJob(2, { job_country: "US", job_location: "Austin, TX" })], cursor: null } } });
    const res = await collectJobs([PM_PAIRS[0]!], { now: setIst("2026-11-02T09:00") });
    expect(res.jobs.map((j) => [j.key, j.variant])).toEqual([["jsearch:uid-1", "plain"]]);
    const rot = await query<{ combo_key: string }>("SELECT combo_key FROM search_rotation");
    expect(rot.map((r) => r.combo_key)).toEqual(["product manager in pune india"]);
  });
});
