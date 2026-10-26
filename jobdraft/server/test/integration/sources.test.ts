// Real-source code paths (Adzuna, JSearch) with a stubbed fetch: no network,
// no real keys. MOCK_EXTERNAL is switched off only inside these tests.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closePool, execute, query, queryOne } from "../../src/db/pool.js";
import { collectJobs } from "../../src/jobs/fetch.js";
import { sharedBudget } from "../../src/jobs/jsearch-budget.js";
import type { JSearchJob } from "../../src/jobs/jsearch.js";
import { HOUR } from "../../src/lib/clock.js";
import { resetDb, setIst } from "../helpers.js";

const ENV_KEYS = [
  "MOCK_EXTERNAL", "ADZUNA_APP_ID", "ADZUNA_APP_KEY", "RAPIDAPI_KEY", "ADZUNA_DAILY_CAP", "JSEARCH_DAILY_CAP", "JSEARCH_MAX_CALLS_PER_RUN",
  "JSEARCH_MONTHLY_QUOTA", "JSEARCH_RESET_DAY", "JSEARCH_OWN_KEY_MONTHLY_QUOTA",
] as const;
let saved: Record<string, string | undefined> = {};

function setEnv(over: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  Object.assign(process.env, { MOCK_EXTERNAL: "false", ADZUNA_APP_ID: "test-id", ADZUNA_APP_KEY: "test-key", RAPIDAPI_KEY: "test-rapid", ...over });
  for (const [k, v] of Object.entries(over)) if (v === "") delete process.env[k];
}

interface Call {
  host: string;
  path: string;
  params: URLSearchParams;
  /** The RapidAPI key sent (JSearch). */
  key: string | null;
}
type Reply = { status: number; body: unknown } | { dropConnection: true };
let calls: Call[] = [];
let adzunaReply: (p: URLSearchParams) => Reply = () => ({ status: 200, body: { results: [] } });
let jsearchReply: (p: URLSearchParams, key: string | null) => Reply = () => ({ status: 200, body: { status: "OK", data: { jobs: [], cursor: null } } });

