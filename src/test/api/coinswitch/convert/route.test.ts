import { describe, expect, it, vi } from "vitest";

const convertInrToUsdt = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({ getCustomerFromRequest: () => ({ customerId: 7, email: null }) }));
vi.mock("@/lib/db", () => ({ db: { query: vi.fn() } }));
vi.mock("@/app/api/coinswitch/_helpers", () => ({
  getKeysFromRequest: async () => {
    // What mysql2 throws when the database host can't be reached.
    throw Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT", fatal: true, syscall: "connect" });
  },
}));
vi.mock("@/lib/coinswitch/convert", () => ({
  convertInrToUsdt,
  convertUsdtToInr: vi.fn(),
  CoinSwitchAccessError: class extends Error {},
}));

import { POST } from "@/app/api/coinswitch/convert/route";

describe("POST /api/coinswitch/convert", () => {
  it("returns a readable JSON error (not an empty 500) when the database is unreachable", async () => {
    const res = await POST(new Request("http://test/api/coinswitch/convert", { method: "POST", body: JSON.stringify({ amountInr: 500 }) }) as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/can't reach its database \(ETIMEDOUT\)/);
    expect(convertInrToUsdt).not.toHaveBeenCalled();
  });
});
