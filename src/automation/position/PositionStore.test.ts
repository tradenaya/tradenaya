import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock("@/lib/db", () => ({ db: { query: queryMock } }));

import { PositionStore, toMysqlUtc } from "./PositionStore";

afterEach(() => {
  queryMock.mockReset();
  vi.useRealTimers();
});

beforeEach(() => {
  queryMock.mockImplementation(async () => [[], []]);
});

function buildStore() {
  return new PositionStore();
}

function lastUpdateCall() {
  const call = queryMock.mock.calls.find((c) => String(c[0]).includes("UPDATE automation_positions"));
  if (!call) throw new Error("no UPDATE automation_positions call captured");
  return { sql: String(call[0]), params: call[1] as unknown[] };
}

describe("toMysqlUtc", () => {
  it("converts an ISO timestamp with milliseconds (the production failure case)", () => {
    expect(toMysqlUtc("2026-09-14T18:28:03.723Z")).toBe("2026-09-14 18:28:03");
  });

  it("converts an ISO timestamp without milliseconds", () => {
    expect(toMysqlUtc("2026-09-14T18:28:03Z")).toBe("2026-09-14 18:28:03");
  });

  it("preserves the instant across timezone offsets (UTC wall-clock, never shifted)", () => {
    expect(toMysqlUtc("2026-09-14T23:58:03.500+05:30")).toBe("2026-09-14 18:28:03");
  });

  it("accepts a Date object", () => {
    expect(toMysqlUtc(new Date("2026-09-14T18:28:03.723Z"))).toBe("2026-09-14 18:28:03");
  });

  it("accepts an epoch-millisecond number", () => {
    expect(toMysqlUtc(Date.parse("2026-09-14T18:28:03Z"))).toBe("2026-09-14 18:28:03");
  });

  it("falls back to the current UTC time for undefined/null", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T18:28:03.723Z"));
    expect(toMysqlUtc(undefined)).toBe("2026-09-14 18:28:03");
    expect(toMysqlUtc(null)).toBe("2026-09-14 18:28:03");
  });

  it("throws a clear error for an invalid timestamp", () => {
    expect(() => toMysqlUtc("not-a-date")).toThrow(/Invalid close timestamp: "not-a-date"/);
  });

  it("regression: never emits the ISO form a TIMESTAMP column rejects (no 'T', no ms, no 'Z')", () => {
    const out = toMysqlUtc("2026-09-14T18:28:03.723Z");
    expect(out).not.toContain("T");
    expect(out).not.toContain("Z");
    expect(out.endsWith(".000Z")).toBe(false);
    expect(out.endsWith(".723Z")).toBe(false);
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

describe("PositionStore.markClose", () => {
  it("binds a MySQL-compatible UTC datetime for an ISO-8601 closedAt", async () => {
    await buildStore().markClose(42, 100.5, "MANUAL_CLOSE", 12.25, 0.5, "2026-09-14T18:28:03.723Z");
    const { sql, params } = lastUpdateCall();
    expect(sql).toContain("state = 'CLOSED'");
    expect(params[6]).toBe("2026-09-14 18:28:03");
  });

  it("uses the current UTC time when closedAt is undefined", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T18:28:03.723Z"));
    await buildStore().markClose(42, 100.5, "MANUAL_CLOSE", 12.25, 0.5);
    const { params } = lastUpdateCall();
    expect(params[6]).toBe("2026-09-14 18:28:03");
  });

  it("throws without hitting the UPDATE when closedAt is invalid", async () => {
    await expect(buildStore().markClose(42, 100.5, "MANUAL_CLOSE", 12.25, 0.5, "garbage")).rejects.toThrow(
      /Invalid close timestamp/,
    );
    expect(queryMock.mock.calls.filter((c) => String(c[0]).includes("UPDATE automation_positions"))).toHaveLength(0);
  });

  it("persists a TAKE_PROFIT close with all fields and tp_triggered path", async () => {
    await buildStore().markClose(7, 250, "TAKE_PROFIT", 33.3, 0.9, "2026-09-14T18:28:03.723Z");
    const { sql, params } = lastUpdateCall();
    expect(params[0]).toBe(250);
    expect(params[1]).toBe("TAKE_PROFIT");
    expect(params[2]).toBe(33.3);
    expect(params[3]).toBe(0.9);
    expect(params[4]).toBe("TAKE_PROFIT");
    expect(params[5]).toBe("TAKE_PROFIT");
    expect(params[6]).toBe("2026-09-14 18:28:03");
    expect(params[7]).toBe(7);
    expect(sql).toContain("tp_triggered = CASE WHEN ? = 'TAKE_PROFIT' THEN 1 ELSE tp_triggered END");
    expect(sql).toContain("sl_triggered = CASE WHEN ? = 'STOP_LOSS' THEN 1 ELSE sl_triggered END");
    expect(sql).toContain("exit_price = ?");
    expect(sql).toContain("exit_reason = ?");
    expect(sql).toContain("realized_pnl = ?");
    expect(sql).toContain("fees = ?");
    expect(sql).toContain("closed_at = ?");
    expect(sql).toContain("updated_at = CURRENT_TIMESTAMP");
  });

  it("persists a STOP_LOSS close with sl_triggered path", async () => {
    await buildStore().markClose(9, 90, "STOP_LOSS", -10, 1.1, "2026-09-14T10:30:00.000Z");
    const { params } = lastUpdateCall();
    expect(params[1]).toBe("STOP_LOSS");
    expect(params[4]).toBe("STOP_LOSS");
    expect(params[5]).toBe("STOP_LOSS");
    expect(params[6]).toBe("2026-09-14 10:30:00");
  });
});