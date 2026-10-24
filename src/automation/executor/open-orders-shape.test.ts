import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/coinswitch.store", () => ({ getKeysForUser: vi.fn(async () => ({ apiKey: "k", apiSecret: "s", status: "A" })) }));
vi.mock("@/lib/coinswitch", () => ({ buildSignedRequest: vi.fn(async () => ({ url: "https://example.invalid", headers: {} })) }));

import { CoinSwitchClient } from "./client";

/** "Nothing open" replies must read as an empty list, not as a failed read (that raised false "unprotected" alerts). */
function clientReturning(body: unknown) {
  const c = new CoinSwitchClient();
  (c as unknown as { call: () => Promise<unknown> }).call = vi.fn(async () => body);
  return c;
}

describe("CoinSwitch open orders — reply shapes", () => {
  it.each([
    [{ data: { orders: [{ order_id: "1" }] } }, 1],
    [{ data: { orders: [] } }, 0],
    [{ data: { orders: null } }, 0],
    [{ data: {} }, 0],
    [{ data: null }, 0],
    [{ data: [] }, 0],
  ])("%j → %i orders", async (body, n) => {
    expect(await clientReturning(body).getOpenOrders(1, "BTCUSDT")).toHaveLength(n);
  });

  it("a truly unrecognisable reply is still a failed read", async () => {
    await expect(clientReturning({ data: { result: { weird: true } } }).getOpenOrders(1)).rejects.toThrow(/unexpected exchange response shape/);
    await expect(clientReturning("oops").getOpenOrders(1)).rejects.toThrow(/unexpected/);
  });
});