beforeEach(async () => {
  await resetDb();
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  calls = [];
  adzunaReply = () => ({ status: 200, body: { results: [] } });
  jsearchReply = () => ({ status: 200, body: { status: "OK", data: { jobs: [], cursor: null } } });
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const key = (init?.headers as Record<string, string> | undefined)?.["X-RapidAPI-Key"] ?? null;
    calls.push({ host: url.host, path: url.pathname, params: url.searchParams, key });
    const r = url.host.includes("adzuna") ? adzunaReply(url.searchParams) : jsearchReply(url.searchParams, key);
    if ("dropConnection" in r) throw new TypeError("fetch failed"); // what Node reports for a dropped connection
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
    expect(capped.sources[1]!.note).toBe("Today's free JSearch searches are used (6 a day, shared by all users); 4 searches left for later runs");

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

/** A user straight in the database: automation on, Gmail connected (what counts as "sharing" the server's JSearch key). */
async function sharer(i: number, opts: { automation?: boolean; ownKeyStatus?: "valid" | "not_subscribed"; inactive?: boolean } = {}): Promise<number> {
  const res = await execute("INSERT INTO users (name, email, password_hash, status) VALUES (?, ?, 'x', ?)", [`User ${i}`, `u${i}@example.org`, opts.inactive ? "inactive" : "active"]);
  const id = res.insertId;
  await execute("INSERT INTO profiles (user_id, automation_enabled, rapidapi_key_enc, rapidapi_key_status) VALUES (?, ?, ?, ?)", [
    id,
    opts.automation === false ? 0 : 1,
    opts.ownKeyStatus ? "encrypted" : null,
    opts.ownKeyStatus ?? null,
  ]);
  await execute("INSERT INTO gmail_connections (user_id, gmail_address, refresh_token_enc, status) VALUES (?, ?, 'enc', 'connected')", [id, `u${i}@gmail.com`]);
  return id;
}

const OK_ONE_JOB: Reply = { status: 200, body: { status: "OK", data: { jobs: [jsJob(1)], cursor: null } } };
const OWN = "own-key-123";

describe("JSearch quota: monthly pacing, fair shares and own keys", () => {
  it("spreads what is left of the month over the days left, so unused searches carry over", async () => {
    setEnv({ ADZUNA_APP_ID: "", ADZUNA_APP_KEY: "", JSEARCH_MONTHLY_QUOTA: "60" });
    const now = setIst("2026-11-21T09:00"); // 10 days left in November, counting today
    expect(await sharedBudget(now)).toMatchObject({ pool: 6, usedThisCycle: 0, daysLeft: 10 });
    await execute("INSERT INTO api_usage (source, day, calls) VALUES ('jsearch', '2026-10-30', 50), ('jsearch', '2026-11-05', 10), ('jsearch', '2026-11-20', 10)");
    // October is another cycle; 20 used in November: (60 − 20) / 10 days.
    expect(await sharedBudget(now)).toMatchObject({ pool: 4, usedThisCycle: 20 });
    // Unused searches aren't lost: the last day of the cycle may use everything left.
    expect((await sharedBudget(setIst("2026-11-30T09:00"))).pool).toBe(40);
    // A reset day other than the 1st (the day the RapidAPI plan was subscribed): Oct 25 → Nov 24.
    process.env.JSEARCH_RESET_DAY = "25";
    expect(await sharedBudget(now)).toMatchObject({ daysLeft: 4, usedThisCycle: 70, pool: 0 });
  });

  it("splits each day's searches equally between active users with automation on", async () => {
    setEnv({ ADZUNA_APP_ID: "", ADZUNA_APP_KEY: "" });
    const a = await sharer(1);
    const b = await sharer(2);
    const handRunner = await sharer(3, { automation: false }); // only joins when they run by hand
    await sharer(4, { ownKeyStatus: "valid" }); // has their own key
    await sharer(5, { inactive: true });
    const now = setIst("2026-11-02T09:00"); // 200 a month, 29 days left → 6 today
    expect(await sharedBudget(now, a)).toMatchObject({ pool: 6, sharers: 2, share: 3 });

    const ra = await collectJobs([PM_PAIRS[0]!], { now, userId: a });
    expect(jsearchCalls()).toHaveLength(3);
    expect(new Set(jsearchCalls().map((c) => c.key))).toEqual(new Set(["test-rapid"]));
    expect(ra.sources[1]!.note).toBe("Your share of today's free JSearch searches is used (3 of 6, shared by 2 users); 2 searches left for later runs");

    calls = [];
    await collectJobs([PM_PAIRS[1]!], { now, userId: b });
    expect(jsearchCalls()).toHaveLength(3);

    // a runs again later: their share is used (the 3 done are answered from the cache).
    calls = [];
    const again = await collectJobs([PM_PAIRS[0]!], { now: new Date(now.getTime() + HOUR), userId: a });
    expect(jsearchCalls()).toHaveLength(0);
    expect(again.sources[1]!.cached).toBe(3);

    // Someone without automation runs by hand: they'd get a share (6 / 3), but today's 6 are used.
    calls = [];
    const rc = await collectJobs([PM_PAIRS[3]!], { now, userId: handRunner });
    expect(jsearchCalls()).toHaveLength(0);
    expect(rc.sources[1]!.note).toMatch(/^Today's free JSearch searches are used \(6 a day, shared by all users\)/);
    expect((await usage("jsearch"))!.calls).toBe(6);
    const perUser = await query<{ user_id: number; calls: number }>("SELECT user_id, calls FROM jsearch_user_usage WHERE own_key = 0 ORDER BY user_id");
    expect(perUser.map((r) => [r.user_id, r.calls])).toEqual([[a, 3], [b, 3], [handRunner, 0]]);
  });

  it("uses the user's own key with its own monthly quota and leaves the shared searches to others", async () => {
    setEnv({ ADZUNA_APP_ID: "", ADZUNA_APP_KEY: "", JSEARCH_OWN_KEY_MONTHLY_QUOTA: "90" });
    const u = await sharer(1, { ownKeyStatus: "valid" });
    const other = await sharer(2);
    const now = setIst("2026-11-02T09:00");
    // Saved today: its cycle runs Nov 2 → Dec 2 (30 days) → 3 a day.
    const res = await collectJobs([PM_PAIRS[0]!], { now, userId: u, ownJSearchKey: { key: OWN, savedAt: now } });
    expect(jsearchCalls().map((c) => c.key)).toEqual([OWN, OWN, OWN]);
    expect(res.sources[1]!.note).toBe(
      "3 searches with your own key; Your JSearch key: today's 3 searches are used (its 90 a month are spread over the month); 2 searches left for later runs",
    );
    expect(await usage("jsearch")).toBeNull(); // the shared key wasn't used
    expect(await sharedBudget(now, other)).toMatchObject({ sharers: 1, share: 6 });
  });

  it("an own key RapidAPI refuses (not subscribed) is flagged for Setup; the run falls back to the shared searches", async () => {
    setEnv({ ADZUNA_APP_ID: "", ADZUNA_APP_KEY: "" });
    const u = await sharer(1, { ownKeyStatus: "valid" });
    jsearchReply = (_p, key) => (key === OWN ? { status: 403, body: { message: "You are not subscribed to this API." } } : OK_ONE_JOB);
    const now = setIst("2026-11-02T09:00");
    const res = await collectJobs([PM_PAIRS[0]!], { now, userId: u, ownJSearchKey: { key: OWN, savedAt: now } });
    expect(jsearchCalls().map((c) => c.key)).toEqual([OWN, "test-rapid", "test-rapid", "test-rapid", "test-rapid"]);
    expect(res.sources[1]!.note).toBe("Your JSearch key isn't subscribed to the free plan yet (see Setup)");
    expect(res.sources[1]!.errors[0]).toEqual({ status: 403, message: "JSearch error 403: You are not subscribed to this API." });
    expect(res.jobs.map((j) => j.key)).toEqual(["jsearch:uid-1"]);
    const p = await queryOne<{ rapidapi_key_status: string }>("SELECT rapidapi_key_status FROM profiles WHERE user_id = ?", [u]);
    expect(p!.rapidapi_key_status).toBe("not_subscribed");
  });

  it("an own key out of monthly searches (HTTP 429) isn't tried again today; the shared searches are used instead", async () => {
    setEnv({ ADZUNA_APP_ID: "", ADZUNA_APP_KEY: "" });
    const u = await sharer(1, { ownKeyStatus: "valid" });
    jsearchReply = (_p, key) => (key === OWN ? { status: 429, body: { message: "You have exceeded the MONTHLY quota" } } : OK_ONE_JOB);
    const now = setIst("2026-11-02T09:00");
    const own = { key: OWN, savedAt: setIst("2026-10-20T10:00") };
    const first = await collectJobs([PM_PAIRS[0]!], { now, userId: u, ownJSearchKey: own });
    expect(jsearchCalls()[0]!.key).toBe(OWN);
    expect(jsearchCalls().slice(1).every((c) => c.key === "test-rapid")).toBe(true);
    expect(first.sources[1]!.note).toBe("Your JSearch key has used this month's free searches");
    calls = [];
    const later = await collectJobs([PM_PAIRS[1]!], { now: new Date(now.getTime() + HOUR), userId: u, ownJSearchKey: own });
    expect(jsearchCalls().length).toBeGreaterThan(0);
    expect(jsearchCalls().every((c) => c.key === "test-rapid")).toBe(true);
    expect(later.sources[1]!.note).toMatch(/^Your JSearch key has no searches left this month/);
  });

  it("a dropped connection ('fetch failed') is retried once, for Adzuna and JSearch, without using another search", async () => {
    setEnv({});
    let a = 0;
    adzunaReply = () => (++a === 1 ? { dropConnection: true } : { status: 200, body: { results: [] } });
    let j = 0;
    jsearchReply = () => (++j === 1 ? { dropConnection: true } : OK_ONE_JOB);
    const res = await collectJobs([PM_PAIRS[0]!], { now: setIst("2026-11-02T09:00") });
    expect(adzunaCalls()).toHaveLength(2); // the one Pune search, retried
    expect(res.sources[0]!.errors).toEqual([]);
    expect(jsearchCalls()).toHaveLength(6); // 5 searches + 1 retry
    expect(res.sources[1]).toMatchObject({ calls: 5, errors: [] });
    expect((await usage("jsearch"))!.calls).toBe(5);
  });

  it("a connection that drops twice is reported, and the next search still runs", async () => {
    setEnv({ RAPIDAPI_KEY: "" });
    adzunaReply = () => ({ dropConnection: true });
    const res = await collectJobs([PM_PAIRS[0]!, PM_PAIRS[1]!], { now: setIst("2026-11-02T09:00") });
    expect(adzunaCalls()).toHaveLength(4);
    expect(res.sources[0]!.errors.map((e) => e.message)).toEqual(["fetch failed", "fetch failed"]);
    expect(res.queries.map((q) => q.error)).toEqual(["fetch failed", "fetch failed"]);
  });
});
