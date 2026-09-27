import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock("@/lib/db", () => ({ db: { query: queryMock } }));

import { toMySQLDatetime, saveKeysForUser, setExpiryForUser } from "./coinswitch.store";

beforeEach(() => {
  queryMock.mockImplementation(async () => [[], []]);
});

afterEach(() => {
  queryMock.mockReset();
});

function lastCall(matches: string) {
  const call = queryMock.mock.calls.find((c) => String(c[0]).includes(matches));
  if (!call) throw new Error(`no call matching ${matches} captured`);
  return { sql: String(call[0]), params: call[1] as unknown[] };
}

describe("toMySQLDatetime", () => {
  it("stores a datetime-local selection exactly as chosen, with no timezone shift", () => {
    expect(toMySQLDatetime("2026-10-18T20:54")).toBe("2026-10-18 20:54:00");
  });

  it("keeps seconds when supplied", () => {
    expect(toMySQLDatetime("2026-01-05T06:07:08")).toBe("2026-01-05 06:07:08");
  });

  it("does not roll a chosen date or time across a day/month boundary", () => {
    expect(toMySQLDatetime("2026-10-31T23:59")).toBe("2026-10-31 23:59:00");
    expect(toMySQLDatetime("2026-01-01T00:00")).toBe("2026-01-01 00:00:00");
  });

  it("normalises an already-MySQL-shaped literal unchanged", () => {
    expect(toMySQLDatetime("2026-10-18 20:54:00")).toBe("2026-10-18 20:54:00");
  });

  it("maps an empty or missing expiry to null so it clears rather than shifting", () => {
    expect(toMySQLDatetime(null)).toBeNull();
    expect(toMySQLDatetime(undefined)).toBeNull();
    expect(toMySQLDatetime("")).toBeNull();
  });

  it("returns null for an unparseable expiry instead of storing garbage", () => {
    expect(toMySQLDatetime("not-a-date")).toBeNull();
  });
});

describe("saveKeysForUser", () => {
  it("persists the chosen expiry alongside the encrypted credentials", async () => {
    await saveKeysForUser(7, "live-key-1234", "super-secret", "2026-10-18T20:54");

    const { sql, params } = lastCall("INSERT INTO coinswitch_keys");
    expect(sql).toContain("valid_until");
    expect(params[params.length - 1]).toBe("2026-10-18 20:54:00");
  });

  it("never writes the raw secret — only the encrypted column is persisted", async () => {
    await saveKeysForUser(7, "live-key-1234", "super-secret", null);

    const { sql, params } = lastCall("INSERT INTO coinswitch_keys");
    expect(sql).toContain("api_secret_enc");
    expect(sql).not.toContain("api_secret,");
    expect(params).not.toContain("super-secret");
  });

  it("clears the expiry when none is chosen", async () => {
    await saveKeysForUser(7, "live-key-1234", "super-secret", null);

    const { params } = lastCall("INSERT INTO coinswitch_keys");
    expect(params[params.length - 1]).toBeNull();
  });
});

describe("setExpiryForUser", () => {
  it("updates only the expiry, stored as the literal local selection", async () => {
    await setExpiryForUser(7, "2026-10-18T20:54");

    const { sql, params } = lastCall("UPDATE coinswitch_keys SET valid_until");
    expect(sql).toBe("UPDATE coinswitch_keys SET valid_until = ? WHERE user_id = ?");
    expect(params).toEqual(["2026-10-18 20:54:00", 7]);
  });

  it("clears the expiry on null", async () => {
    await setExpiryForUser(7, null);

    const { params } = lastCall("UPDATE coinswitch_keys SET valid_until");
    expect(params).toEqual([null, 7]);
  });
});
