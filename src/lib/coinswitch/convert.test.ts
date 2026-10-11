import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./reference-client", () => ({
  buildSignedRequest: (method: string, endpoint: string, params?: Record<string, unknown>) => {
    const query = method === "GET" && params ? `?${new URLSearchParams(params as Record<string, string>)}` : "";
    return { url: `https://cs.test${endpoint}${query}`, headers: {} };
  },
}));

import { convertInrToUsdt, convertUsdtToInr } from "./convert";

const KEYS = { apiKey: "k", apiSecret: "s" };

interface Book {
  inr: number;
  usdt: number;
  ask: number;
  bid: number;
  /** Status sequence returned by GET /order for each placed order, in order. */
  fills: Array<{ status: string; executed: number; price?: number }>;
}

let book: Book;
let placed: Array<Record<string, unknown>>;
let cancelled: string[];

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  vi.useFakeTimers();
  placed = [];
  cancelled = [];
  book = { inr: 10_000, usdt: 50, ask: 90, bid: 89.5, fills: [{ status: "EXECUTED", executed: 0 }] };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(url);
      const method = init?.method ?? "GET";
      if (u.pathname === "/user/portfolio") {
        return json({ data: [{ currency: "INR", main_balance: book.inr }, { currency: "USDT", main_balance: book.usdt }] });
      }
      if (u.pathname === "/tradeInfo") {
        return json({ data: { coinswitchx: { "USDT/INR": { quote: { min: 100 }, precision: { base: 2, quote: 2 } } } } });
      }
      if (u.pathname === "/depth") return json({ data: { asks: [[String(book.ask), "100"]], bids: [[String(book.bid), "100"]] } });
      if (u.pathname === "/order" && method === "POST") {
        const body = JSON.parse(String(init?.body));
        placed.push(body);
        return json({ data: { order_id: `o${placed.length}`, status: "OPEN" } });
      }
      if (u.pathname === "/order" && method === "DELETE") {
        cancelled.push(JSON.parse(String(init?.body)).order_id);
        return json({ data: {} });
      }
      if (u.pathname === "/order" && method === "GET") {
        const index = Number(u.searchParams.get("order_id")!.slice(1)) - 1;
        const fill = book.fills[Math.min(index, book.fills.length - 1)];
        const order = placed[index];
        const executed = fill.executed || Number(order.quantity);
        return json({ data: { order_id: `o${index + 1}`, status: fill.status, executed_qty: executed, average_price: fill.price ?? order.price } });
      }
      return json({ message: "unexpected" }, 404);
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function run<T>(promise: Promise<T>): Promise<T> {
  const settled = promise.then(
    (v) => ({ v }),
    (e) => ({ e }),
  );
  await vi.runAllTimersAsync();
  const r = (await settled) as { v?: T; e?: unknown };
  if ("e" in r) throw r.e;
  return r.v as T;
}

describe("INR → USDT (spot buy)", () => {
  it("sends a LIMIT buy at the best ask with only the documented fields", async () => {
    const result = await run(convertInrToUsdt(KEYS, 900));
    expect(placed).toHaveLength(1);
    expect(placed[0]).toEqual({ side: "buy", symbol: "USDT/INR", type: "limit", price: 90, quantity: 10, exchange: "coinswitchx" });
    expect(result.usdtReceived).toBe(10);
    expect(result.inrSpent).toBe(900);
  });

  it("keeps a fee buffer when converting the whole INR balance", async () => {
    book.inr = 900;
    await run(convertInrToUsdt(KEYS, 900));
    expect(Number(placed[0].quantity) * 90).toBeLessThanOrEqual(900 / 1.005);
  });

  it("never sends an order worth less than the ₹ minimum after rounding", async () => {
    book.ask = 92.37; // 100 / 92.37 = 1.0826… → floors to 1.08 = ₹99.76
    await run(convertInrToUsdt(KEYS, 100));
    expect(Number(placed[0].quantity) * Number(placed[0].price)).toBeGreaterThanOrEqual(100);
  });

  it("explains the minimum + fee when the wallet only holds the bare minimum", async () => {
    book.inr = 100;
    book.ask = 92.37;
    await expect(run(convertInrToUsdt(KEYS, 100))).rejects.toThrow(/at least ₹100 per order, plus a little extra INR/);
    expect(placed).toHaveLength(0);
  });

  it("cancels an unfilled order, re-quotes once and reports only what executed", async () => {
    book.fills = [
      { status: "PARTIALLY_EXECUTED", executed: 4 },
      { status: "EXECUTED", executed: 0 },
    ];
    const result = await run(convertInrToUsdt(KEYS, 900));
    expect(cancelled).toEqual(["o1"]);
    expect(placed).toHaveLength(2);
    expect(placed[1].quantity).toBe(6); // 900 INR − 4×90 already spent
    expect(result.usdtReceived).toBe(10);
  });

  it("explains an exchange rejection with the exchange's own message", async () => {
    vi.mocked(fetch).mockImplementationOnce(() => json({ data: [{ currency: "INR", main_balance: 10_000 }] }));
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((url, init) =>
      new URL(String(url)).pathname === "/order" && init?.method === "POST" ? json({ message: "price is required" }, 422) : original(url as string, init),
    );
    await expect(run(convertInrToUsdt(KEYS, 900))).rejects.toThrow("CoinSwitch rejected the order: price is required");
  });
});

describe("USDT → INR (spot sell)", () => {
  it("sends a LIMIT sell at the best bid", async () => {
    const result = await run(convertUsdtToInr(KEYS, 20));
    expect(placed[0]).toEqual({ side: "sell", symbol: "USDT/INR", type: "limit", price: 89.5, quantity: 20, exchange: "coinswitchx" });
    expect(result.usdtSold).toBe(20);
    expect(result.inrReceived).toBe(1790);
  });

  it("refuses to sell more than the spot USDT balance", async () => {
    await expect(run(convertUsdtToInr(KEYS, 60))).rejects.toThrow(/Insufficient USDT/);
    expect(placed).toHaveLength(0);
  });

  it("enforces the INR minimum on the sell value", async () => {
    await expect(run(convertUsdtToInr(KEYS, 1))).rejects.toThrow(/minimum conversion/);
    expect(placed).toHaveLength(0);
  });
});
