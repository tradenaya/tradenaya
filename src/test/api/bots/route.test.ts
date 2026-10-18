import { beforeEach, describe, expect, it, vi } from "vitest";

const scheduler = vi.hoisted(() => ({
  bots: [] as Array<{ capitalMode: "fixed" | "percent"; walletPercent?: number }>,
  createBot: vi.fn(async () => ({ botId: 42 })),
}));

vi.mock("@/lib/auth", () => ({ getCustomerFromRequest: () => ({ customerId: 7, email: null }) }));
vi.mock("@/automation/scheduler/BotScheduler", () => ({
  botScheduler: {
    listBots: async () => scheduler.bots,
    createBot: scheduler.createBot,
    ensureStarted: async () => undefined,
    isRunning: () => true,
  },
}));

import { POST } from "@/app/api/bots/route";

function create(walletPercent: number) {
  const req = new Request("http://test/api/bots", {
    method: "POST",
    body: JSON.stringify({ symbol: "BTCUSDT", timeframe: "1h", leverage: 5, capitalMode: "percent", walletPercent }),
  });
  return POST(req as never);
}

beforeEach(() => {
  scheduler.bots = [];
  scheduler.createBot.mockClear();
});

describe("POST /api/bots wallet %", () => {
  it("accepts 100% when no other bot uses the wallet (scheduler caps it to the safe share)", async () => {
    const res = await create(100);
    expect(res.status).toBe(200);
    expect(scheduler.createBot).toHaveBeenCalledOnce();
  });

  it("accepts exactly the remaining share", async () => {
    scheduler.bots = [{ capitalMode: "percent", walletPercent: 40 }, { capitalMode: "fixed" }];
    expect((await create(60)).status).toBe(200);
  });

  // Wallet-% bots share the wallet and size from the FREE balance each cycle,
  // so several bots may each use 100% — no reservation, no idle money.
  it("accepts a bot even when others together already use more than 100%", async () => {
    scheduler.bots = [{ capitalMode: "percent", walletPercent: 40 }];
    expect((await create(70)).status).toBe(200);
  });

  it("accepts a second and third 100% bot", async () => {
    scheduler.bots = [{ capitalMode: "percent", walletPercent: 100 }, { capitalMode: "percent", walletPercent: 100 }];
    const res = await create(100);
    expect(res.status).toBe(200);
    expect(scheduler.createBot).toHaveBeenCalledOnce();
  });
});
