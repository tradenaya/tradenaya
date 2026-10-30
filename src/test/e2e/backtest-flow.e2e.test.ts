import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { NextRequest } from "next/server";
import { loadFixture } from "./sim-exchange";

/**
 * END-TO-END: "Run Backtest" exactly as the page drives it.
 *
 *   POST /api/analytics/backtests  → background job → GET list (polling) → result
 *
 * Real route handlers, real BacktestService + BacktestStore on MySQL (a throw-
 * away schema), real engine, real price download (RestHistoricalDataProvider →
 * MarketDataRestClient → CoinSwitchClient). Only the exchange's HTTP answer is
 * simulated: REAL historical candles (fixtures) in CoinSwitch's response shape,
 * with the behaviours an exchange can have (newest-first, oldest-first,
 * ignoring the time range, rejected keys).
 *
 * Production (Oct 29): the page waited ~60 s and got HTTP 504.
 */
const RUN = process.env.E2E === "1";
const DB_NAME = "tradenaya_bt_e2e";
const H = 3_600_000;

const dbState = vi.hoisted(() => ({ pool: null as null | import("mysql2/promise").Pool }));
vi.mock("@/lib/db", () => {
  const pool = () => {
    if (!dbState.pool) throw new Error("e2e: database used before setup");
    return dbState.pool;
  };
  const db = { query: (...a: unknown[]) => (pool().query as (...x: unknown[]) => unknown)(...a), execute: (...a: unknown[]) => (pool().execute as (...x: unknown[]) => unknown)(...a) };
  return { db, getDb: () => db };
});
vi.mock("@/lib/auth", () => ({ getCustomerFromRequest: () => ({ customerId: 1 }) }));

type Mode = "newest" | "oldest" | "ignoreRange" | "rejectKeys";
const exchange = { mode: "newest" as Mode, klineCalls: 0, delayMs: 0 };

function localEnv() {
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return env;
}

/** Real candles per interval (minutes), oldest first. */
function buildSeries() {
  const rows = loadFixture();
  const out: Record<string, Record<number, { t: number; o: number; h: number; l: number; c: number; v: number }[]>> = {};
  for (const [symbol, list] of Object.entries(rows)) {
    const h1 = list.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }));
    const h4: typeof h1 = [];
    for (const c of h1) {
      const start = Math.floor(c.t / (4 * H)) * 4 * H;
      const last = h4[h4.length - 1];
      if (last && last.t === start) { last.h = Math.max(last.h, c.h); last.l = Math.min(last.l, c.l); last.c = c.c; last.v += c.v; }
      else h4.push({ ...c, t: start });
    }
    out[symbol] = { 60: h1, 240: h4 };
  }
  return out;
}

