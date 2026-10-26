/**
 * END-TO-END trading simulation — the whole production trading path, for weeks
 * of market time, against an unreliable exchange.
 *
 * Runs the REAL production singletons (scheduler cycle runner, strategy engine,
 * coin auto-selector, risk manager, order executor, position monitor, trailing
 * stops, CoinSwitch client incl. its retry logic) on a REAL MySQL database (a
 * local throw-away schema). Only the outside world is simulated: the exchange
 * (paper exchange + CoinSwitch instrument rules + injected faults) and the
 * market (real historical 1h candles, replayed on a fake clock).
 *
 * After EVERY simulated hour it checks the safety invariants that matter for
 * real money: every open position has exactly one stop-loss on the exchange,
 * no orphan exchange positions, no two bots on one coin, bots never stuck or in
 * ERROR, the wallet never negative. At the end: trades really happened, every
 * closed trade is fully accounted, and P&L ties to the wallet.
 *
 * Opt-in (needs a local MySQL; takes a few minutes):  npm run test:e2e
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { NO_FAULTS, SimExchange, SimMarket, loadFixture, type FaultRates } from "./sim-exchange";

const RUN = process.env.E2E === "1";
const H = 3_600_000;
const USER = 1;

// ------------------------------------------------- isolated test database ----
// Runs BEFORE any import: every module that touches the database (stores, the
// paper store, ...) must only ever see the throw-away e2e schema — never the
// developer's database. Every query is also checked against the schema name.
const e2eDb = vi.hoisted(() => {
  const name = process.env.E2E_DB_NAME ?? "tradenaya_e2e";
  if (!/e2e/i.test(name)) throw new Error(`refusing to run the e2e simulation against "${name}" — its name must contain "e2e"`);
  process.env.DB_HOST = "127.0.0.1";
  process.env.DB_PORT = process.env.E2E_DB_PORT ?? process.env.DB_PORT ?? "3306";
  process.env.DB_NAME = name;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const state: { pool: any } = { pool: null };
  const guard = (sql: string) => {
    if (/\b(DROP|CREATE)\s+DATABASE\b/i.test(sql) && !sql.includes(name)) throw new Error("e2e: refusing a database-level statement outside the e2e schema");
  };
  // NOW() / CURRENT_TIMESTAMP follow the simulated clock (SET TIMESTAMP per query).
  const run = async (kind: "query" | "execute", sql: string, params?: unknown) => {
    guard(sql);
    if (!state.pool) throw new Error("e2e: database used before the scenario created it");
    const c = await state.pool.getConnection();
    try {
      const [[db]] = await c.query("SELECT DATABASE() AS db");
      if (db.db !== name) throw new Error(`e2e: connected to "${db.db}", expected "${name}"`);
      await c.query("SET TIMESTAMP = ?", [Date.now() / 1000]);
      return await c[kind](sql, params);
    } finally {
      c.release();
    }
  };
  (globalThis as { __tradeNayaDb?: unknown }).__tradeNayaDb = {
    query: (sql: string, params?: unknown) => run("query", sql, params),
    execute: (sql: string, params?: unknown) => run("execute", sql, params),
  };
  return { name, state };
});

// ---------------------------------------------------------------- mocks ----
const sim = vi.hoisted(() => ({
  market: null as unknown as SimMarket,
  exchange: null as unknown as SimExchange,
  alerts: [] as { type: string; text: string; at: number; stopOnExchange: boolean | null }[],
}));

vi.mock("@/automation/market/service", () => {
  const minutesOf = (tf: string) => {
    const m = String(tf).match(/^(\d+)\s*([mhd]?)$/i);
    if (!m) return 60;
    const n = Number(m[1]);
    return m[2]?.toLowerCase() === "h" ? n * 60 : m[2]?.toLowerCase() === "d" ? n * 1440 : n;
  };
  const service = {
    start: async () => {},
    stop: async () => {},
    getDetailedHealth: () => ({}),
    adapterFor: () => ({ getSnapshot: async (symbol: string, tf: string) => sim.market.snapshot(symbol, tf, minutesOf(tf), Date.now()) }),
    getSnapshot: async (_u: number, symbol: string, tf: string) => sim.market.snapshot(symbol, tf, minutesOf(tf), Date.now()),
    getCandles: async (_u: number, symbol: string, tf: string, opts: { limit?: number } = {}) => sim.market.closed(symbol, minutesOf(tf), Date.now(), opts.limit ?? 300),
  };
  return { serverMarketDataService: service, ServerMarketDataService: class {} };
});
vi.mock("@/lib/coinswitch.store", async (orig) => ({
  ...(await orig<object>()),
  getKeysForUser: async () => ({ apiKey: "sim", apiSecret: "sim", status: "A" }),
}));
vi.mock("@/lib/telegram-dispatch", () => ({
  dispatchTelegram: async (_key: string, type: string, text: string) => {
    // Was the stop-loss REALLY missing on the exchange when the alert fired? (a real alert vs a false alarm)
    const symbol = String(text).match(/[A-Z0-9]+USDT/)?.[0] ?? null;
    const alert: (typeof sim.alerts)[number] = { type, text, at: Date.now(), stopOnExchange: null };
    sim.alerts.push(alert);
    if (symbol && sim.exchange) {
      const open = await sim.exchange.store.listOrders(1, { status: "OPEN" });
      alert.stopOnExchange = open.some((o) => o.symbol === symbol && o.orderType === "STOP_MARKET");
    }
    return { sent: true };
  },
  ensureTelegramSentTable: async () => {},
}));

// ------------------------------------------------------------- database ----
function localDbEnv() {
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return { host: "127.0.0.1", port: Number(process.env.DB_PORT ?? 3306), user: env.DB_USER, password: env.DB_PASSWORD, database: e2eDb.name };
}


// ------------------------------------------------------------- scenario ----
interface BotSpec { name: string; body: Record<string, unknown> }

const BOTS: BotSpec[] = [
  { name: "Breakout Majors", body: { strategy: "TrendBreakoutV1", timeframe: "4h", coinUniverse: "MAJORS", maxRiskPerTrade: 1, dailyLossLimit: 10 } },
  { name: "Breakout Top", body: { strategy: "TrendBreakoutV1", timeframe: "4h", coinUniverse: "TOP_VOLUME", maxRiskPerTrade: 1, dailyLossLimit: 10 } },
  { name: "Smart Top (momentum only)", body: { strategy: "TradenayaSmartV1", timeframe: "1h", coinUniverse: "TOP_VOLUME", maxRiskPerTrade: 5, dailyLossLimit: 30, momentumEntriesOnly: true } },
  { name: "Smart Majors", body: { strategy: "TradenayaSmartV1", timeframe: "1h", coinUniverse: "MAJORS", maxRiskPerTrade: 5, dailyLossLimit: 30, momentumEntriesOnly: false } },
];

interface RunResult {
  hours: number;
  violations: string[];
  entries: number;
  closed: { symbol: string; exit_reason: string | null; realized_pnl: string | null }[];
  startBalance: number;
  endBalance: number;
  openAtEnd: number;
  botStates: Record<string, string>;
  unprotectedAlerts: number;
  alerts: string[];
  maxMarginByBot: Record<string, number>;
  stopMoves: number;
  btcEntries: number;
  injected: SimExchange["stats"]["injected"];
  reasons: Record<string, number>;
}

async function runScenario(opts: { label: string; balance: number; days: number; faults: FaultRates; seed: number; restartAtHalf: boolean; bots?: BotSpec[] }): Promise<RunResult> {
  const conn = localDbEnv();
  // fresh schema
  const admin = await mysql.createConnection({ host: conn.host, port: conn.port, user: conn.user, password: conn.password });
  await admin.query(`DROP DATABASE IF EXISTS \`${conn.database}\``);
  await admin.query(`CREATE DATABASE \`${conn.database}\``);
  await admin.end();
  if (e2eDb.state.pool) await e2eDb.state.pool.end().catch(() => null);
  const pool = mysql.createPool({ ...conn, timezone: "Z", connectionLimit: 4 });
  e2eDb.state.pool = pool;

  const market = new SimMarket(loadFixture());
  sim.market = market;
  sim.alerts = [];
  // E2E_NO_FAULTS=1: same scenario on a perfectly reliable exchange (deterministic comparisons)
  const exchange = new SimExchange(market, { seed: opts.seed, faults: process.env.E2E_NO_FAULTS === "1" ? NO_FAULTS : opts.faults });
  sim.exchange = exchange;
  await exchange.setBalance(USER, opts.balance);

  // Warm-up so Trend Breakout has its 221 x 4h candles (~37 days) of history.
  const start = market.first() + 40 * 24 * H;
  const end = Math.min(market.last(), start + opts.days * 24 * H);
  vi.setSystemTime(start);

  const { coinswitchClient } = await import("@/automation/executor/client");
  const client = coinswitchClient as unknown as { send: unknown; options: Record<string, unknown> };
  client.send = exchange.send;
  client.options.retryDelayMs = 1;
  const { orderExecutor } = await import("@/automation/executor/order-executor");
  const lifecycleOpts = (orderExecutor as unknown as { lifecycle: { options: Record<string, unknown> } }).lifecycle.options;
  lifecycleOpts.statusPollIntervalMs = 1;
  lifecycleOpts.statusPollAttempts = 2;
  const { ensureTables } = await import("@/automation/position/bootstrap");
  await ensureTables();
  const { BotLifecycleService } = await import("@/automation/service/bot-lifecycle");
  const { BotScheduler } = await import("@/automation/scheduler/BotScheduler");
  const { PositionMonitor } = await import("@/automation/position/PositionMonitor");
  const { runWithTradingMode } = await import("@/automation/paper/mode");
  const { sanitizeConfig } = await import("@/app/api/bots/_helpers");
  const { resetCoinListCache } = await import("@/automation/coinauto/auto-best-selector");
  resetCoinListCache();

  const lifecycle = new BotLifecycleService();
  const botIds: number[] = [];
  for (const spec of opts.bots ?? BOTS) {
    const config = sanitizeConfig({
      symbol: "BTCUSDT", leverage: 10, leverageMode: "auto", autoSelect: true, capital: opts.balance, capitalMode: "percent", walletPercent: 100,
      enableTrailingStop: false, name: spec.name, ...spec.body,
    });
    const id = await lifecycle.createBot({ userId: USER, symbol: "AUTO", strategy: config.strategy!, leverage: config.leverage, capital: opts.balance, capitalMode: "percent", walletPercent: 100, name: spec.name, status: "RUNNING", tradingMode: "LIVE" });
    await lifecycle.setConfig(id, JSON.stringify({ ...config, tradingMode: "LIVE" }));
    await lifecycle.updateDesiredStatus(id, "RUNNING");
    botIds.push(id);
  }

  let scheduler = new BotScheduler({});
  // As at server start (PositionMonitor.start), minus the 5 s timer: the
  // simulation drives each tick itself.
  const startMonitor = () => {
    const m = new PositionMonitor(coinswitchClient);
    (m as unknown as { running: boolean }).running = true;
    return m;
  };
  let monitor = startMonitor();
  const cycles = () => (scheduler as unknown as { cycles: { runCycle(id: number): Promise<{ message?: string }> } }).cycles;
  const monitorPass = async () => {
    await runWithTradingMode("LIVE", () => monitor.tick());
    const processing = (monitor as unknown as { processing: Set<number> }).processing;
    for (let i = 0; i < 2000 && processing.size > 0; i++) await new Promise((r) => setTimeout(r, 1));
  };
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pool.query(sql, params))[0] as T[];

  const violations: string[] = [];
  const reasons: Record<string, number> = {};
  const unprotectedSince = new Map<string, number>();
  let hours = 0;
  const half = start + Math.floor((end - start) / 2 / H) * H;

  for (let t = start; t < end; t += H) {
    // Exactly at the hourly close: orders placed now see the very next candle
    // (an order only fills on candles that start after it was placed).
    vi.setSystemTime(t);
    hours++;

    if (opts.restartAtHalf && t === half) {
      // Simulated server restart: fresh instances, the production recovery sweeps.
      scheduler = new BotScheduler({});
      monitor = startMonitor();
      await runWithTradingMode("LIVE", () => (monitor as unknown as { recovery: { recoverAllActive(): Promise<unknown> } }).recovery.recoverAllActive());
      await runWithTradingMode("LIVE", () => (scheduler as unknown as { recovery: { recoverAll(): Promise<void> } }).recovery.recoverAll());
    }

    for (const id of botIds) {
      const r = await runWithTradingMode("LIVE", () => cycles().runCycle(id));
      const key = String(r?.message ?? "").replace(/[A-Z0-9]+USDT/g, "SYM").replace(/\d+(\.\d+)?/g, "#").slice(0, 110);
      reasons[key] = (reasons[key] ?? 0) + 1;
    }
    await monitorPass();
    await monitorPass();

    // ------------------------------------------------ invariants, every hour
    const exPositions = await exchange.store.listPositions(USER);
    const exOrders = await exchange.store.listOrders(USER, { status: "OPEN" });
    const dbActive = await q<{ id: number; symbol: string; state: string; bot_id: number }>(
      "SELECT id, symbol, state, bot_id FROM automation_positions WHERE state IN ('ENTRY_EXECUTED','PROTECTED','TRAILING','UNPROTECTED','CLOSING')",
    );
    const when = new Date(t).toISOString().slice(0, 13);

    // (1) every exchange position has exactly one stop-loss (allow one hour to repair)
    for (const p of exPositions) {
      const stops = exOrders.filter((o) => o.symbol === p.symbol && o.orderType === "STOP_MARKET" && o.reduceOnly);
      if (stops.length !== 1) {
        const since = unprotectedSince.get(p.symbol) ?? t;
        unprotectedSince.set(p.symbol, since);
        if (t - since >= H) violations.push(`${when} ${p.symbol}: ${stops.length} stop-loss orders for an open position (for ${(t - since) / H + 1}h)`);
      } else unprotectedSince.delete(p.symbol);
    }
    // (2) no orphan: every exchange position is tracked by an active DB position
    for (const p of exPositions) {
      if (!dbActive.some((d) => d.symbol.toUpperCase() === p.symbol.toUpperCase())) violations.push(`${when} ${p.symbol}: open on the exchange but not tracked by any bot`);
    }
    // (3) never two bots on one coin
    const bySymbol = new Map<string, number>();
    for (const d of dbActive) bySymbol.set(d.symbol.toUpperCase(), (bySymbol.get(d.symbol.toUpperCase()) ?? 0) + 1);
    for (const [s, n] of bySymbol) if (n > 1) violations.push(`${when} ${s}: ${n} bots hold positions on the same coin`);
    // (4) DB says open but the exchange is flat for over an hour → monitor failed to close it
    for (const d of dbActive) {
      if (!exPositions.some((p) => p.symbol.toUpperCase() === d.symbol.toUpperCase())) {
        const key = `db:${d.id}`;
        const since = unprotectedSince.get(key) ?? t;
        unprotectedSince.set(key, since);
        if (t - since >= 2 * H) violations.push(`${when} position ${d.id} ${d.symbol} still open in the DB ${(t - since) / H}h after the exchange position closed`);
      } else unprotectedSince.delete(`db:${d.id}`);
    }
    // (5) bots never in ERROR or stuck mid-cycle
    const bots = await q<{ id: number; status: string; last_error: string | null }>("SELECT id, status, last_error FROM automation_bots");
    for (const b of bots) {
      if (["ERROR", "ANALYZING", "TRADE_PLANNED"].includes(b.status)) violations.push(`${when} bot ${b.id} is ${b.status}${b.last_error ? ` (${b.last_error})` : ""}`);
    }
    // (6) wallet never negative
    const snap = await exchange.paper.snapshot(USER);
    if (snap.available < -1e-6) violations.push(`${when} wallet available is negative: ${snap.available}`);
  }

  const closed = await q<{ symbol: string; exit_reason: string | null; realized_pnl: string | null; bot_id: number }>("SELECT symbol, exit_reason, realized_pnl, bot_id FROM automation_positions WHERE state = 'CLOSED' AND entry_price IS NOT NULL ORDER BY id");
  // (7) no losing trade may lose much more than the risk it was sized for
  const sized = await q<{ id: number; symbol: string; filled_quantity: string; entry_price: string; plan_sl: string; realized_pnl: string; fees: string | null }>(
    "SELECT p.id, p.symbol, p.filled_quantity, p.entry_price, e.stop_loss plan_sl, p.realized_pnl, p.fees FROM automation_positions p JOIN automation_executions e ON e.id = p.execution_id WHERE p.state = 'CLOSED' AND p.realized_pnl < 0 AND p.filled_quantity > 0",
  );
  for (const r of sized) {
    const risk = Math.abs(Number(r.entry_price) - Number(r.plan_sl)) * Number(r.filled_quantity);
    const loss = -Number(r.realized_pnl) - Number(r.fees ?? 0);
    if (loss > 2 * risk + 0.01) violations.push(`position ${r.id} ${r.symbol}: lost ${loss.toFixed(3)} USDT before fees, planned risk was ${risk.toFixed(3)} USDT`);
  }
  const entries = (await q<{ n: number }>("SELECT COUNT(*) n FROM automation_positions WHERE entry_price IS NOT NULL AND filled_quantity > 0"))[0].n;
  // Largest margin any bot put into one filled trade (RISKY bots should use ~the whole free wallet).
  const marginRows = await q<{ name: string; margin: string }>(
    "SELECT b.name, MAX(p.filled_quantity * p.entry_price / p.leverage) margin FROM automation_positions p JOIN automation_bots b ON b.id = p.bot_id WHERE p.filled_quantity > 0 AND p.entry_price IS NOT NULL GROUP BY b.name",
  );
  const maxMarginByBot = Object.fromEntries(marginRows.map((m) => [m.name, Number(m.margin)]));
  const btcEntries = (await q<{ n: number }>("SELECT COUNT(*) n FROM automation_positions WHERE symbol = 'BTCUSDT' AND filled_quantity > 0"))[0].n;
  const stopMoves = (await q<{ n: number }>("SELECT COUNT(*) n FROM automation_position_events WHERE type = 'TRAILING_MOVED'"))[0].n;
  const states = await q<{ name: string; status: string }>("SELECT name, status FROM automation_bots");
  const wallet = await exchange.store.getWallet(USER);
  const openAtEnd = (await exchange.store.listPositions(USER)).length;
  return {
    hours,
    violations,
    entries: Number(entries),
    closed,
    startBalance: opts.balance,
    endBalance: wallet?.balance ?? opts.balance,
    openAtEnd,
    botStates: Object.fromEntries(states.map((s) => [s.name, s.status])),
    unprotectedAlerts: sim.alerts.filter((a) => a.type === "POSITION_UNPROTECTED" && a.stopOnExchange !== false).length,
    alerts: sim.alerts.filter((a) => a.type === "POSITION_UNPROTECTED").map((a) => `${new Date(a.at).toISOString().slice(0, 16)} stop on exchange: ${a.stopOnExchange} — ${String(a.text).replace(/\s+/g, " ").slice(0, 200)}`),
    stopMoves: Number(stopMoves),
    maxMarginByBot,
    btcEntries: Number(btcEntries),
    injected: exchange.stats.injected,
    reasons,
  };
}

function report(label: string, r: RunResult) {
  const pnl = r.closed.reduce((a, c) => a + Number(c.realized_pnl ?? 0), 0);
  const top = Object.entries(r.reasons).sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(
    `\n===== ${label}: ${r.hours} simulated hours =====\n` +
      `entries ${r.entries} (BTC ${r.btcEntries}) · closed ${r.closed.length} · open at end ${r.openAtEnd} · stop moves ${r.stopMoves}\n` +
      `wallet ${r.startBalance} → ${r.endBalance.toFixed(4)} USDT · closed-trade P&L ${pnl.toFixed(4)} USDT\n` +
      `injected faults: ${JSON.stringify(r.injected)} · false "unprotected" alerts: ${r.unprotectedAlerts}\n` +
      `bot states: ${JSON.stringify(r.botStates)}\n` +
      `largest margin per trade: ${JSON.stringify(Object.fromEntries(Object.entries(r.maxMarginByBot).map(([k, v]) => [k, Number(v.toFixed(2))])))}\n` +
      `"unprotected" alerts sent: ${r.alerts.length}${r.alerts.length ? "\n  " + r.alerts.join("\n  ") : ""}\n` +
      `violations: ${r.violations.length}${r.violations.length ? "\n  " + r.violations.slice(0, 15).join("\n  ") : ""}\n` +
      `most common cycle outcomes:\n  ${top.map(([k, n]) => `${n}× ${k}`).join("\n  ")}`,
  );
}

describe.skipIf(!RUN)("END-TO-END: production trading path on a simulated, unreliable exchange", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it("normal wallet (500 USDT), 4 bots sharing 100%, flaky exchange, restart halfway", async () => {
    const r = await runScenario({ label: "500 USDT", balance: 500, days: Number(process.env.E2E_DAYS ?? 30), seed: 7, restartAtHalf: true, faults: { readTimeout: 0.15, placeFailure: 0.03, cancelFailure: 0.05 } });
    report("500 USDT · faults · restart", r);
    expect(r.violations).toEqual([]);
    expect(r.entries).toBeGreaterThanOrEqual(3); // the bots DO trade
    expect(r.unprotectedAlerts).toBe(0); // no false "no stop-loss" alerts despite 15% failed reads
    for (const c of r.closed) {
      expect(c.exit_reason, `closed ${c.symbol} without an exit reason`).not.toBeNull();
      expect(c.realized_pnl, `closed ${c.symbol} without P&L`).not.toBeNull();
    }
    // every closed trade's P&L ties to the wallet (open trades hold only margin, fees are in the P&L)
    if (r.openAtEnd === 0) {
      const pnl = r.closed.reduce((a, c) => a + Number(c.realized_pnl ?? 0), 0);
      expect(r.endBalance - r.startBalance).toBeCloseTo(pnl, 0);
    }
    for (const status of Object.values(r.botStates)) expect(["RUNNING", "POSITION_OPEN", "POSITION_MANAGED", "ORDER_PENDING"]).toContain(status);
  }, 3_600_000);

  it("tiny wallet (5 USDT): BTC is never forced, nothing breaks, other coins still get a chance", async () => {
    const r = await runScenario({ label: "5 USDT", balance: 5, days: Number(process.env.E2E_DAYS_SMALL ?? 14), seed: 11, restartAtHalf: false, faults: { readTimeout: 0.1, placeFailure: 0.02, cancelFailure: 0.03 } });
    report("5 USDT · faults", r);
    expect(r.violations).toEqual([]);
    expect(r.btcEntries).toBe(0); // 0.001 BTC can never fit a 5 USDT wallet's risk
    expect(r.unprotectedAlerts).toBe(0);
    for (const status of Object.values(r.botStates)) expect(["RUNNING", "POSITION_OPEN", "POSITION_MANAGED", "ORDER_PENDING"]).toContain(status);
    // the old bug: a BTC refusal ended every cycle — now other coins are evaluated after it
    const btcEndedCycle = Object.entries(r.reasons).filter(([k]) => /^Position size # is below the exchange minimum/.test(k)).reduce((a, [, n]) => a + n, 0);
    expect(btcEndedCycle).toBe(0);
  }, 3_600_000);

  it("RISKY trade style: whole free wallet as margin, still stop-loss protected, alongside a Safe bot", async () => {
    const risky: BotSpec[] = [
      { name: "Risky Smart Majors", body: { strategy: "TradenayaSmartV1", timeframe: "1h", coinUniverse: "MAJORS", maxRiskPerTrade: 5, dailyLossLimit: 60, momentumEntriesOnly: false, riskStyle: "RISKY" } },
      { name: "Risky Breakout Top", body: { strategy: "TrendBreakoutV1", timeframe: "4h", coinUniverse: "TOP_VOLUME", maxRiskPerTrade: 1, dailyLossLimit: 60, riskStyle: "RISKY" } },
      { name: "Safe Smart Top", body: { strategy: "TradenayaSmartV1", timeframe: "1h", coinUniverse: "TOP_VOLUME", maxRiskPerTrade: 5, dailyLossLimit: 30, momentumEntriesOnly: false } },
    ];
    const r = await runScenario({ label: "RISKY", balance: 500, days: Number(process.env.E2E_DAYS_RISKY ?? 14), seed: 23, restartAtHalf: true, bots: risky, faults: { readTimeout: 0.1, placeFailure: 0.03, cancelFailure: 0.05 } });
    report("RISKY 500 USDT · faults · restart", r);
    expect(r.violations).toEqual([]); // one stop-loss per position, no orphans, nothing stuck, loss never far past the stop
    expect(r.unprotectedAlerts).toBe(0);
    expect(r.entries).toBeGreaterThanOrEqual(2);
    // a Risky trade puts (nearly) the whole free wallet in as margin — far above what 5% max risk would size
    expect(Math.max(r.maxMarginByBot["Risky Smart Majors"] ?? 0, r.maxMarginByBot["Risky Breakout Top"] ?? 0)).toBeGreaterThan(0.5 * 500);
    for (const status of Object.values(r.botStates)) expect(["RUNNING", "POSITION_OPEN", "POSITION_MANAGED", "ORDER_PENDING"]).toContain(status);
  }, 3_600_000);
});