describe.skipIf(!RUN)("END-TO-END: Run Backtest from the page (background job, real storage, real download code)", () => {
  let series: ReturnType<typeof buildSeries>;
  let NOW = 0;
  let routes: typeof import("@/app/api/analytics/backtests/route");
  let detail: typeof import("@/app/api/analytics/backtests/[id]/route");

  beforeAll(async () => {
    const env = localEnv();
    const admin = await mysql.createConnection({ host: "127.0.0.1", port: Number(env.DB_PORT ?? 3306), user: env.DB_USER, password: env.DB_PASSWORD });
    await admin.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``);
    await admin.query(`CREATE DATABASE \`${DB_NAME}\``);
    await admin.end();
    dbState.pool = mysql.createPool({ host: "127.0.0.1", port: Number(env.DB_PORT ?? 3306), user: env.DB_USER, password: env.DB_PASSWORD, database: DB_NAME, timezone: "Z", connectionLimit: 5 });

    series = buildSeries();
    // "Now" = just after the last real candle; the page's "To = today" then means tonight 23:59 (the future).
    NOW = series.BTCUSDT[60].at(-1)!.t + H + 25 * 60_000;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);

    // The exchange: answers /futures/klines like CoinSwitch (strings, start_time/o/h/l/c/v).
    const { coinswitchClient } = await import("@/automation/executor/client");
    const client = coinswitchClient as unknown as { send: unknown; options: Record<string, unknown> };
    client.options.retryDelayMs = 1;
    client.send = async (_method: string, endpoint: string, params: Record<string, unknown>) => {
      if (endpoint !== "/futures/klines") throw Object.assign(new Error(`not simulated: ${endpoint}`), { httpStatus: 404 });
      exchange.klineCalls++;
      if (exchange.delayMs) await new Promise((r) => setTimeout(r, exchange.delayMs));
      if (exchange.mode === "rejectKeys") throw Object.assign(new Error("Invalid access"), { httpStatus: 401 });
      const all = (series[String(params.symbol).toUpperCase()]?.[Number(params.interval)] ?? []).filter((c) => c.t + Number(params.interval) * 60_000 <= Date.now());
      const limit = Number(params.limit) || 100;
      const start = params.start_time != null ? Number(params.start_time) : -Infinity;
      const end = params.end_time != null ? Number(params.end_time) : Infinity;
      let rows = exchange.mode === "ignoreRange" ? all.slice(-limit) : all.filter((c) => c.t >= start && c.t <= end);
      if (exchange.mode === "newest") rows = rows.slice(-limit);
      if (exchange.mode === "oldest") rows = rows.slice(0, limit);
      return { data: rows.map((c) => ({ start_time: c.t, o: String(c.o), h: String(c.h), l: String(c.l), c: String(c.c), v: String(c.v) })) };
    };

    const { BacktestStore } = await import("@/automation/backtest/store");
    await (new BacktestStore() as unknown as { ensureTables(): Promise<void> }).ensureTables();
    routes = await import("@/app/api/analytics/backtests/route");
    detail = await import("@/app/api/analytics/backtests/[id]/route");
  });

  afterAll(async () => {
    vi.useRealTimers();
    await dbState.pool?.end().catch(() => null);
  });

  /** What the page sends: From = N days ago 00:00, To = TODAY 23:59:59.999 (as the old form did). */
  const pageConfig = (over: Record<string, unknown> = {}) => {
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    return {
      symbol: "BTCUSDT", strategy: "TradenayaSmartV1", timeframe: "1h",
      startTime: new Date(`${day(NOW - 45 * 24 * H)}T00:00:00.000Z`).getTime(),
      endTime: new Date(`${day(NOW)}T23:59:59.999Z`).getTime(),
      initialCapital: 100, capitalMode: "fixed", leverage: 5, riskStyle: "SAFE", maxRiskPerTrade: 5, dailyLossLimit: 30,
      enableTrailingStop: false, trailingDistancePercent: 0, momentumEntriesOnly: false, ...over,
    };
  };
  const post = async (body: unknown) => {
    const t0 = performance.now();
    const res = await routes.POST(new NextRequest("http://localhost/api/analytics/backtests", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
    return { status: res.status, json: await res.json(), ms: performance.now() - t0 };
  };
  const list = async () => (await (await routes.GET(new NextRequest("http://localhost/api/analytics/backtests?limit=50"))).json()).data as Array<Record<string, unknown>>;
  /** Poll the list like the page does until the backtest is no longer RUNNING. */
  const waitFor = async (id: number, maxMs = 300_000) => {
    const seen: string[] = [];
    const t0 = performance.now();
    for (;;) {
      const row = (await list()).find((b) => b.id === id)!;
      const label = row.status === "RUNNING" ? (row.progressPct != null ? `Running ${row.progressPct}%` : "Loading prices…") : String(row.status);
      if (seen.at(-1) !== label) seen.push(label);
      if (row.status !== "RUNNING" && row.status !== "QUEUED") return { row, seen, ms: performance.now() - t0 };
      if (performance.now() - t0 > maxMs) throw new Error(`backtest ${id} still ${label} after ${maxMs} ms`);
      await new Promise((r) => setTimeout(r, 150));
    }
  };

  it("Smart 1h, 45 days, To = today: returns at once, shows progress, completes with trades", async () => {
    exchange.mode = "newest";
    exchange.klineCalls = 0;
    const started = await post(pageConfig());
    expect(started.status).toBe(200);
    expect(started.json.data.status).toBe("RUNNING");
    expect(started.ms).toBeLessThan(3000); // was: the whole backtest inside the request → 504 after 60 s
    const done = await waitFor(started.json.data.id);
    console.log(`  smart 1h: POST ${started.ms.toFixed(0)} ms · states ${done.seen.join(" → ")} · ${done.row.tradeCount} trades · return ${Number(done.row.totalReturnPct).toFixed(2)}% · ${exchange.klineCalls} price requests`);
    expect(done.row.status).toBe("COMPLETED");
    expect(done.seen.some((s) => s.startsWith("Running"))).toBe(true);
    expect(Number(done.row.endTime)).toBeLessThanOrEqual(NOW); // never asked for the future
    // the detail view (what clicking the row opens) has the trades and equity curve
    const res = await detail.GET(new NextRequest(`http://localhost/api/analytics/backtests/${started.json.data.id}`), { params: Promise.resolve({ id: String(started.json.data.id) }) });
    const d = (await res.json()).data;
    expect(d.trades.length).toBe(Number(done.row.tradeCount));
    expect(d.equityCurve.length).toBeGreaterThan(100);
  });

  it("Trend Breakout 4h (needs ~50 days of warm-up), Risky: completes", async () => {
    exchange.mode = "newest";
    const started = await post(pageConfig({ strategy: "TrendBreakoutV1", timeframe: "1h", riskStyle: "RISKY", maxRiskPerTrade: 1, dailyLossLimit: 60, startTime: NOW - 20 * 24 * H }));
    expect(started.json.data.timeframe).toBe("4h"); // the strategy's fixed timeframe is enforced
    const done = await waitFor(started.json.data.id);
    console.log(`  breakout 4h risky: ${done.seen.join(" → ")} · ${done.row.tradeCount} trades · return ${Number(done.row.totalReturnPct).toFixed(2)}%`);
    expect(done.row.status).toBe("COMPLETED");
  });

  it("an exchange that returns the OLDEST candles of a range still works", async () => {
    exchange.mode = "oldest";
    exchange.klineCalls = 0;
    const started = await post(pageConfig({ symbol: "ETHUSDT" }));
    const done = await waitFor(started.json.data.id);
    console.log(`  oldest-first exchange: ${done.seen.join(" → ")} · ${exchange.klineCalls} price requests · ${done.row.tradeCount} trades`);
    expect(done.row.status).toBe("COMPLETED");
  });

  it("expired API keys: fails quickly with the real reason, not 'no data'", async () => {
    exchange.mode = "rejectKeys";
    exchange.klineCalls = 0;
    const started = await post(pageConfig());
    const done = await waitFor(started.json.data.id, 30_000);
    console.log(`  rejected keys: ${done.seen.join(" → ")} · "${done.row.errorMessage}"`);
    expect(done.row.status).toBe("FAILED");
    expect(String(done.row.errorMessage)).toMatch(/API keys may have expired/);
    expect(exchange.klineCalls).toBeLessThanOrEqual(2); // no second full download
  });

  it("an exchange that ignores the date range: a clear message after ONE download", async () => {
    exchange.mode = "ignoreRange";
    exchange.klineCalls = 0;
    const started = await post(pageConfig());
    const done = await waitFor(started.json.data.id, 60_000);
    console.log(`  range ignored: "${done.row.errorMessage}" · ${exchange.klineCalls} price requests`);
    expect(done.row.status).toBe("FAILED");
    expect(String(done.row.errorMessage)).toMatch(/does not extend back/);
    expect(exchange.klineCalls).toBeLessThan(10);
  });

  it("a start date in the future is refused at once", async () => {
    const r = await post(pageConfig({ startTime: NOW + 24 * H, endTime: NOW + 48 * H }));
    expect(r.status).toBe(400);
    expect(r.json.message).toMatch(/start date must be in the past/);
  });

  it("2 at a time: a third is refused with a clear message; free again once one finishes", async () => {
    exchange.mode = "newest";
    exchange.delayMs = 40; // slower exchange so the first two are still running
    const a = await post(pageConfig());
    const b = await post(pageConfig({ symbol: "ETHUSDT" }));
    const c = await post(pageConfig({ symbol: "XRPUSDT" }));
    expect(a.json.data.status).toBe("RUNNING");
    expect(b.json.data.status).toBe("RUNNING");
    expect(c.status).toBe(409);
    expect(c.json.message).toMatch(/already have 2 backtests in progress/);
    exchange.delayMs = 0;
    await waitFor(a.json.data.id);
    await waitFor(b.json.data.id);
    const d = await post(pageConfig({ symbol: "XRPUSDT" }));
    expect(d.json.data.status).toBe("RUNNING");
    await waitFor(d.json.data.id);
  });

  it("a backtest cut off by a server restart is shown as stopped and no longer blocks", async () => {
    // rows a previous server process left RUNNING (written straight to the real table)
    for (const symbol of ["BTCUSDT", "ETHUSDT"]) {
      await dbState.pool!.query(
        "INSERT INTO automation_backtests (user_id, symbol, timeframe, start_time, end_time, initial_capital, status) VALUES (1, ?, '1h', 1, 2, 100, 'RUNNING')",
        [symbol],
      );
    }
    const rows = await list();
    const orphans = rows.filter((r) => r.symbol !== undefined && Number(r.startTime) === 1);
    expect(orphans.length).toBe(2);
    expect(orphans.every((r) => r.status === "FAILED" && /server restarted/.test(String(r.errorMessage)))).toBe(true);
    const next = await post(pageConfig());
    expect(next.json.data.status).toBe("RUNNING");
    await waitFor(next.json.data.id);
  });

  it("the server keeps answering other requests while a long backtest simulates", async () => {
    exchange.mode = "newest";
    const started = await post(pageConfig({ startTime: NOW - 70 * 24 * H }));
    expect(started.ms).toBeLessThan(1000); // warm: starting is instant
    const latencies: number[] = [];
    let status = "RUNNING";
    while (status === "RUNNING") {
      const t0 = performance.now();
      const row = (await list()).find((b) => b.id === started.json.data.id)!;
      latencies.push(performance.now() - t0);
      status = String(row.status);
      await new Promise((r) => setTimeout(r, 100));
    }
    const worst = Math.max(...latencies);
    console.log(`  responsiveness: ${latencies.length} list requests while it ran · slowest ${worst.toFixed(0)} ms · POST ${started.ms.toFixed(0)} ms`);
    expect(status).toBe("COMPLETED");
    expect(latencies.length).toBeGreaterThan(5);
    expect(worst).toBeLessThan(1000); // before: other requests waited for the whole simulation
  });

  it("deleting a finished backtest removes it from the list", async () => {
    const id = Number((await list()).find((b) => b.status === "COMPLETED")!.id);
    const res = await detail.DELETE(new NextRequest(`http://localhost/api/analytics/backtests/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id: String(id) }) });
    expect(res.status).toBe(200);
    expect((await list()).some((b) => b.id === id)).toBe(false);
  });
});
